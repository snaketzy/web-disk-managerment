import { useEffect, useMemo, useState } from 'react'
import {
  useAdminStoragesQuery,
  useCreateStorageMutation,
  useDeleteStorageMutation,
  useDriverInfoQuery,
  useDriversQuery,
  useToggleStorageMutation,
  useUpdateStorageMutation,
} from '../features/fs/api'
import type { DriverField, StorageRecord } from '../types'
import { usePrompt } from '../ui/PromptDialog'
import QrLoginDialog from './QrLoginDialog'

type MountTemplateId = 'cos' | 'r2' | '115' | 'baidu' | 'quark' | '123open'

// 115 扫码登录支持的客户端来源，需与后端 /api/auth/115/qrcode 的白名单一致
const QR_SOURCES = ['web', 'android', 'ios', 'tv', 'alipaymini', 'wechatmini', 'qandroid']

// 需要借官方授权页换取 refresh_token 的驱动
// 注意：夸克 QuarkOpen 不在其中——它要求自备夸克开放平台的 AppID/SignKey，
// 官方页「使用 OpenList 提供的参数」拿到的令牌与该 AppID 不匹配，无法通过签名校验。
const OAUTH_DRIVERS: Record<string, 'baidu'> = {
  BaiduNetdisk: 'baidu',
}

interface MountTemplate {
  id: MountTemplateId
  title: string
  description: string
  keywords: string[]
  candidates: string[]
  fields: DriverField[]
  defaults: Record<string, string>
  note?: string
}

const OPTION_FALLBACK: DriverField[] = [
  { name: 'mount_path', type: 'string', required: true, help: '挂载路径，例如 /cos 或 /115' },
  { name: 'order', type: 'number', default: 0 },
  { name: 'cache_expiration', type: 'number', default: 30 },
  { name: 'status', type: 'select', options: 'work,disabled', default: 'work' },
  { name: 'remark', type: 'string' },
]

const S3_FIELDS: DriverField[] = [
  { name: 'endpoint', type: 'string', required: true, help: 'S3 兼容 endpoint，例如 https://cos.ap-shanghai.myqcloud.com 或 https://<accountid>.r2.cloudflarestorage.com' },
  { name: 'access_key_id', type: 'string', required: true, help: 'Access Key ID / SecretId' },
  { name: 'secret_access_key', type: 'string', required: true, help: 'Secret Access Key / SecretKey' },
  { name: 'bucket', type: 'string', required: true, help: 'Bucket 名称' },
  { name: 'region', type: 'string', help: 'COS 填地域，例如 ap-shanghai；R2 可填 auto 或 us-east-1' },
  { name: 'root_folder', type: 'string', help: '可选：只挂载 Bucket 下某个前缀目录' },
  { name: 'custom_host', type: 'string', help: '可选：自定义访问域名' },
  { name: 'force_path_style', type: 'bool', default: true, help: 'R2 通常建议开启；COS 若访问异常也可开启' },
]

const SCAN_FIELDS: DriverField[] = [
  { name: 'scan_mode', type: 'string', default: 'qr', help: '扫码类网盘通常由 OpenList 驱动弹出授权/扫码流程；若此处未显示二维码，请先确认管理员 token 可读取驱动字段。' },
  { name: 'root_folder', type: 'string', help: '可选：挂载网盘内的指定目录' },
  { name: 'refresh_token', type: 'text', help: '可选：如果你已经有授权 token，可粘贴；扫码时通常不需要手填。' },
  { name: 'cookie', type: 'text', help: '可选：部分网盘驱动使用 Cookie；扫码时通常不需要手填。' },
]

const TEMPLATES: MountTemplate[] = [
  {
    id: 'cos',
    title: '腾讯云 COS',
    description: '只需要 endpoint、SecretId、SecretKey、Bucket。底层按 S3/COS 兼容驱动创建。',
    keywords: ['cos', 'tencent', 's3'],
    candidates: ['S3', 'Cos', 'COS', 'Tencent COS'],
    fields: S3_FIELDS,
    defaults: { mount_path: '/cos', region: 'ap-shanghai', force_path_style: 'true', remark: '腾讯云 COS' },
    note: 'COS endpoint 示例：https://cos.ap-shanghai.myqcloud.com，Access Key ID 对应 SecretId。',
  },
  {
    id: 'r2',
    title: 'Cloudflare R2',
    description: 'R2 使用 S3 兼容驱动；填写 R2 endpoint、Access Key ID、Secret。',
    keywords: ['r2', 's3', 's3 compatible'],
    candidates: ['S3', 'R2', 'S3 Compatible'],
    fields: S3_FIELDS,
    defaults: { mount_path: '/r2', region: 'auto', force_path_style: 'true', remark: 'Cloudflare R2' },
    note: 'R2 endpoint 示例：https://<accountid>.r2.cloudflarestorage.com。',
  },
  {
    id: '115',
    title: '115 网盘',
    description: '优先使用 OpenList 的 115 扫码/授权驱动；保存后挂载到 /115。',
    keywords: ['115'],
    candidates: ['115 Cloud', '115', '115Open'],
    fields: SCAN_FIELDS,
    defaults: { mount_path: '/115', remark: '115 网盘扫码挂载' },
    note: '115 若当前驱动支持扫码，连接管理员 token 后会显示 OpenList 返回的真实授权字段。',
  },
  {
    id: 'baidu',
    title: '百度网盘',
    description: '使用 OpenList 百度网盘驱动，支持扫码或开放平台授权。',
    keywords: ['baidu', '百度'],
    candidates: ['BaiduNetdisk', 'Baidu Netdisk', '百度网盘'],
    fields: SCAN_FIELDS,
    defaults: { mount_path: '/baidu', remark: '百度网盘' },
    note: '点「打开授权页」登录并授权百度网盘，把页面给出的 refresh token 粘贴到「刷新令牌」。',
  },
  {
    id: 'quark',
    title: '夸克网盘',
    description: '使用 OpenList 夸克驱动（Cookie 方式），登录夸克网页版后复制 Cookie 即可，无需申请开发者应用。',
    keywords: ['quark'],
    candidates: ['Quark'],
    fields: [
      {
        name: 'cookie',
        type: 'text',
        required: true,
        help: 'Chrome 登录 pan.quark.cn 后按 F12 → 网络 → 任选一个请求 → 复制请求头里整段 Cookie',
      },
      { name: 'root_folder_id', type: 'string', default: '0', help: '挂载根目录填 0；只想挂某个子目录就填该目录 ID' },
    ],
    defaults: { mount_path: '/quark', root_folder_id: '0', remark: '夸克网盘' },
    note: '获取 Cookie：用 Chrome 打开并登录 http://pan.quark.cn ，按 F12 打开开发者工具 → 切到「网络」标签 → 随便点一个请求 → 在「请求标头」里找到 Cookie，整段复制粘贴到下面的 Cookie 字段。「根文件夹 ID」保持 0 即可。',
  },
  {
    id: '123open',
    title: '123云盘（开放平台）',
    description: '使用 OpenList 的 123 Open 驱动，走官方 OpenAPI（ClientID/ClientSecret 鉴权），不受网页登录的境外风控限制，海外服务器也能挂载。',
    keywords: ['123 open'],
    candidates: ['123 Open'],
    fields: [
      { name: 'ClientID', type: 'string', required: true, help: '123 云盘开放平台的 ClientID' },
      { name: 'ClientSecret', type: 'text', required: true, help: '123 云盘开放平台的 ClientSecret' },
      { name: 'root_folder_id', type: 'string', default: '0', help: '挂载根目录填 0；只想挂某个子目录就填该目录 ID' },
    ],
    defaults: { mount_path: '/123pan', root_folder_id: '0', remark: '123云盘(开放平台)' },
    note: '在 123 云盘开放平台申请 ClientID / ClientSecret 后填入。该方式走官方 OpenAPI，海外 IP（如 Vultr）不会被「境外登录风险」拦截；若无法登录，请确认账号已开通开发者权益包。',
  },
]

function normalizeDrivers(
  data?: Record<string, unknown> | { name: string; label?: string }[]
): { key: string; label: string }[] {
  if (!data) return []
  if (Array.isArray(data)) return data.map((d) => ({ key: d.name, label: d.label || d.name }))
  // 该接口返回「驱动名 -> 驱动详情对象」的映射，仅当值是非空字符串时才作为展示名
  return Object.entries(data).map(([key, value]) => ({
    key,
    label: typeof value === 'string' && value ? value : key,
  }))
}

function findDriver(
  drivers: { key: string; label: string }[],
  keywords: string[]
): { key: string; label: string } | undefined {
  return drivers.find((driver) => {
    const text = `${driver.key} ${driver.label}`.toLowerCase()
    return keywords.some((keyword) => text.includes(keyword.toLowerCase()))
  })
}

function resolveDriver(
  drivers: { key: string; label: string }[],
  template: MountTemplate
): { key: string; label: string; matched: boolean } {
  const exact = drivers.find((driver) =>
    template.candidates.some((candidate) => driver.key.toLowerCase() === candidate.toLowerCase())
  )
  const fuzzy = exact || findDriver(drivers, template.keywords)
  if (fuzzy) return { ...fuzzy, matched: true }
  const fallback = template.candidates[0]
  return { key: fallback, label: `${fallback}（可手动改）`, matched: false }
}

function parseOptions(options?: string): { value: string; label: string }[] {
  if (!options) return []
  try {
    const parsed = JSON.parse(options)
    if (Array.isArray(parsed)) {
      return parsed.map((o) => {
        if (typeof o === 'string') return { value: o, label: o }
        return {
          value: String(o.value ?? o.name ?? ''),
          label: String(o.label ?? o.value ?? o.name ?? ''),
        }
      })
    }
  } catch {
    /* 非 JSON，按逗号分隔处理 */
  }
  return options
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ value: s, label: s }))
}

const toInputValue = (v: unknown): string =>
  v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)

function coerce(field: DriverField, raw: string): unknown {
  // OpenList 驱动字段的数值类型有 number 与 float 两种，均需转成数字提交
  if (field.type === 'number' || field.type === 'float') {
    const n = Number(raw)
    return Number.isNaN(n) ? 0 : n
  }
  if (field.type === 'bool') return raw === 'true'
  return raw
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: DriverField
  value: string
  onChange: (v: string) => void
}) {
  const options = parseOptions(field.options)
  if (field.type === 'bool') {
    return (
      <select className="form-input" value={value || 'false'} onChange={(e) => onChange(e.target.value)}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    )
  }
  if (options.length) {
    return (
      <select className="form-input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">（默认）</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
  if (field.type === 'text' || field.type === 'json') {
    return (
      <textarea
        className="form-input form-textarea"
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  return (
    <input
      className="form-input"
      type={field.type === 'number' || field.type === 'float' ? 'number' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export default function MountManager() {
  const { confirm } = usePrompt()
  const { data: storagesRes, isFetching: listLoading } = useAdminStoragesQuery()
  const { data: driversRes } = useDriversQuery()
  const [createStorage] = useCreateStorageMutation()
  const [updateStorage] = useUpdateStorageMutation()
  const [deleteStorage] = useDeleteStorageMutation()
  const [toggleStorage] = useToggleStorageMutation()

  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [editing, setEditing] = useState<StorageRecord | null>(null)
  const [driver, setDriver] = useState('')
  const [activeTemplateId, setActiveTemplateId] = useState<MountTemplateId | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)

  const drivers = useMemo(() => normalizeDrivers(driversRes?.data), [driversRes])
  const storages = storagesRes?.data?.content ?? []
  const activeTemplate = useMemo(
    () => TEMPLATES.find((template) => template.id === activeTemplateId) ?? null,
    [activeTemplateId]
  )
  const resolvedTemplates = useMemo(
    () => TEMPLATES.map((template) => ({ template, driver: resolveDriver(drivers, template) })),
    [drivers]
  )

  const { data: infoRes, isFetching: infoLoading } = useDriverInfoQuery(driver, { skip: !driver })
  const openListFieldsLoaded = !!infoRes?.data
  const commonFields = useMemo(() => {
    const list = [...(infoRes?.data?.common ?? [])]
    for (const fb of OPTION_FALLBACK) {
      if (!list.some((f) => f.name === fb.name)) list.push(fb)
    }
    return list.filter((f) => f.name !== 'driver')
  }, [infoRes])
  const additionalFields = useMemo(() => {
    if (infoRes?.data?.additional?.length) return infoRes.data.additional
    return activeTemplate?.fields ?? []
  }, [activeTemplate, infoRes])
  // 驱动带 qrcode_token 字段时（115 Cloud）才提供扫码登录
  const qrSupported = additionalFields.some((f) => f.name === 'qrcode_token')
  const qrSource = QR_SOURCES.includes(values.qrcode_source || '') ? values.qrcode_source : 'web'
  const oauthProvider = OAUTH_DRIVERS[driver]

  const startAuthorize = () => {
    if (!oauthProvider) return
    // 必须在官方页面上完成：/baiduyun/requests 会把 server_use 种在 api.oplist.org 域下，
    // 回调时依赖该 cookie，且接口无 CORS 头，无法由本站代为请求。
    window.open('https://api.oplist.org/', '_blank', 'noopener')
    setMessage(
      [
        '已在新标签页打开 OpenList 官方授权页，请按下面步骤操作：',
        '1. 网盘选「百度网盘 (OAuth2) 验证登录」',
        '2. 打开「使用 OpenList 提供的参数」开关',
        '3. 点「获取 Token」并按提示登录/扫码授权',
        '4. 把页面上生成的 Refresh Token 复制回来，粘贴到「刷新令牌」字段，再点保存',
      ].join('\n')
    )
  }

  useEffect(() => {
    if (mode !== 'form') return
    const sourceCommon = infoRes?.data?.common ?? commonFields
    const sourceAdditional = infoRes?.data?.additional?.length ? infoRes.data.additional : activeTemplate?.fields ?? []
    const all = [...sourceCommon, ...sourceAdditional]
    const commonNames = new Set(sourceCommon.map((f) => f.name))
    let addition: Record<string, unknown> = {}
    if (editing) {
      try {
        addition = JSON.parse(editing.addition || '{}')
      } catch {
        addition = {}
      }
    }
    const next: Record<string, string> = {}
    for (const f of all) {
      let v: unknown
      if (editing) v = commonNames.has(f.name) ? editing[f.name] : addition[f.name]
      if (!editing && activeTemplate) v = activeTemplate.defaults[f.name] ?? v
      if (v === undefined || v === null || v === '') v = f.default
      next[f.name] = toInputValue(v)
    }
    if (next.mount_path === undefined) next.mount_path = editing?.mount_path ?? activeTemplate?.defaults.mount_path ?? ''
    if (next.status === undefined) next.status = editing?.status ?? 'work'
    setValues(next)
  }, [activeTemplate, commonFields, infoRes, mode, editing])

  const startCreate = (targetDriver = driver, templateId: MountTemplateId | null = activeTemplateId) => {
    if (!targetDriver) {
      setMessage('请先选择驱动类型（COS / OSS / 百度网盘 / 夸克 / 115 ...）')
      return
    }
    setDriver(targetDriver)
    setActiveTemplateId(templateId)
    setEditing(null)
    setValues({})
    setMessage(null)
    setMode('form')
  }

  const startEdit = (record: StorageRecord) => {
    setEditing(record)
    setDriver(record.driver)
    setActiveTemplateId(null)
    setValues({})
    setMessage(null)
    setMode('form')
  }

  const submit = async () => {
    if (!driver) return
    setSaving(true)
    setMessage(null)
    try {
      const commonNames = new Set(commonFields.map((f) => f.name))
      const body: Record<string, unknown> = { driver }
      const addition: Record<string, unknown> = {}
      for (const f of [...commonFields, ...additionalFields]) {
        const val = coerce(f, values[f.name] ?? '')
        if (commonNames.has(f.name)) body[f.name] = val
        else addition[f.name] = val
      }
      body.addition = JSON.stringify(addition)
      if (body.order === undefined) body.order = 0
      if (body.cache_expiration === undefined) body.cache_expiration = 30
      if (body.status === undefined) body.status = 'work'
      if (editing) body.id = editing.id

      const res = editing ? await updateStorage(body) : await createStorage(body)
      if ('error' in res) {
        setMessage(editing ? '保存失败，请检查字段配置' : '创建失败，请检查字段配置')
        return
      }
      if (res.data?.code !== 200) {
        setMessage(res.data?.message || '操作失败')
        return
      }
      setMode('list')
      setMessage(editing ? '已保存' : '已创建挂载')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async (record: StorageRecord) => {
    const ok = await confirm({
      title: '删除挂载',
      message: `确定删除挂载「${record.mount_path}」？不会删除网盘中的实际文件。`,
      okText: '删除',
      danger: true,
    })
    if (!ok) return
    const res = await deleteStorage(record.id)
    if ('error' in res || res.data?.code !== 200) setMessage('删除失败')
  }

  const doToggle = async (record: StorageRecord) => {
    const enable = record.status !== 'work'
    const res = await toggleStorage({ id: record.id, enable })
    if ('error' in res || res.data?.code !== 200) setMessage('操作失败')
  }

  if (mode === 'form') {
    return (
      <div className="mount-view">
        <div className="mount-toolbar">
          <button className="ico" onClick={() => setMode('list')}>
            ← 返回列表
          </button>
          <span className="mount-title">
            {editing ? `编辑挂载：${editing.mount_path}` : '新建挂载'}
          </span>
          <label className="driver-key-editor">
            <span>驱动 Key</span>
            <input
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              placeholder="例如 S3 / BaiduNetdisk / Quark / 115"
            />
          </label>
          {qrSupported && (
            <button className="btn btn-primary" onClick={() => setQrOpen(true)}>
              扫码登录
            </button>
          )}
          {oauthProvider && (
            <button className="btn btn-primary" onClick={startAuthorize}>
              获取授权令牌
            </button>
          )}
          <span className="footer-spacer" />
          <button className="btn btn-primary" disabled={saving || infoLoading} onClick={() => void submit()}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>

        {infoLoading && <div className="list-hint">加载驱动配置…</div>}
        {activeTemplate?.note && <div className="mount-info">{activeTemplate.note}</div>}
        {!openListFieldsLoaded && activeTemplate && (
          <div className="mount-warning">
            当前没有拿到 OpenList 返回的真实驱动字段，已使用内置模板。对象存储可直接填 endpoint / id / secret；
            扫码类网盘若没有出现二维码或授权按钮，请先确认 OPENLIST_TOKEN 是管理员 token，或把驱动 Key 改成你当前 OpenList 中的实际名称。
          </div>
        )}

        {!infoLoading && (
          <div className="mount-form">
            <div className="form-section">基础设置</div>
            {commonFields.map((f) => (
              <div className="form-row" key={f.name}>
                <label className="form-label">
                  {f.label || f.name}
                  {f.required && <span className="required">*</span>}
                </label>
                <div className="form-control">
                  <FieldInput
                    field={f}
                    value={values[f.name] ?? ''}
                    onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))}
                  />
                  {f.help && <div className="form-help">{f.help}</div>}
                </div>
              </div>
            ))}

            {additionalFields.length > 0 && <div className="form-section">驱动参数</div>}
            {additionalFields.map((f) => (
              <div className="form-row" key={f.name}>
                <label className="form-label">
                  {f.label || f.name}
                  {f.required && <span className="required">*</span>}
                </label>
                <div className="form-control">
                  <FieldInput
                    field={f}
                    value={values[f.name] ?? ''}
                    onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))}
                  />
                  {f.help && <div className="form-help">{f.help}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {message && <div className="mount-message">{message}</div>}

        {qrOpen && (
          <QrLoginDialog
            source={qrSource}
            onSuccess={(token, source) => {
              setValues((prev) => ({ ...prev, qrcode_token: token, qrcode_source: source }))
              setQrOpen(false)
              setMessage('已获取 115 登录令牌，点击「保存」完成挂载')
            }}
            onClose={() => setQrOpen(false)}
          />
        )}
      </div>
    )
  }

  const adminDenied = storagesRes && storagesRes.code !== 200

  return (
    <div className="mount-view">
      <div className="mount-quick">
        {resolvedTemplates.map(({ template, driver: resolved }) => (
          <div className="quick-card" key={template.id}>
            <div className="quick-title">{template.title}</div>
            <div className="quick-desc">{template.description}</div>
            <div className={resolved.matched ? 'quick-driver matched' : 'quick-driver'}>
              {resolved.matched ? `已匹配驱动：${resolved.label}` : `默认驱动：${resolved.label}`}
            </div>
            <button
              className="btn btn-primary"
              onClick={() => startCreate(resolved.key, template.id)}
            >
              挂载 {template.title}
            </button>
          </div>
        ))}
      </div>

      <div className="mount-toolbar">
        <select
          className="storage-select"
          value={driver}
          onChange={(e) => {
            setDriver(e.target.value)
            setActiveTemplateId(null)
          }}
        >
          <option value="">选择驱动类型…</option>
          {drivers.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={() => startCreate(driver, null)}>
          新建挂载
        </button>
        {message && <span className="mount-message-inline">{message}</span>}
      </div>

      {adminDenied && (
        <div className="mount-warning">
          读取存储列表失败（{storagesRes?.message}）。挂载管理需要 OpenList 的
          <b> 管理员令牌</b>，请确认 .env 中的 OPENLIST_TOKEN 为管理员 token。
        </div>
      )}

      <div className="mount-table">
        <div className="mount-row mount-head">
          <span className="mc-path">挂载路径</span>
          <span className="mc-driver">驱动</span>
          <span className="mc-status">状态</span>
          <span className="mc-remark">备注</span>
          <span className="mc-actions">操作</span>
        </div>
        <div className="mount-rows">
          {listLoading && <div className="list-hint">加载中…</div>}
          {!listLoading && !storages.length && !adminDenied && (
            <div className="list-hint">还没有挂载。请选择驱动类型后点击「新建挂载」。</div>
          )}
          {storages.map((s) => (
            <div className="mount-row" key={s.id}>
              <span className="mc-path">{s.mount_path}</span>
              <span className="mc-driver">{s.driver}</span>
              <span className="mc-status">
                <span className={s.status === 'work' ? 'badge badge-on' : 'badge badge-off'}>
                  {s.status === 'work' ? '启用' : '停用'}
                </span>
              </span>
              <span className="mc-remark">{s.remark}</span>
              <span className="mc-actions">
                <button className="ico" onClick={() => startEdit(s)}>
                  编辑
                </button>
                <button className="ico" onClick={() => void doToggle(s)}>
                  {s.status === 'work' ? '停用' : '启用'}
                </button>
                <button className="ico ico-danger" onClick={() => void doDelete(s)}>
                  删除
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
