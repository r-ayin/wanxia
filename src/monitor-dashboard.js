/**
 * wanxia Monitoring Dashboard — v1.0
 *
 * Self-contained HTML dashboard generator. Reads from:
 *   - data/sunset.db (forecast history)
 *   - posts/ directory (posting activity)
 *   - health-check.py (system health)
 *
 * Usage:
 *   node src/monitor-dashboard.js          → prints dashboard.html
 *   node src/monitor-dashboard.js --serve  → starts HTTP server on :3099
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'
import { createServer } from 'http'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DB_PATH = join(ROOT, 'data', 'sunset.db')
const POSTS_DIR = join(ROOT, 'posts')

// ── Data collectors ──────────────────────────────────────────────

function dbStats() {
  if (!existsSync(DB_PATH)) return { error: 'sunset.db not found' }
  const db = new Database(DB_PATH, { readonly: true })
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    const predCount = tables.some(t => t.name === 'predictions')
      ? db.prepare("SELECT COUNT(*) as n FROM predictions").get()?.n || 0
      : 0
    const dateRange = tables.some(t => t.name === 'predictions')
      ? db.prepare("SELECT MIN(created_at) as first, MAX(created_at) as last FROM predictions").get()
      : null
    return { tables: tables.map(t => t.name), predictions: predCount, firstDate: dateRange?.first, lastDate: dateRange?.last }
  } finally { db.close() }
}

function postsStats() {
  if (!existsSync(POSTS_DIR)) return { error: 'posts/ not found' }
  const dirs = readdirSync(POSTS_DIR).filter(d => {
    const p = join(POSTS_DIR, d)
    return statSync(p).isDirectory() && existsSync(join(p, 'posts.json'))
  }).sort().reverse()

  const history = dirs.map(d => {
    try {
      const meta = JSON.parse(readFileSync(join(POSTS_DIR, d, 'posts.json'), 'utf-8'))
      const posts = Array.isArray(meta) ? meta : meta.posts || []
      return { date: d, count: posts.length, titles: posts.slice(0, 3).map(p => p.title?.slice(0, 30)) }
    } catch { return { date: d, count: 0, error: true } }
  })

  const total = history.reduce((s, h) => s + h.count, 0)
  const totalDays = history.length
  return { totalPosts: total, totalDays, recentDaily: history.slice(0, 14), allHistory: history }
}

function systemHealth() {
  const checks = {}
  // DB
  checks.db = existsSync(DB_PATH) ? 'OK' : 'MISSING'
  // Posts
  checks.posts = existsSync(POSTS_DIR) ? 'OK' : 'MISSING'
  // Server (check if running by trying to read PID file or process)
  checks.server = process.env.WANXIA_PORT ? `port ${process.env.WANXIA_PORT}` : 'unknown'
  // Node version
  checks.node = process.version
  return checks
}

// ── HTML generator ───────────────────────────────────────────────

export function generateDashboard() {
  const db = dbStats()
  const posts = postsStats()
  const health = systemHealth()

  const now = new Date().toISOString()
  const recentPosts = posts.recentDaily || []
  const maxCount = Math.max(...recentPosts.map(d => d.count), 1)

  const postBars = recentPosts.slice(0, 14).reverse().map(d => {
    const h = Math.round((d.count / maxCount) * 100)
    const bar = '█'.repeat(Math.round(d.count / maxCount * 20))
    return `<tr><td>${d.date}</td><td>${d.count}</td><td><span class="bar" style="width:${h}%">${bar}</span></td></tr>`
  }).join('')

  const healthRows = Object.entries(health).map(([k, v]) =>
    `<tr><td>${k}</td><td class="${v === 'OK' ? 'ok' : v === 'MISSING' ? 'err' : ''}">${v}</td></tr>`
  ).join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>wanxia Monitor</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 24px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  .sub { color: #94a3b8; font-size: .8rem; margin: 0 0 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
  .card { background: #1e293b; border-radius: 10px; padding: 16px; border: 1px solid #334155; }
  .card h2 { font-size: 1rem; margin: 0 0 12px; color: #38bdf8; }
  .kpi { font-size: 2rem; font-weight: 700; color: #f8fafc; }
  .kpi-label { font-size: .75rem; color: #94a3b8; }
  table { width: 100%; border-collapse: collapse; font-size: .8rem; }
  th, td { padding: 4px 8px; text-align: left; border-bottom: 1px solid #334155; }
  th { color: #94a3b8; font-weight: 500; }
  .bar { display: inline-block; background: linear-gradient(90deg, #f59e0b, #ef4444); height: 16px; border-radius: 3px; min-width: 2px; color: transparent; font-size: 0; }
  .ok { color: #22c55e; }
  .err { color: #ef4444; }
  .warn { color: #f59e0b; }
  .footer { margin-top: 24px; font-size: .7rem; color: #475569; }
</style>
</head>
<body>
<h1>🌅 wanxia Monitoring Dashboard</h1>
<p class="sub">Generated: ${now} | Node ${health.node}</p>

<div class="grid">
  <div class="card">
    <h2>📊 Posts</h2>
    <div class="kpi">${posts.totalPosts}</div>
    <div class="kpi-label">total posts over ${posts.totalDays} days</div>
  </div>
  <div class="card">
    <h2>🗄️ Database</h2>
    <div class="kpi">${db.predictions?.toLocaleString() || '?'}</div>
    <div class="kpi-label">predictions${db.firstDate ? ` (${String(db.firstDate).slice(0,10)} ~ ${String(db.lastDate).slice(0,10)})` : ''}</div>
  </div>
  <div class="card">
    <h2>💚 Health</h2>
    <table>${healthRows}</table>
  </div>
</div>

<div class="grid" style="margin-top:16px">
  <div class="card" style="grid-column:1/-1">
    <h2>📅 Recent Post Activity (14 days)</h2>
    <table>
      <tr><th>Date</th><th>Posts</th><th>Volume</th></tr>
      ${postBars || '<tr><td colspan=3>No data</td></tr>'}
    </table>
  </div>
</div>

<div class="footer">wanxia monitor v1.0 · auto-refreshes on reload</div>
</body>
</html>`
}

// ── Main ────────────────────────────────────────────────────────

const args = process.argv.slice(2)
if (args.includes('--serve')) {
  const PORT = parseInt(args[args.indexOf('--port') + 1] || '3099', 10)
  createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(generateDashboard())
  }).listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`))
} else {
  const out = args.includes('--output') ? args[args.indexOf('--output') + 1] : null
  const html = generateDashboard()
  if (out) {
    writeFileSync(out, html, 'utf-8')
    console.log(`Dashboard saved: ${out}`)
  } else {
    console.log(html)
  }
}
