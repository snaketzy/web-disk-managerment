import { useRef, useState } from 'react'
import { md5File } from '../utils/md5'

export interface ReuseInput {
  filename: string
  size: number
  md5: string
}

const GB = 1024 ** 3
const fmtGB = (bytes: number) => `${(bytes / GB).toFixed(3).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')} GB`

/** 「粘贴 MD5 秒传」弹窗：文件名 + MD5（可载入本地文件自动算 MD5 与大小） */
export default function ReuseMd5Dialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void
  onConfirm: (v: ReuseInput) => void
}) {
  const [filename, setFilename] = useState('')
  const [md5, setMd5] = useState('')
  const [size, setSize] = useState(0)
  const [sizeText, setSizeText] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadFile = async (files: FileList) => {
    const file = files[0]
    if (!file) return
    setBusy(true)
    setMsg('计算 MD5… 0%')
    try {
      const hash = await md5File(file, (r) => setMsg(`计算 MD5… ${Math.round(r * 100)}%`))
      setFilename(file.name)
      setSize(file.size)
      setSizeText((file.size / GB).toFixed(3))
      setMd5(hash)
      setMsg(`已载入：${file.name}（${fmtGB(file.size)}）`)
    } catch {
      setMsg('计算 MD5 失败')
    } finally {
      setBusy(false)
    }
  }

  const md5Valid = /^[0-9a-f]{32}$/i.test(md5.trim())
  const canSubmit = !!filename.trim() && md5Valid && size > 0 && !busy

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">粘贴 MD5 秒传</div>

        <label className="modal-label">文件名</label>
        <div className="modal-input-row">
          <input
            className="modal-input"
            value={filename}
            placeholder="例如 Unforgiven.1992...mkv"
            onChange={(e) => setFilename(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            title="载入本地文件并计算 MD5"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            检索MD5
          </button>
        </div>

        <label className="modal-label modal-label-space">MD5</label>
        <input
          className="modal-input"
          value={md5}
          placeholder="32 位 MD5，可点「检索MD5」载入本地文件自动填写"
          onChange={(e) => setMd5(e.target.value.trim())}
        />

        <label className="modal-label modal-label-space">文件大小（GB）</label>
        <input
          className="modal-input"
          type="number"
          step="0.001"
          value={sizeText}
          placeholder="载入本地文件后自动填充（GB）"
          onChange={(e) => {
            const v = e.target.value
            setSizeText(v)
            setSize(v ? Math.round(Number(v) * GB) : 0)
          }}
        />

        {msg && <div className="modal-hint">{msg}</div>}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={() => onConfirm({ filename: filename.trim(), size, md5: md5.trim().toLowerCase() })}
          >
            确定
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) void loadFile(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
