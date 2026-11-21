import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
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
