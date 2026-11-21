import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppDispatch } from '../app/hooks'
import { api, useCancelTaskMutation, useRetryTaskMutation, useTaskUndoneQuery } from '../features/fs/api'
import { CANCELABLE_STATES, TaskState, type TaskInfo, type TaskKind } from '../types'

interface TaskRow extends TaskInfo {
  kind: TaskKind
}

const STATE_TEXT: Record<number, string> = {
  0: '等待中',
  1: '传输中',
  2: '已完成',
  3: '取消中…',
  4: '已取消',
  5: '出错，将重试',
  6: '失败中…',
  7: '失败',
  8: '等待重试',
  9: '准备重试',
}

const KIND_TEXT: Record<TaskKind, string> = { copy: '复制', move: '移动' }

const clamp = (n: number) => Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0))

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 解析 OpenList 时间字符串（可能带纳秒精度），失败返回 NaN */
const parseTime = (s: string | null) => (s ? Date.parse(s.replace(/(\.\d{3})\d+/, '$1')) : NaN)

/** 毫秒 → 已用时文本，如 03:21 / 1:02:03 */
const formatElapsed = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`
}

export default function TaskBar() {
  const dispatch = useAppDispatch()
  const [expanded, setExpanded] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // 复制/移动是 OpenList 的异步任务，这里轮询未完成列表拿进度
  const copyRes = useTaskUndoneQuery('copy', { pollingInterval: 2000 })
  const moveRes = useTaskUndoneQuery('move', { pollingInterval: 2000 })
  const [cancelTask] = useCancelTaskMutation()
  const [retryTask] = useRetryTaskMutation()

  const rows = useMemo<TaskRow[]>(
    () => [
      ...(copyRes.data?.data ?? []).map((t) => ({ ...t, kind: 'copy' as TaskKind })),
      ...(moveRes.data?.data ?? []).map((t) => ({ ...t, kind: 'move' as TaskKind })),
    ],
    [copyRes.data, moveRes.data]
  )

  // 任务集合变化（新增/完成）时刷新文件列表；全部完成时再提示一下
  const ids = rows.map((r) => `${r.kind}:${r.id}`).join(',')
  const prevIdsRef = useRef('')
  useEffect(() => {
    const prev = prevIdsRef.current
    prevIdsRef.current = ids
    if (prev === ids) return
    if (prev) dispatch(api.util.invalidateTags(['List']))
    if (prev && !ids) {
      setShowDone(true)
      const timer = setTimeout(() => setShowDone(false), 4000)
      return () => clearTimeout(timer)
    }
  }, [ids, dispatch])

  // 有任务在跑时每秒刷新一次「已用时」
  useEffect(() => {
    if (!rows.length) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [rows.length])

  if (!rows.length && !showDone) return null

  const avg = rows.length
    ? Math.round(rows.reduce((sum, r) => sum + clamp(r.progress), 0) / rows.length)
    : 100

  // 以最早开始的任务为起点计算整体已用时
  const startMs = rows.reduce<number | null>((min, r) => {
    const t = parseTime(r.start_time)
    if (Number.isNaN(t)) return min
    return min === null || t < min ? t : min
  }, null)
  const elapsed = startMs === null ? 0 : now - startMs

  const cancel = async (row: TaskRow) => {
    const res = await cancelTask({ kind: row.kind, tid: row.id })
    if ('error' in res || res.data?.code !== 200) setError('取消失败')
  }

  const retry = async (row: TaskRow) => {
    const res = await retryTask({ kind: row.kind, tid: row.id })
    if ('error' in res || res.data?.code !== 200) setError('重试失败')
  }

  return (
    <div className="taskbar">
      <div className="taskbar-head">
        <button className="taskbar-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '▾' : '▴'}
        </button>
        <span className="taskbar-title">
          {rows.length ? `传输任务 ${rows.length} 项` : '传输已完成'}
        </span>
        {rows.length > 0 && (
          <span className="taskbar-progress">
            <span className="taskbar-progress-fill" style={{ width: `${avg}%` }} />
          </span>
        )}
        {rows.length > 0 && <span className="taskbar-pct">{avg}%</span>}
        {rows.length > 0 && (
          <span className="taskbar-elapsed">已用时 {formatElapsed(elapsed)}</span>
        )}
        {error && (
          <span className="taskbar-error" onClick={() => setError(null)}>
            {error} ✕
          </span>
        )}
        <span className="footer-spacer" />
        {!rows.length && (
          <button className="ico" onClick={() => setShowDone(false)}>
            关闭
          </button>
        )}
        <button className="ico" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起' : '详情'}
        </button>
      </div>

      {expanded && rows.length > 0 && (
        <div className="taskbar-list">
          {rows.map((row) => (
            <div className="task-item" key={`${row.kind}:${row.id}`}>
              <span className="task-kind">{KIND_TEXT[row.kind]}</span>
              <span className="task-name" title={row.name}>
                {row.name}
              </span>
              <span className="task-state">{STATE_TEXT[row.state] ?? row.status}</span>
              <span className="task-bar">
                <span className="task-bar-fill" style={{ width: `${clamp(row.progress)}%` }} />
              </span>
              <span className="task-pct">{Math.round(clamp(row.progress))}%</span>
              <span className="task-actions">
                {CANCELABLE_STATES.includes(row.state) && (
                  <button className="ico" onClick={() => void cancel(row)}>
                    取消
                  </button>
                )}
                {row.state === TaskState.Failed && (
                  <button className="ico" onClick={() => void retry(row)}>
                    重试
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
