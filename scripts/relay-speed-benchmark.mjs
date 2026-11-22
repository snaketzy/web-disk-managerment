// OpenList 中继「复制 / 移动 / 上传」速度基准
// 用法: node scripts/relay-speed-benchmark.mjs [实时采样秒数=15]
// 依赖 .env: OPENLIST_URL / OPENLIST_TOKEN
//
// 说明：跨网盘复制是 OpenList 侧的中继任务（源网盘下载 → 目标网盘上传），
// 速度 = min(源下载, 目标上传, 中继机带宽)。本脚本只读 OpenList 任务列表：
//   - 正在运行的任务：采样两次算实时速度
//   - 已完成的任务：总字节 / 耗时 = 平均速度
import 'dotenv/config'

const BASE = (process.env.OPENLIST_URL || 'http://127.0.0.1:5244').replace(/\/+$/, '')
const TOKEN = (process.env.OPENLIST_TOKEN || '').trim()
const SAMPLE_SEC = Math.max(3, Number(process.argv[2] || 15))
const KINDS = ['copy', 'move', 'upload']

const KIND_CN = { copy: '复制', move: '移动', upload: '上传' }
const STATE_CN = {
  0: '等待中', 1: '传输中', 2: '已完成', 3: '取消中', 4: '已取消',
  5: '出错重试', 6: '失败中', 7: '失败', 8: '等待重试', 9: '准备重试',
}

const mb = (b) => b / 1048576
const done = (t) => (t.progress || 0) * (t.total_bytes || 0)
const rate = (bytes, sec) =>
  sec > 0 ? `${(bytes / 1048576 / sec).toFixed(2)} MB/s (${((bytes * 8) / 1e6 / sec).toFixed(0)} Mbps)` : '-'
const parseTime = (s) => (s ? Date.parse(String(s).replace(/(\.\d{3})\d+/, '$1')) : NaN)

async function ol(path) {
  const res = await fetch(BASE + path, { headers: TOKEN ? { Authorization: TOKEN } : {} })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { code: res.status, message: text }
  }
}

async function listTasks(kind, action) {
  const json = await ol(`/api/task/${kind}/${action}`)
  if (json.code !== 200) throw new Error(`${kind}/${action} 失败: ${json.code} ${json.message}`)
  return json.data || []
}

async function collect(action) {
  const out = []
  for (const kind of KINDS) {
    for (const t of await listTasks(kind, action)) out.push({ kind, ...t })
  }
  return out
}

function line(t) {
  const pct = ((t.progress || 0) * 100).toFixed(1)
  console.log(`  ${KIND_CN[t.kind]} [${STATE_CN[t.state] ?? t.state}] ${t.name}`)
  console.log(`     ${mb(t.total_bytes || 0).toFixed(2)} MB · 进度 ${pct}%${t.error ? ` · ${String(t.error).split('\n')[0].slice(0, 120)}` : ''}`)
}

async function main() {
  console.log(`OpenList: ${BASE}  (token: ${TOKEN ? 'set' : 'empty'})`)

  const running = await collect('undone')
  if (!running.length) {
    console.log('\n当前没有正在运行的复制 / 移动 / 上传任务')
  } else {
    console.log(`\n正在运行 ${running.length} 个任务，采样 ${SAMPLE_SEC}s 计算实时速度…`)
    const before = new Map(running.map((t) => [t.id, done(t)]))
    await new Promise((r) => setTimeout(r, SAMPLE_SEC * 1000))
    const after = await collect('undone')
    if (!after.length) {
      console.log('  （采样期间任务已全部完成）')
    }
    for (const t of after) {
      line(t)
      const b = before.get(t.id)
      console.log(`     实时: ${b == null ? '-' : rate(done(t) - b, SAMPLE_SEC)}`)
    }
  }

  const finished = (await collect('done')).filter((t) => t.end_time && (t.total_bytes || 0) > 0)
  finished.sort((a, b) => parseTime(b.end_time) - parseTime(a.end_time))
  console.log('\n最近完成任务（平均速度 = 总字节 / 耗时）:')
  if (!finished.length) {
    console.log('  （无）')
  }
  for (const t of finished.slice(0, 15)) {
    const sec = (parseTime(t.end_time) - parseTime(t.start_time)) / 1000
    const avg = sec > 1 ? rate(t.total_bytes, sec) : '(耗时过短，无法计算)'
    console.log(`  ${avg.padEnd(26)} ${mb(t.total_bytes).toFixed(2)} MB / ${sec.toFixed(0)}s`)
    console.log(`     ${KIND_CN[t.kind]} [${STATE_CN[t.state] ?? t.state}] ${t.name}`)
  }
}

main().catch((e) => {
  console.error('基准运行失败:', e.message)
  process.exit(1)
})
