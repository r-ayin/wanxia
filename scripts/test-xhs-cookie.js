#!/usr/bin/env node
/**
 * 小红书 cookie 连通性测试 — 单城单请求，不影响生产数据
 * Usage: node scripts/test-xhs-cookie.js
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
process.chdir(join(__dirname, '..'))

// Load .env (already cwd'd to wanxia/ root)
const envPath = join(__dirname, '..', '.env')
const envLines = readFileSync(envPath, 'utf8')
  .split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))
for (const l of envLines) {
  const i = l.indexOf('=')
  if (i > 0) process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim()
}

const XHS_COOKIE = process.env.XIAOHONGSHU_COOKIE
if (!XHS_COOKIE) {
  console.log('❌ XIAOHONGSHU_COOKIE not found in .env')
  process.exit(1)
}

console.log('🔍 小红书 cookie 连通性测试')
console.log('═'.repeat(50))

// Test: Search API — MUST be POST with JSON body (GET returns 404)
const kw = '杭州晚霞'
const searchUrl = 'https://edith.xiaohongshu.com/api/sns/web/v1/search/notes'

const headers = {
  Cookie: XHS_COOKIE,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.xiaohongshu.com/',
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'https://www.xiaohongshu.com',
  'Content-Type': 'application/json;charset=UTF-8',
}

const reqBody = JSON.stringify({
  keyword: kw,
  page: 1,
  page_size: 5,
  sort: 'time_descending',
  source: 'web_search',
})

try {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12000)

  console.log(`\n📡 POST ${searchUrl}`)
  console.log(`   body: ${reqBody}`)
  const res = await fetch(searchUrl, { method: 'POST', headers, body: reqBody, signal: ctrl.signal })
  clearTimeout(t)

  console.log(`   HTTP ${res.status} ${res.statusText}`)

  const body = await res.text()
  let json
  try { json = JSON.parse(body) } catch { json = null }

  if (res.status === 200 && json) {
    // Debug: full structure
    console.log(`   json keys: ${Object.keys(json).join(', ')}`)
    console.log(`   code=${json.code} success=${json.success} msg=${json.msg}`)
    if (json.data) {
      const dataKeys = Object.keys(json.data)
      console.log(`   data type: ${typeof json.data}, keys(${dataKeys.length}): ${dataKeys.join(', ')}`)
      // Try common structures
      const items = json.data?.items || json.data?.notes || []
      if (Array.isArray(json.data)) {
        console.log(`   data is array[${json.data.length}]`)
      } else if (items.length > 0) {
        console.log(`   ✅ items count: ${items.length}`)
        console.log(`   item[0] keys: ${Object.keys(items[0]).join(', ')}`)
      } else {
        // Print first level of data
        for (const k of dataKeys) {
          const v = json.data[k]
          if (typeof v === 'object') {
            console.log(`   data.${k}: ${Array.isArray(v) ? `array[${v.length}]` : `object keys=${Object.keys(v||{}).join(',')}`}`)
          } else {
            console.log(`   data.${k}: ${v}`)
          }
        }
      }
    }
  } else if (res.status === 401 || res.status === 403) {
    console.log(`   ❌ 鉴权失败 — cookie 可能已过期`)
    const preview = body.slice(0, 300)
    console.log(`   Body preview: ${preview}`)
  } else if (json?.code !== undefined) {
    console.log(`   ❌ API 错误: code=${json.code} msg=${json.msg || json.message || ''}`)
  } else {
    console.log(`   ⚠️  非预期响应 (${res.status})`)
    console.log(`   Body preview: ${body.slice(0, 200)}`)
  }
} catch (e) {
  console.log(`   ❌ 请求失败: ${e.message}`)
  if (e.cause) console.log(`   Cause: ${e.cause}`)
}

console.log('\n' + '═'.repeat(50))
