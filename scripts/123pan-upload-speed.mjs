// 123云盘 开放平台 上传测速脚本
// 用法: node scripts/123pan-upload-speed.mjs [文件大小MB] [并发数]
// 例:   node scripts/123pan-upload-speed.mjs 64 4
import 'dotenv/config'
import crypto from 'node:crypto'

const BASE = 'https://open-api.123pan.com'
const PLATFORM = 'open_platform'

const CLIENT_ID = process.env.client_id || process.env.CLIENT_ID || ''
const CLIENT_SECRET = process.env.client_secret || process.env.CLIENT_SECRET || ''

const sizeMB = Number(process.argv[2] || 64)
const concurrency = Math.max(1, Number(process.argv[3] || 4))

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('缺少 client_id / client_secret，请检查 .env')
  process.exit(1)
}

async function api(path, body, token) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Platform: PLATFORM,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { code: res.status, message: text }
  }
}

function rate(bytes, ms) {
  const mbps = bytes / 1024 / 1024 / (ms / 1000)
  const mbit = (bytes * 8) / 1e6 / (ms / 1000)
  return `${mbps.toFixed(2)} MB/s  (${mbit.toFixed(1)} Mbps)`
}

async function getToken() {
  const json = await api('/api/v1/access_token', {
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
  })
  if (json.code !== 0) throw new Error(`获取 token 失败: ${json.code} ${json.message}`)
  return json.data.accessToken
}

async function main() {
  const size = Math.round(sizeMB * 1024 * 1024)
  console.log(`准备测试数据: ${sizeMB} MB，分片并发: ${concurrency}`)

  // 随机内容，避免命中「秒传」(reuse)
  const data = crypto.randomBytes(size)
  const etag = crypto.createHash('md5').update(data).digest('hex')
  const filename = `speedtest_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.bin`

  const t0 = Date.now()
  const token = await getToken()
  console.log(`1) 获取 access_token 成功 (${Date.now() - t0} ms)`)

  const created = await api(
    '/upload/v1/file/create',
    { parentFileId: 0, filename, etag, size },
    token,
  )
  if (created.code !== 0) throw new Error(`创建文件失败: ${created.code} ${created.message}`)
  if (process.env.DEBUG === '1') console.log('   create resp:', JSON.stringify(created))
  const d = created.data
  const fileId = d.fileId ?? d.fileID
  const preuploadID = d.preuploadID
  const sliceSize = d.sliceSize
  console.log(
    `2) 创建文件成功 fileId=${fileId} sliceSize=${(sliceSize / 1024 / 1024).toFixed(1)} MB reuse=${d.reuse}`,
  )

  if (d.reuse) {
    console.log('命中秒传，无需上传（随机数据不应出现该情况）')
    return
  }

  const totalSlices = Math.ceil(size / sliceSize)
  console.log(`3) 开始上传，共 ${totalSlices} 个分片`)

  let uploaded = 0
  let next = 0
  const upStart = Date.now()
  const lastLog = { t: 0 }

  async function putSlice(i, chunk) {
    let lastErr
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const urlRes = await api(
          '/upload/v1/file/get_upload_url',
          { preuploadID, sliceNo: i + 1 },
          token,
        )
        if (urlRes.code !== 0) throw new Error(`获取上传地址失败: ${urlRes.code} ${urlRes.message}`)
        const put = await fetch(urlRes.data.presignedURL, { method: 'PUT', body: chunk })
        if (!put.ok) throw new Error(`HTTP ${put.status}`)
        return
      } catch (e) {
        lastErr = e
        await new Promise((r) => setTimeout(r, 500 * attempt))
      }
    }
    throw lastErr
  }

  async function worker() {
    while (true) {
      const i = next++
      if (i >= totalSlices) return
      const start = i * sliceSize
      const end = Math.min(start + sliceSize, size)
      const chunk = data.subarray(start, end)

      await putSlice(i, chunk)

      uploaded += chunk.length
      const now = Date.now()
      if (now - lastLog.t > 500 || uploaded >= size) {
        lastLog.t = now
        const pct = ((uploaded / size) * 100).toFixed(1)
        process.stdout.write(
          `\r   进度 ${pct}%  ${rate(uploaded, now - upStart)}   `,
        )
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))
  const upMs = Date.now() - upStart
  process.stdout.write('\n')
  console.log(`4) 分片上传完成，用时 ${(upMs / 1000).toFixed(2)} s`)
  console.log(`   >>> 上传速度: ${rate(size, upMs)}`)

  const complete = await api('/upload/v1/file/upload_complete', { preuploadID }, token)
  if (complete.code !== 0) throw new Error(`上传完毕失败: ${complete.code} ${complete.message}`)
  let result = complete.data || {}
  if (process.env.DEBUG === '1') console.log('   complete resp:', JSON.stringify(result))
  let poll = 0
  while (!result.completed && poll < 60) {
    await new Promise((r) => setTimeout(r, 1500))
    const asyncRes = await api('/upload/v1/file/upload_async_result', { preuploadID }, token)
    if (asyncRes.code === 0 && asyncRes.data) result = asyncRes.data
    poll++
  }
  console.log(`5) 服务端合并完成 completed=${result.completed} total=${((Date.now() - t0) / 1000).toFixed(1)}s`)

  // 清理：删除本次及历史遗留的 speedtest_* 测试文件（移入回收站）
  try {
    const listRes = await fetch(
      `${BASE}/api/v1/file/list?parentFileId=0&limit=100&page=1&orderBy=filename&orderDirection=asc`,
      { headers: { Authorization: `Bearer ${token}`, Platform: PLATFORM } },
    )
    const listJson = await listRes.json()
    const files = (listJson.data?.fileList || []).filter((f) => f.filename?.startsWith('speedtest_'))
    if (!files.length) {
      console.log('6) 清理测试文件: 无残留')
    } else {
      // 注意：v1 列表返回的字段是 fileID（大写 D）
      const ids = files.map((f) => f.fileID ?? f.fileId)
      const del = await api('/api/v1/file/trash', { fileIds: ids }, token)
      console.log(
        `6) 清理测试文件: ${del.code === 0 ? `已删除 ${files.length} 个` : `${del.code} ${del.message}`}`,
      )
    }
  } catch (e) {
    console.log(`6) 清理测试文件失败(可忽略): ${e.message}`)
  }
}

main().catch((e) => {
  console.error('\n测试失败:', e.message)
  process.exit(1)
})
