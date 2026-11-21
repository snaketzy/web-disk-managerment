import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3001)
const OPENLIST_URL = (process.env.OPENLIST_URL || 'http://127.0.0.1:5244').replace(/\/+$/, '')
const TOKEN = (process.env.OPENLIST_TOKEN || '').trim()

const app = express()
app.use(express.json({ limit: '16mb' }))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
})

const authHeaders = () => (TOKEN ? { Authorization: TOKEN } : {})

async function parseJson(res) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { code: res.status, message: text || res.statusText }
  }
}

async function olJson(pathname, body) {
  const res = await fetch(OPENLIST_URL + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body ?? {}),
  })
  return { status: res.status, json: await parseJson(res) }
}

async function olPut(filePath, buffer) {
  const res = await fetch(OPENLIST_URL + '/api/fs/put', {
    method: 'PUT',
    headers: {
      ...authHeaders(),
      'File-Path': encodeURIComponent(filePath),
      'As-Task': 'false',
      'Content-Type': 'application/octet-stream',
    },
    body: buffer,
  })
  return { status: res.status, json: await parseJson(res) }
}

function buildQuery(query = {}) {
  const entries = Object.entries(query).filter(([, v]) => v !== undefined && v !== null)
  if (!entries.length) return ''
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()
}

async function olGetJson(pathname, query = {}) {
  const res = await fetch(OPENLIST_URL + pathname + buildQuery(query), { headers: authHeaders() })
  return { status: res.status, json: await parseJson(res) }
}

async function olPostQuery(pathname, query = {}) {
  const res = await fetch(OPENLIST_URL + pathname + buildQuery(query), {
    method: 'POST',
    headers: authHeaders(),
  })
  return { status: res.status, json: await parseJson(res) }
}

const joinPath = (dir, name) => `${String(dir).replace(/\/+$/, '')}/${name}` || '/'

const parentDir = (p) => {
  const parts = String(p || '').replace(/\/+$/, '').split('/')
  parts.pop()
  return parts.join('/') || '/'
}

const baseName = (p) => String(p || '').replace(/\/+$/, '').split('/').pop() || ''

function fail(res, e, code = 502) {
  res.status(code).json({ code, message: String(e?.message || e) })
}

// ---- 配置 & 存储列表 -----------------------------------------------------

app.get('/api/config', (_req, res) => {
  res.json({ openlistUrl: OPENLIST_URL, hasToken: !!TOKEN })
})

app.get('/api/storages', async (_req, res) => {
  try {
    const { json } = await olJson('/api/fs/list', { path: '/', page: 1, per_page: 0, refresh: false })
    let storages = (json.data?.content || [])
      .filter((i) => i.is_dir)
      .map((i) => ({ name: i.name, path: '/' + i.name }))

    // 兜底：若根目录下没有挂载（存储挂在了子路径），改用管理端存储列表
    if (!storages.length && TOKEN) {
      const admin = await olGetJson('/api/admin/storage/list')
      const list = admin.json.data?.content || []
      const seen = new Set()
      storages = list
        .filter((s) => typeof s.mount_path === 'string' && s.mount_path.startsWith('/'))
        .map((s) => ({ name: s.mount_path.replace(/^\//, '') || '-', path: s.mount_path }))
        .filter((s) => !seen.has(s.path) && seen.add(s.path))
    }

    res.json({ code: 200, message: 'success', storages })
  } catch (e) {
    fail(res, e)
  }
})

// ---- 文件系统 -------------------------------------------------------------

app.get('/api/fs/list', async (req, res) => {
  try {
    const { status, json } = await olJson('/api/fs/list', {
      path: String(req.query.path || '/'),
      page: 1,
      per_page: 0,
      refresh: req.query.refresh === '1',
    })
    res.status(status).json(json)
  } catch (e) {
    fail(res, e)
  }
})

app.get('/api/fs/get', async (req, res) => {
  try {
    const { status, json } = await olJson('/api/fs/get', { path: String(req.query.path || '/') })
    const raw = json.data?.raw_url
    if (typeof raw === 'string' && raw.startsWith('/')) json.data.raw_url = OPENLIST_URL + raw
    res.status(status).json(json)
  } catch (e) {
    fail(res, e)
  }
})

const forward = (pathname) => async (req, res) => {
  try {
    const { status, json } = await olJson(pathname, req.body)
    res.status(status).json(json)
  } catch (e) {
    fail(res, e)
  }
}

app.post('/api/fs/mkdir', forward('/api/fs/mkdir'))
app.post('/api/fs/rename', forward('/api/fs/rename'))
app.post('/api/fs/remove', forward('/api/fs/remove'))
app.post('/api/fs/copy', forward('/api/fs/copy'))
app.post('/api/fs/move', forward('/api/fs/move'))

app.post('/api/fs/newfile', async (req, res) => {
  const filePath = req.body?.path
  if (!filePath) return fail(res, new Error('path required'), 400)
  try {
    const { status, json } = await olPut(filePath, Buffer.alloc(0))
    res.status(status).json(json)
  } catch (e) {
    fail(res, e)
  }
})

app.post('/api/fs/upload', upload.single('file'), async (req, res) => {
  const dir = String(req.body?.dir || '/')
  const name = String(req.body?.name || req.file?.originalname || '')
  if (!req.file || !name) return fail(res, new Error('file & name required'), 400)
  try {
    const { status, json } = await olPut(joinPath(dir, name), req.file.buffer)
    res.status(status).json(json)
  } catch (e) {
    fail(res, e)
  }
})

// ---- OpenList 管理端（存储挂载） -----------------------------------------
// 注意：这些接口需要管理员令牌（admin token），非管理员令牌会返回 401/403

app.get('/api/admin/storages', async (_req, res) => {
  try {
    const { status, json } = await olGetJson('/api/admin/storage/list')
    res.status(status).json(json)
  } catch (e) {
    fail(res, e)
  }
})

app.get('/api/admin/drivers', async (_req, res) => {
  try {
    const { status, json } = await olGetJson('/api/admin/driver/list')
    res.status(status).json(json)
  } catch (e) {
    fail(res, e)
  }
})

app.get('/api/admin/driver-info', async (req, res) => {
  try {
    const { status, json } = await olGetJson('/api/admin/driver/info', { driver: req.query.driver })
    res.status(status).json(json)
  } catch (e) {
    fail(res, e)
  }
})

app.post('/api/admin/storage/create', forward('/api/admin/storage/create'))
app.post('/api/admin/storage/update', forward('/api/admin/storage/update'))

app.post('/api/admin/storage/delete', async (req, res) => {
  try {
    const { status, json } = await olPostQuery('/api/admin/storage/delete', { id: req.query.id })
    res.status(status).json(json)
  } catch (e) {
    fail(res, e)
  }
})

app.post('/api/admin/storage/toggle', async (req, res) => {
  try {
    const enable = req.query.enable === '1' || req.query.enable === 'true'
    const path = enable ? '/api/admin/storage/enable' : '/api/admin/storage/disable'
    const { status, json } = await olPostQuery(path, { id: req.query.id })
    res.status(status).json(json)
  } catch (e) {
    fail(res, e)
  }
})

// ---- 网盘扫码授权（115 官方二维码接口代理） ------------------------------
// 115 的扫码登录分三步：取二维码令牌 -> 轮询扫码状态 -> 由 OpenList 驱动用令牌换 Cookie

const QR_115_SOURCES = new Set(['web', 'android', 'ios', 'tv', 'alipaymini', 'wechatmini', 'qandroid'])
const UA_115 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

app.get('/api/auth/115/qrcode', async (req, res) => {
  try {
    const source = QR_115_SOURCES.has(String(req.query.source)) ? String(req.query.source) : 'web'
    const upstream = await fetch(`https://qrcodeapi.115.com/api/1.0/${source}/1.0/token/`, {
      headers: { 'User-Agent': UA_115 },
      signal: AbortSignal.timeout(20000),
    })
    const json = await parseJson(upstream)
    const data = json?.data
    if (!data?.uid) {
      res.status(502).json({ code: 502, message: json?.message || '获取 115 二维码失败' })
      return
    }
    res.json({
      code: 200,
      data: {
        uid: data.uid,
        time: data.time,
        sign: data.sign,
        source,
        imageUrl: `https://qrcodeapi.115.com/api/1.0/${source}/1.0/qrcode?uid=${encodeURIComponent(data.uid)}`,
      },
    })
  } catch (e) {
    fail(res, e)
  }
})

app.get('/api/auth/115/status', async (req, res) => {
  try {
    const { uid, time, sign } = req.query
    if (!uid || !time || !sign) return fail(res, new Error('uid & time & sign required'), 400)
    const query = new URLSearchParams({ uid, time, sign, _: String(Math.floor(Date.now() / 1000)) })
    // 该接口是长轮询：无状态变化时会挂起约 30s 后返回空 data，因此超时需留足余量
    const upstream = await fetch(`https://qrcodeapi.115.com/get/status/?${query}`, {
      headers: { 'User-Agent': UA_115 },
      signal: AbortSignal.timeout(40000),
    })
    const json = await parseJson(upstream)
    // status: 0 待扫码 / 1 已扫码待确认 / 2 已确认 / -1 已过期 / -2 已取消
    // data 为空表示本轮长轮询内状态未变化，按「继续等待」返回
    const status = json?.data?.status
    res.json({
      code: 200,
      data: { status: typeof status === 'number' ? status : 0, msg: json?.data?.msg || '' },
    })
  } catch (e) {
    fail(res, e)
  }
})

// ---- 传输任务（复制 / 移动 在 OpenList 侧是异步任务） ----------------------
// fs/copy、fs/move 一定异步执行并返回任务列表，进度/取消/重试都走 /api/task/<kind>/*

const TASK_KINDS = new Set(['copy', 'move', 'upload', 'decompress', 'decompress_upload'])
const TASK_GET_ACTIONS = new Set(['undone', 'done'])
const TASK_POST_ACTIONS = new Set(['info', 'cancel', 'delete', 'retry'])

app.get('/api/task/:kind/:action', async (req, res) => {
  const { kind, action } = req.params
  if (!TASK_KINDS.has(kind) || !TASK_GET_ACTIONS.has(action)) {
    return fail(res, new Error('unsupported task query'), 400)
  }
  try {
    const { status, json } = await olGetJson(`/api/task/${kind}/${action}`)
    res.status(status).json(json)
  } catch (e) { fail(res, e) }
})

app.post('/api/task/:kind/:action', async (req, res) => {
  const { kind, action } = req.params
  if (!TASK_KINDS.has(kind) || !TASK_POST_ACTIONS.has(action)) {
    return fail(res, new Error('unsupported task action'), 400)
  }
  try {
    const { status, json } = await olPostQuery(`/api/task/${kind}/${action}`, req.query)
    res.status(status).json(json)
  } catch (e) { fail(res, e) }
})

// ---- 123 云盘「秒传」（按 MD5 复用，绕过 10GB 单文件上限） -------------------
// 秒传原理：123 开放平台 create 接口带 etag(md5) 调用，若服务端已存在同 md5 的文件
// 则返回 reuse=true，只加引用、不传字节，因此不受「新上传文件」的 10GB 大小限制。
// 限制：etag 只接受 MD5（sha1 会返回 The Etag value is invalid）。

const PAN123_BASE = 'https://open-api.123pan.com'
const PAN123_HEADERS = () => ({ 'Content-Type': 'application/json', Platform: 'open_platform' })

async function pan123Token(clientId, clientSecret) {
  const res = await fetch(`${PAN123_BASE}/api/v1/access_token`, {
    method: 'POST',
    headers: PAN123_HEADERS(),
    body: JSON.stringify({ clientID: clientId, clientSecret: clientSecret }),
  })
  const json = await parseJson(res)
  if (json.code !== 0 || !json.data?.accessToken) throw new Error(json.message || '获取 123 访问令牌失败')
  return json.data.accessToken
}

async function pan123List(token, parentId) {
  const query = new URLSearchParams({
    parentFileId: String(parentId),
    limit: '100',
    page: '1',
    orderBy: 'filename',
    orderDirection: 'asc',
  })
  const res = await fetch(`${PAN123_BASE}/api/v1/file/list?${query}`, {
    headers: { Platform: 'open_platform', Authorization: `Bearer ${token}` },
  })
  const json = await parseJson(res)
  if (json.code !== 0) throw new Error(json.message || '列出 123 目录失败')
  return json.data?.fileList || []
}

// 把挂载下的相对路径逐级解析成 123 的目录 fileID（根为 0）
async function pan123ResolveParent(token, segments) {
  let pid = 0
  for (const seg of segments) {
    const list = await pan123List(token, pid)
    const hit = list.find((i) => i.filename === seg && i.type === 1)
    if (!hit) throw new Error(`123 上找不到目录：${seg}`)
    pid = hit.fileID ?? hit.fileId
  }
  return pid
}

async function reuseToPan123({ dstMount, dstDir, filename, size, md5 }) {
  const { json } = await olGetJson('/api/admin/storage/list')
  const rec = (json.data?.content || []).find((s) => s.mount_path === dstMount)
  if (!rec) throw new Error(`目标挂载不存在：${dstMount}`)
  if (rec.driver !== '123 Open') throw new Error(`目标挂载不是「123 开放平台」驱动（当前：${rec.driver}）`)
  let addition = {}
  try {
    addition = JSON.parse(rec.addition || '{}')
  } catch {
    /* ignore */
  }
  const { ClientID, ClientSecret } = addition
  if (!ClientID || !ClientSecret) throw new Error('目标 123 挂载缺少 ClientID / ClientSecret')

  const token = await pan123Token(ClientID, ClientSecret)
  const mountSegs = dstMount.split('/').filter(Boolean)
  const allSegs = String(dstDir || '/').split('/').filter(Boolean)
  const parentId = await pan123ResolveParent(token, allSegs.slice(mountSegs.length))

  const res = await fetch(`${PAN123_BASE}/upload/v1/file/create`, {
    method: 'POST',
    headers: { ...PAN123_HEADERS(), Authorization: `Bearer ${token}` },
    body: JSON.stringify({ parentFileId: parentId, filename, etag: md5, size: Number(size) }),
  })
  const out = await parseJson(res)
  if (out.code !== 0) throw new Error(out.message || '123 秒传请求失败')
  if (!out.data?.reuse) return { reuse: false, message: '123 上不存在该文件，无法秒传（普通上传会超 10GB 上限）' }

  // 秒传绕过了 OpenList，直接在 123 上建了文件；OpenList 会缓存目录列表，
  // 这里主动 refresh 一次，否则前端刷新时仍拿到旧（看起来是空）的列表
  try {
    await olJson('/api/fs/list', { path: dstDir || '/', page: 1, per_page: 0, refresh: true })
  } catch {
    /* 刷新缓存失败不影响秒传结果 */
  }
  return { reuse: true, fileId: out.data.fileId ?? out.data.fileID }
}

// 远程源文件：无现成 md5 时，经 OpenList 流式下载并边读边算 md5（不落盘）
async function md5OfRemoteFile(filePath, onProgress) {
  const { json } = await olJson('/api/fs/get', { path: filePath })
  if (json.code !== 200) throw new Error(json.message || '获取源文件信息失败')
  const raw = json.data?.raw_url
  if (!raw) throw new Error('无法获取源文件下载地址')
  const url = raw.startsWith('/') ? OPENLIST_URL + raw : raw
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok || !res.body) throw new Error(`下载源文件失败：HTTP ${res.status}`)
  const hash = crypto.createHash('md5')
  let read = 0
  for await (const chunk of res.body) {
    hash.update(chunk)
    read += chunk.length
    onProgress?.(read)
  }
  return hash.digest('hex')
}

const reuseJobs = new Map()

app.post('/api/reuse/local', async (req, res) => {
  const { dstMount, dstDir, filename, size, md5 } = req.body || {}
  if (!dstMount || !filename || !size || !md5) return fail(res, new Error('参数不完整'), 400)
  try {
    const out = await reuseToPan123({ dstMount, dstDir, filename, size, md5 })
    res.json({ code: out.reuse ? 200 : 409, message: out.reuse ? '秒传成功' : out.message })
  } catch (e) {
    fail(res, e)
  }
})

async function runRemoteReuse(job, { srcPath, dstMount, dstDir }) {
  const dir = parentDir(srcPath)
  const name = baseName(srcPath)
  const { json } = await olJson('/api/fs/list', { path: dir, page: 1, per_page: 0, refresh: false })
  const item = (json.data?.content || []).find((i) => i.name === name)
  if (!item) throw new Error('源文件不存在')
  if (item.is_dir) throw new Error('暂不支持目录秒传，请选择单个文件')

  const size = item.size
  let md5 = item.hash_info?.md5 || item.hashinfo?.md5 || ''
  if (!md5) {
    job.message = '读取源文件计算 MD5…'
    md5 = await md5OfRemoteFile(srcPath, (read) => {
      job.progress = size ? Math.min(0.99, read / size) : 0
    })
  }
  job.message = '提交 123 秒传…'
  const out = await reuseToPan123({ dstMount, dstDir, filename: name, size, md5 })
  job.result = out
  job.progress = 1
  job.state = 'done'
  job.message = out.reuse ? '秒传成功' : out.message
}

app.post('/api/reuse/remote', async (req, res) => {
  const { srcPath, dstMount, dstDir } = req.body || {}
  if (!srcPath || !dstMount) return fail(res, new Error('参数不完整'), 400)
  const jobId = crypto.randomUUID()
  const job = { state: 'running', progress: 0, message: '准备中…', result: null }
  reuseJobs.set(jobId, job)
  runRemoteReuse(job, { srcPath, dstMount, dstDir: dstDir || '/' }).catch((e) => {
    job.state = 'error'
    job.message = String(e?.message || e)
  })
  res.json({ code: 200, message: 'success', data: { jobId } })
})

app.get('/api/reuse/remote/:id', (req, res) => {
  const job = reuseJobs.get(req.params.id)
  if (!job) return fail(res, new Error('任务不存在或已过期'), 404)
  res.json({ code: 200, message: 'success', data: job })
})

// ---- 123 云盘「生成直链」 --------------------------------------------------
// 把挂载内的文件路径解析成 123 的 fileID，再调开放平台 /api/v1/direct-link/url。
// 前提：账号已开通直链空间（VIP），且该文件夹已在 123 官网启用直链空间。

// 找到路径所属的 123 挂载，并取出其客户端密钥（取匹配到的最长挂载路径）
async function pan123CredsForPath(filePath) {
  const { json } = await olGetJson('/api/admin/storage/list')
  const records = (json.data?.content || []).filter(
    (s) => s.driver === '123 Open' && typeof s.mount_path === 'string' && s.mount_path.startsWith('/'),
  )
  const norm = (p) => String(p).replace(/\/+$/, '') || '/'
  const rec = records
    .filter((s) => {
      const m = norm(s.mount_path)
      return filePath === m || (m !== '/' && filePath.startsWith(m + '/'))
    })
    .sort((a, b) => norm(b.mount_path).length - norm(a.mount_path).length)[0]
  if (!rec) throw new Error('该路径不在任何「123 开放平台」挂载下')

  let addition = {}
  try {
    addition = JSON.parse(rec.addition || '{}')
  } catch {
    /* ignore */
  }
  const { ClientID, ClientSecret } = addition
  if (!ClientID || !ClientSecret) throw new Error('该 123 挂载缺少 ClientID / ClientSecret')
  return { mount: rec.mount_path, ClientID, ClientSecret }
}

// 逐级解析出文件在其父目录下的 fileID
async function pan123FileId(token, segments) {
  if (!segments.length) throw new Error('请选择文件')
  const name = segments[segments.length - 1]
  const parentId = await pan123ResolveParent(token, segments.slice(0, -1))
  const list = await pan123List(token, parentId)
  const hit = list.find((i) => i.filename === name)
  if (!hit) throw new Error(`123 上找不到文件：${name}`)
  if (hit.type === 1) throw new Error('目录不支持生成直链')
  return hit.fileID ?? hit.fileId
}

async function pan123DirectLink(filePath) {
  const { mount, ClientID, ClientSecret } = await pan123CredsForPath(filePath)
  const mountSegs = mount.split('/').filter(Boolean)
  const allSegs = String(filePath).split('/').filter(Boolean)
  const token = await pan123Token(ClientID, ClientSecret)
  const fileId = await pan123FileId(token, allSegs.slice(mountSegs.length))
  const res = await fetch(`${PAN123_BASE}/api/v1/direct-link/url?fileID=${fileId}`, {
    headers: {
      'Content-Type': 'application/json',
      Platform: 'open_platform',
      Authorization: `Bearer ${token}`,
    },
  })
  const out = await parseJson(res)
  if (out.code !== 0) throw new Error(out.message || '获取 123 直链失败')
  const url = out.data?.url
  if (typeof url !== 'string' || !url) throw new Error('123 未返回有效直链')
  return url
}

app.get('/api/pan123/direct-link', async (req, res) => {
  const filePath = String(req.query.path || '')
  if (!filePath) return fail(res, new Error('path required'), 400)
  try {
    const url = await pan123DirectLink(filePath)
    res.json({ code: 200, message: 'success', data: { url } })
  } catch (e) {
    fail(res, e)
  }
})

// ---- 生产环境托管前端静态资源 --------------------------------------------

const distDir = path.resolve(__dirname, '../dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`[web-disk-managerment] server on http://127.0.0.1:${PORT}`)
  console.log(`[web-disk-managerment] OpenList -> ${OPENLIST_URL} (token: ${TOKEN ? 'set' : 'empty'})`)
})
