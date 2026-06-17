// Quick test: try alternative XHS endpoints/headers to find a working path
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
process.chdir(join(__dirname, '..'))

const envLines = readFileSync('.env', 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#'))
for (const l of envLines) { const i = l.indexOf('='); if (i > 0) process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim() }
const C = process.env.XIAOHONGSHU_COOKIE

const mobileHeaders = {
  Cookie: C,
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  Referer: 'https://www.xiaohongshu.com/',
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json;charset=UTF-8',
}

const tests = [
  // 1. www domain POST (same API, different host)
  {
    label: 'www POST (no X-S)',
    fn: () => fetch('https://www.xiaohongshu.com/api/sns/web/v1/search/notes', {
      method: 'POST', headers: mobileHeaders,
      body: JSON.stringify({ keyword: '杭州晚霞', page: 1, page_size: 3, sort: 'time_descending' }),
    }),
  },
  // 2. Web search page (HTML scrape)
  {
    label: 'web search page GET',
    fn: () => fetch('https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent('杭州晚霞') + '&type=51', {
      headers: { ...mobileHeaders, Accept: 'text/html,application/xhtml+xml' },
    }),
  },
  // 3. edith with different sort
  {
    label: 'edith POST sort=general',
    fn: () => fetch('https://edith.xiaohongshu.com/api/sns/web/v1/search/notes', {
      method: 'POST', headers: mobileHeaders,
      body: JSON.stringify({ keyword: '杭州晚霞', page: 1, page_size: 3, sort: 'general' }),
    }),
  },
]

for (const t of tests) {
  try {
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), 10000)
    const res = await t.fn()
    clearTimeout(to)
    const text = await res.text()
    let json = null; try { json = JSON.parse(text) } catch {}
    console.log(`[${t.label}] HTTP ${res.status} | ${json ? `code=${json.code} msg=${json.msg||json.message||''}` : text.slice(0, 80)}`)
  } catch (e) {
    console.log(`[${t.label}] FAIL: ${e.message}`)
  }
}
