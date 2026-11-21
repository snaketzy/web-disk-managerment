import { useEffect, useRef, useState } from 'react'
import { useAuth115QrcodeQuery, useLazyAuth115StatusQuery } from '../features/fs/api'

const STATUS_TEXT: Record<number, string> = {
  0: '请用 115 App 扫描二维码',
  1: '已扫描，请在手机上点击确认登录',
  2: '登录成功，正在写入令牌…',
  [-1]: '二维码已过期，请点击「刷新二维码」',
  [-2]: '已取消登录，请重新扫码',
}

export default function QrLoginDialog({
  source,
  onSuccess,
  onClose,
}: {
  source: string
  onSuccess: (token: string, source: string) => void
  onClose: () => void
}) {
  // 二维码是一次性的且会过期，必须每次打开都重新获取，不能复用 RTK Query 缓存
  const { data: qrRes, isFetching, refetch } = useAuth115QrcodeQuery(source, {
    refetchOnMountOrArgChange: true,
  })
  const [triggerStatus] = useLazyAuth115StatusQuery()
  const qr = qrRes?.code === 200 ? qrRes.data : undefined
  const [status, setStatus] = useState<number | undefined>()
  const [settled, setSettled] = useState(false)
  // 父组件每次渲染都会传入新的 onSuccess 引用，用 ref 固定，避免长轮询 effect 被反复重启
  const onSuccessRef = useRef(onSuccess)
  useEffect(() => {
    onSuccessRef.current = onSuccess
  }, [onSuccess])

  // 115 的状态接口是长轮询（约 30s 返回一次），因此串行反复调用，
  // 既不堆积请求，也能在扫码确认后立即推进。
  useEffect(() => {
    if (!qr || settled) return
    let cancelled = false
    const poll = async () => {
      while (!cancelled) {
        const res = await triggerStatus({ uid: qr.uid, time: qr.time, sign: qr.sign })
          .unwrap()
          .catch(() => null)
        if (cancelled) return
        const next = res?.data?.status
        if (next === undefined) continue
        setStatus(next)
        if (next === 2) {
          setSettled(true)
          onSuccessRef.current(qr.uid, qr.source)
          return
        }
        if (next < 0) {
          setSettled(true)
          return
        }
      }
    }
    void poll()
    return () => {
      cancelled = true
    }
  }, [qr, settled, triggerStatus])

  const expired = status !== undefined && status < 0
  const hint =
    qrRes?.code !== 200 && qrRes?.message
      ? qrRes.message
      : status === undefined
        ? '正在获取二维码…'
        : STATUS_TEXT[status]

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal qr-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">115 网盘扫码登录</div>
        <div className="qr-body">
          {isFetching && !qr ? (
            <div className="qr-placeholder">正在获取二维码…</div>
          ) : qr ? (
            <img className="qr-image" src={qr.imageUrl} alt="115 登录二维码" />
          ) : (
            <div className="qr-placeholder">获取二维码失败</div>
          )}
          <div className={expired ? 'qr-status qr-status-warn' : 'qr-status'}>{hint}</div>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setSettled(false)
              setStatus(undefined)
              void refetch()
            }}
          >
            刷新二维码
          </button>
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
