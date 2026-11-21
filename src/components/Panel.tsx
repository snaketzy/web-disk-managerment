import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { navigate, select, setActive, setStorage, toggleHidden } from '../features/panels/panelsSlice'
import {
  useAdminStoragesQuery,
  useCopyMutation,
  useGetStoragesQuery,
  useLazyGenerateDirectLinkQuery,
  useLazyGetFileQuery,
  useListFilesQuery,
  useMkdirMutation,
  useMoveMutation,
  useNewFileMutation,
  usePutFileMutation,
  useRemoveMutation,
  useRenameMutation,
  useReuseLocalMutation,
  useStartRemoteReuseMutation,
} from '../features/fs/api'
import type { FsItem, ReuseJob, Side } from '../types'
import { usePrompt } from '../ui/PromptDialog'
import { joinPath, parentPath, relativeSegments, storageRootOf } from '../utils/path'
import { md5File } from '../utils/md5'
import ReuseMd5Dialog from './ReuseMd5Dialog'
import type { ReuseInput } from './ReuseMd5Dialog'

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

function fmtSize(bytes: number): string {
  if (!bytes || bytes < 0) return ''
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : value < 10 ? 1 : 0)} ${SIZE_UNITS[unit]}`
}

const fmtTime = (s: string) => (s ? s.replace('T', ' ').slice(0, 16) : '')

export default function Panel({ side }: { side: Side }) {
  const dispatch = useAppDispatch()
  const panel = useAppSelector((s) => s.panels[side])
  const isActive = useAppSelector((s) => s.panels.active === side)
  const otherSide: Side = side === 'left' ? 'right' : 'left'
  const otherPanel = useAppSelector((s) => s.panels[otherSide])
  const { prompt, confirm } = usePrompt()

  const { data: storagesData } = useGetStoragesQuery()
  const storages = useMemo(() => storagesData?.storages ?? [], [storagesData])

  // 秒传只对「123 开放平台」驱动有效：取各挂载的驱动，判断对侧是否可秒传
  const { data: adminStoragesData } = useAdminStoragesQuery()
  const otherMount = storageRootOf(otherPanel.storage)
  const otherDriver = useMemo(() => {
    const records = adminStoragesData?.data?.content ?? []
    if (!records.length) return undefined // 拿不到驱动信息（如未配 token）时不限制
    return records.find((s) => s.mount_path === otherMount)?.driver
  }, [adminStoragesData, otherMount])
  const reuseBlocked = !!otherPanel.storage && !!otherDriver && otherDriver !== '123 Open'
  const reuseTitle = reuseBlocked
    ? `对侧挂载「${otherPanel.storage}」不是 123 开放平台（${otherDriver}），无法秒传`
    : null

  // 直链只对「123 开放平台」驱动有效：判断当前面板所在挂载
  const selfMount = storageRootOf(panel.storage)
  const selfDriver = useMemo(() => {
    const records = adminStoragesData?.data?.content ?? []
    if (!records.length) return undefined // 拿不到驱动信息（如未配 token）时不限制
    return records.find((s) => s.mount_path === selfMount)?.driver
  }, [adminStoragesData, selfMount])
  const linkBlocked = !!panel.storage && !!selfDriver && selfDriver !== '123 Open'
  const linkTitle = linkBlocked
    ? `当前挂载「${panel.storage}」不是 123 开放平台（${selfDriver}），无法生成直链`
    : null

  const listQuery = useListFilesQuery({ path: panel.path || '/' }, { skip: !panel.storage })
  const items = useMemo(() => {
    const content = listQuery.data?.data?.content ?? []
    return [...content]
      .filter((i) => panel.showHidden || !i.name.startsWith('.'))
      .sort((a, b) => (a.is_dir === b.is_dir ? a.name.localeCompare(b.name, 'zh') : a.is_dir ? -1 : 1))
  }, [listQuery.data, panel.showHidden])

  const [mkdir] = useMkdirMutation()
  const [rename] = useRenameMutation()
  const [remove] = useRemoveMutation()
  const [copy] = useCopyMutation()
  const [move] = useMoveMutation()
  const [newFile] = useNewFileMutation()
  const [putFile] = usePutFileMutation()
  const [fetchFile] = useLazyGetFileQuery()
  const [reuseLocal] = useReuseLocalMutation()
  const [startRemoteReuse] = useStartRemoteReuseMutation()
  const [fetchDirectLink] = useLazyGenerateDirectLinkQuery()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const reuseLocalRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reuseMsg, setReuseMsg] = useState<string | null>(null)
  const [reuseMdOpen, setReuseMdOpen] = useState(false)
  const [linkDialog, setLinkDialog] = useState<{ url: string; copied: boolean } | null>(null)

  const selectedSet = useMemo(() => new Set(panel.selected), [panel.selected])
  const selectedNames = panel.selected
  const root = storageRootOf(panel.storage)
  const crumbs = relativeSegments(panel.path, panel.storage)
  const canGoUp = panel.path !== root

  useEffect(() => {
    if (!panel.storage && storages.length) {
      dispatch(setStorage({ side, storage: storages[0].name }))
    }
  }, [storages, panel.storage, side, dispatch])

  const openItem = (item: FsItem) => {
    if (item.is_dir) {
      dispatch(navigate({ side, path: joinPath(panel.path, item.name) }))
      return
    }
    fetchFile(joinPath(panel.path, item.name))
      .unwrap()
      .then((res) => {
        if (res.data?.raw_url) window.open(res.data.raw_url, '_blank')
      })
      .catch(() => setError('无法获取下载地址'))
  }

  const goUp = () => {
    if (canGoUp) dispatch(navigate({ side, path: parentPath(panel.path) }))
  }

  // 生成直链：仅对选中的单个文件有效
  const selectedFile = selectedNames.length === 1 ? items.find((i) => i.name === selectedNames[0]) : undefined
  const canGenLink = !!selectedFile && !selectedFile.is_dir

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setLinkDialog((d) => (d ? { ...d, copied: true } : d))
    } catch {
      setLinkDialog((d) => (d ? { ...d, copied: false } : d))
    }
  }

  const doGenerateLink = async () => {
    if (!selectedFile || selectedFile.is_dir) return
    setError(null)
    try {
      const res = await fetchDirectLink(joinPath(panel.path, selectedFile.name)).unwrap()
      const url = typeof res === 'object' ? res?.data?.url : undefined
      if (!url) {
        setError('后端未返回直链，请先重启后端使新接口生效')
        return
      }
      setLinkDialog({ url, copied: false })
      void copyLink(url)
    } catch (e) {
      setError((e as { data?: { message?: string } })?.data?.message || '生成直链失败')
    }
  }

  const doMkdir = async () => {
    const name = await prompt({ title: '新建文件夹', label: '文件夹名称' })
    if (!name) return
    const res = await mkdir({ path: joinPath(panel.path, name) })
    if ('error' in res) setError('新建文件夹失败')
  }

  const doNewFile = async () => {
    const name = await prompt({ title: '新建文件', label: '文件名', placeholder: '例如 note.txt' })
    if (!name) return
    const res = await newFile({ path: joinPath(panel.path, name) })
    if ('error' in res) setError('新建文件失败')
  }

  const doRename = async () => {
    if (selectedNames.length !== 1) return
    const current = selectedNames[0]
    const input = await prompt({ title: '重命名', label: '新名称', defaultValue: current })
    if (!input || input === current) return
    const res = await rename({ path: joinPath(panel.path, current), name: input })
    if ('error' in res) setError('重命名失败')
  }

  const doDelete = async () => {
    if (!selectedNames.length) return
    const ok = await confirm({
      title: '删除确认',
      message: `确定删除选中的 ${selectedNames.length} 项？此操作不可恢复。`,
      okText: '删除',
      danger: true,
    })
    if (!ok) return
    const res = await remove({ dir: panel.path, names: selectedNames })
    if ('error' in res) setError('删除失败')
  }

  const transfer = async (mode: 'copy' | 'move') => {
    if (!selectedNames.length) return
    if (!otherPanel.storage) {
      setError('对侧面板未选择存储')
      return
    }
    if (otherPanel.path === panel.path) {
      setError('源目录与目标目录相同')
      return
    }
    const res =
      mode === 'copy'
        ? await copy({ src_dir: panel.path, dst_dir: otherPanel.path, names: selectedNames })
        : await move({ src_dir: panel.path, dst_dir: otherPanel.path, names: selectedNames })
    if ('error' in res) setError(mode === 'copy' ? '复制失败' : '移动失败')
  }

  const doUpload = async (files: FileList | File[]) => {
    const arr = Array.from(files)
    if (!arr.length || !panel.storage) return
    setBusy(true)
    setError(null)
    try {
      for (const file of arr) {
        const res = await putFile({ dir: panel.path, file })
        if ('error' in res) {
          setError(`上传失败：${file.name}`)
          break
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const flashReuse = (msg: string) => {
    setReuseMsg(msg)
    setTimeout(() => setReuseMsg(null), 4000)
  }

  // 本地文件秒传：浏览器算 MD5，只把 hash 发给后端调 123
  const doReuseLocal = async (files: FileList) => {
    const file = files[0]
    if (!file) return
    if (!otherPanel.storage) {
      setError('对侧面板未选择存储')
      return
    }
    setBusy(true)
    setError(null)
    setReuseMsg('计算 MD5… 0%')
    try {
      const md5 = await md5File(file, (r) => setReuseMsg(`计算 MD5… ${Math.round(r * 100)}%`))
      setReuseMsg('提交秒传…')
      const res = await reuseLocal({
        dstMount: '/' + otherPanel.storage,
        dstDir: otherPanel.path,
        filename: file.name,
        size: file.size,
        md5,
      })
      if ('error' in res)
        setError((res.error as { data?: { message?: string } })?.data?.message || '秒传请求失败')
      else if (res.data?.code === 200) flashReuse(`秒传成功：${file.name}`)
      else setError(res.data?.message || '秒传失败')
    } catch {
      setError('计算 MD5 失败')
    } finally {
      setBusy(false)
      setReuseMsg(null)
    }
  }

  // 粘贴/载入 MD5 秒传：文件名 + 大小 + MD5 由弹窗给出
  const doReuseByMd5 = async (v: ReuseInput) => {
    setReuseMdOpen(false)
    if (!otherPanel.storage) {
      setError('对侧面板未选择存储')
      return
    }
    setError(null)
    setReuseMsg(`秒传 ${v.filename}…`)
    try {
      const res = await reuseLocal({
        dstMount: '/' + otherPanel.storage,
        dstDir: otherPanel.path,
        filename: v.filename,
        size: v.size,
        md5: v.md5,
      })
      if ('error' in res)
        setError((res.error as { data?: { message?: string } })?.data?.message || '秒传请求失败')
      else if (res.data?.code === 200) flashReuse(`秒传成功：${v.filename}`)
      else setError(res.data?.message || '秒传失败')
    } finally {
      setReuseMsg(null)
    }
  }

  // 面板内远程文件秒传：后端读源文件算 MD5，前端轮询进度
  const doReuseSelected = async () => {
    if (!selectedNames.length) return
    if (!otherPanel.storage) {
      setError('对侧面板未选择存储')
      return
    }
    const picked = items.filter((i) => selectedNames.includes(i.name) && !i.is_dir)
    if (!picked.length) {
      setError('请选择文件（秒传暂不支持目录）')
      return
    }
    setError(null)
    try {
      for (const item of picked) {
        setReuseMsg(`秒传 ${item.name}…`)
        const started = await startRemoteReuse({
          srcPath: joinPath(panel.path, item.name),
          dstMount: '/' + otherPanel.storage,
          dstDir: otherPanel.path,
        })
        const jobId = 'data' in started ? started.data?.data?.jobId : undefined
        if (!jobId) {
          setError(`${item.name}：启动秒传失败`)
          continue
        }
        for (;;) {
          await new Promise((r) => setTimeout(r, 1200))
          const j = await fetch(`/api/reuse/remote/${jobId}`)
            .then((r) => r.json())
            .catch(() => null)
          const job = j?.data as ReuseJob | undefined
          if (!job) {
            setError(`${item.name}：秒传状态获取失败`)
            break
          }
          if (job.state === 'done') {
            if (job.result?.reuse) flashReuse(`${item.name}：秒传成功`)
            else setError(`${item.name}：${job.result?.message || '未命中'}`)
            break
          }
          if (job.state === 'error') {
            setError(`${item.name}：${job.message}`)
            break
          }
          setReuseMsg(`秒传 ${item.name}… ${Math.round((job.progress || 0) * 100)}%`)
        }
      }
    } finally {
      setReuseMsg(null)
    }
  }

  const handleRowMouseDown = (e: ReactMouseEvent<HTMLDivElement>, item: FsItem) => {
    dispatch(setActive(side))
    const index = items.findIndex((i) => i.name === item.name)
    if (e.shiftKey && panel.anchor) {
      const anchorIndex = items.findIndex((i) => i.name === panel.anchor)
      if (anchorIndex >= 0) {
        const [lo, hi] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex]
        dispatch(select({ side, names: items.slice(lo, hi + 1).map((i) => i.name) }))
        return
      }
    }
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(panel.selected)
      if (next.has(item.name)) next.delete(item.name)
      else next.add(item.name)
      dispatch(select({ side, names: [...next], anchor: item.name }))
      return
    }
    dispatch(select({ side, names: [item.name], anchor: item.name }))
  }

  const actionsRef = useRef({
    goUp,
    refresh: () => listQuery.refetch(),
    doMkdir,
    doNewFile,
    doRename,
    doDelete,
    transfer,
    openItem,
    items,
    selectedNames,
  })
  actionsRef.current = {
    goUp,
    refresh: () => listQuery.refetch(),
    doMkdir,
    doNewFile,
    doRename,
    doDelete,
    transfer,
    openItem,
    items,
    selectedNames,
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isActive) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const a = actionsRef.current
      switch (e.key) {
        case 'F2':
          e.preventDefault()
          void a.doRename()
          break
        case 'F3':
          e.preventDefault()
          void a.refresh()
          break
        case 'F5':
          e.preventDefault()
          void a.transfer('copy')
          break
        case 'F6':
          e.preventDefault()
          void a.transfer('move')
          break
        case 'F7':
          e.preventDefault()
          void a.doMkdir()
          break
        case 'F8':
          e.preventDefault()
          void a.doDelete()
          break
        case 'Backspace':
          e.preventDefault()
          a.goUp()
          break
        case 'Tab':
          e.preventDefault()
          dispatch(setActive(otherSide))
          break
        case 'Enter': {
          const target = a.items.find((i) => i.name === a.selectedNames[0])
          if (target) a.openItem(target)
          break
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isActive, otherSide, dispatch])

  return (
    <section
      className={`panel${isActive ? ' panel-active' : ''}`}
      onMouseDown={() => dispatch(setActive(side))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (e.dataTransfer.files?.length) void doUpload(e.dataTransfer.files)
      }}
    >
      <div className="panel-toolbar">
        <select
          className="storage-select"
          value={panel.storage}
          onChange={(e) => dispatch(setStorage({ side, storage: e.target.value }))}
        >
          {!storages.length && <option value="">（无可用存储）</option>}
          {storages.map((s) => (
            <option key={s.path} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="ico" title="上级目录 (Backspace)" disabled={!canGoUp} onClick={goUp}>
          上级
        </button>
        <button className="ico" title="刷新 (F3)" onClick={() => void listQuery.refetch()}>
          刷新
        </button>
        <button className="ico" title="新建文件夹 (F7)" onClick={() => void doMkdir()}>
          新建目录
        </button>
        <button className="ico" title="新建文件" onClick={() => void doNewFile()}>
          新建文件
        </button>
        <button className="ico" title="上传文件" onClick={() => fileInputRef.current?.click()}>
          上传
        </button>
        <button
          className="ico"
          title={reuseTitle || '秒传本地文件到对侧 123（按 MD5 复用，不受 10GB 限制）'}
          disabled={!otherPanel.storage || reuseBlocked}
          onClick={() => reuseLocalRef.current?.click()}
        >
          秒传文件
        </button>
        <button
          className="ico"
          title={linkTitle || '获取选中文件的 123 直链（需账号已开通直链空间）'}
          disabled={!canGenLink || linkBlocked}
          onClick={() => void doGenerateLink()}
        >
          生成直链
        </button>
        <button className="ico" title="重命名 (F2)" disabled={selectedNames.length !== 1} onClick={() => void doRename()}>
          重命名
        </button>
        <button className="ico" title="删除 (F8)" disabled={!selectedNames.length} onClick={() => void doDelete()}>
          删除
        </button>
        <button
          className="ico"
          title="显示 / 隐藏隐藏文件"
          onClick={() => dispatch(toggleHidden(side))}
        >
          {panel.showHidden ? '隐藏已显' : '显示隐藏'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) void doUpload(e.target.files)
            e.target.value = ''
          }}
        />
        <input
          ref={reuseLocalRef}
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) void doReuseLocal(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      <div className="pathbar">
        <span className="crumb" onClick={() => dispatch(navigate({ side, path: root }))}>
          {panel.storage || '根'}
        </span>
        {crumbs.map((seg, i) => {
          const target = `${root}/${crumbs.slice(0, i + 1).join('/')}`
          return (
            <span key={target} className="crumb-group">
              <span className="crumb-sep">/</span>
              <span className="crumb" onClick={() => dispatch(navigate({ side, path: target }))}>
                {seg}
              </span>
            </span>
          )
        })}
      </div>

      <div className="filelist">
        <div className="row row-header">
          <span className="col-name">名称</span>
          <span className="col-size">大小</span>
          <span className="col-time">修改时间</span>
        </div>
        <div className="rows">
          {listQuery.isFetching && <div className="list-hint">加载中…</div>}
          {!listQuery.isFetching && !items.length && (
            <div className="list-hint">{panel.storage ? '空目录' : '请选择存储'}</div>
          )}
          {items.map((item) => (
            <div
              key={item.name}
              className={`row${selectedSet.has(item.name) ? ' row-selected' : ''}`}
              onMouseDown={(e) => handleRowMouseDown(e, item)}
              onDoubleClick={() => openItem(item)}
            >
              <span className="col-name">
                <span className="file-icon" data-kind={item.is_dir ? 'dir' : 'file'} />
                <span className="file-name">{item.name}</span>
              </span>
              <span className="col-size">{item.is_dir ? '' : fmtSize(item.size)}</span>
              <span className="col-time">{fmtTime(item.modified)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel-footer">
        <span>{items.length} 项</span>
        {selectedNames.length > 0 && <span className="footer-sel">已选 {selectedNames.length}</span>}
        <span className="footer-spacer" />
        <button
          className="ico"
          disabled={!otherPanel.storage || reuseBlocked}
          title={reuseTitle || '粘贴 MD5 / 载入本地文件算 MD5 后秒传到对侧 123'}
          onClick={() => setReuseMdOpen(true)}
        >
          粘贴MD5上传
        </button>
        <button
          className="ico"
          disabled={!selectedNames.length || !otherPanel.storage || reuseBlocked}
          title={reuseTitle || '秒传到对侧 123（按 MD5 复用，不受 10GB 限制）'}
          onClick={() => void doReuseSelected()}
        >
          秒传 →
        </button>
        <button
          className="ico"
          disabled={!selectedNames.length || !otherPanel.storage}
          title="复制到对侧面板 (F5)"
          onClick={() => void transfer('copy')}
        >
          复制 →
        </button>
        <button
          className="ico"
          disabled={!selectedNames.length || !otherPanel.storage}
          title="移动到对侧面板 (F6)"
          onClick={() => void transfer('move')}
        >
          移动 →
        </button>
      </div>

      {busy && <div className="panel-busy">处理中…</div>}
      {reuseMsg && <div className="panel-busy">{reuseMsg}</div>}
      {reuseMdOpen && (
        <ReuseMd5Dialog onClose={() => setReuseMdOpen(false)} onConfirm={(v) => void doReuseByMd5(v)} />
      )}
      {linkDialog && (
        <div className="modal-overlay" onMouseDown={() => setLinkDialog(null)}>
          <div className="modal modal-wide" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-title">文件直链</div>
            <label className="modal-label">
              {linkDialog.copied ? '已复制到剪贴板' : '直链如下（点击「复制」或选中后手动复制）'}
            </label>
            <div className="modal-input-row">
              <input
                className="modal-input"
                readOnly
                value={linkDialog.url}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button className="btn btn-primary" onClick={() => void copyLink(linkDialog.url)}>
                复制
              </button>
            </div>
            <div className="modal-hint">
              直链默认为公开资源，请勿用于图床 / 软件分发等场景；有效期由 123 侧控制。
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => window.open(linkDialog.url, '_blank')}>
                打开
              </button>
              <button className="btn btn-primary" onClick={() => setLinkDialog(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="panel-error" onClick={() => setError(null)}>
          {error}
          <span className="err-close">✕</span>
        </div>
      )}
    </section>
  )
}
