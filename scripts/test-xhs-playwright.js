#!/usr/bin/env node
/**
 * 小红书 Playwright 浏览器采集连通性测试
 * 单城单浏览器 — 验证完整链路：cookie → 浏览器 → 搜索 → 数据提取
 * Usage: node scripts/test-xhs-playwright.js
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
process.chdir(join(__dirname, '..'))

// Load .env
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

import { chromium } from 'playwright'

function parseXhsCookies(cookieStr) {
  return cookieStr.split(';').map(pair => {
    const [name, ...rest] = pair.trim().split('=')
    return {
      name: name.trim(), value: rest.join('=').trim(),
      domain: '.xiaohongshu.com', path: '/',
      httpOnly: false, secure: true, sameSite: 'Lax',
    }
  }).filter(c => c.name && c.value)
}

console.log('🔍 小红书 Playwright 无头浏览器采集测试')
console.log('═'.repeat(55))

let browser
try {
  // Launch
  console.log('\n🚀 启动 Chromium...')
  browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  })
  console.log('   ✅ 浏览器已启动')

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  })

  // Set cookies
  const cookies = parseXhsCookies(XHS_COOKIE)
  await context.addCookies(cookies)
  console.log(`   ✅ Cookie 已注入 (${cookies.length} 条)`)

  const page = await context.newPage()
  const kw = '杭州晚霞'
  const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(kw)}&source=web_search_result_notes`

  // Set up API response interception BEFORE navigation
  const apiPromise = page.waitForResponse(
    res => res.url().includes('edith.xiaohongshu.com/api/sns/web/v1/search/notes') && res.status() === 200,
    { timeout: 20000 }
  )

  console.log(`\n📡 导航至搜索结果页...`)
  console.log(`   URL: ${searchUrl}`)
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
  console.log('   ✅ 页面已加载')

  // Wait for API response
  console.log('\n⏳ 等待搜索 API 响应 (edith.xiaohongshu.com)...')
  let json, apiOk
  try {
    const apiRes = await apiPromise
    json = await apiRes.json()
    apiOk = true
    console.log(`   ✅ 拦截到 API 响应 HTTP ${apiRes.status()}`)
  } catch (e) {
    apiOk = false
    console.log(`   ⚠️  API 拦截超时: ${e.message}`)
    console.log('   尝试 DOM 回退...')
  }

  if (apiOk && json) {
    const items = json?.data?.items || json?.data?.notes || []
    console.log(`   code=${json.code} success=${json.success}`)
    if (items.length > 0) {
      console.log(`\n📊 搜索结果: ${items.length} 条笔记`)
      for (let i = 0; i < Math.min(3, items.length); i++) {
        const note = items[i]?.note_card || items[i] || {}
        const title = note.display_title || note.title || '(无标题)'
        const likes = note.liked_count || note.interact_info?.liked_count || 0
        const collects = note.collected_count || note.interact_info?.collected_count || 0
        const comments = note.comment_count || note.interact_info?.comment_count || 0
        console.log(`   [${i + 1}] ${title.slice(0, 40)}`)
        console.log(`       赞=${likes} 藏=${collects} 评=${comments}`)
      }
    } else {
      console.log('   ⚠️  API 返回空 — 检查响应结构:')
      console.log(`   json keys: ${Object.keys(json).join(', ')}`)
      if (json.data) console.log(`   data keys: ${Object.keys(json.data).join(', ')}`)
    }
  }

  await page.close()
  await context.close()

  console.log('\n' + '═'.repeat(55))
  console.log(apiOk && json?.data?.items?.length > 0 ? '✅ 采集链路验证通过！' : '⚠️  链路部分通畅，需进一步调试')
} catch (e) {
  console.log(`\n❌ 测试失败: ${e.message}`)
  if (e.stack) console.log(e.stack.split('\n').slice(0, 3).join('\n'))
} finally {
  if (browser) await browser.close().catch(() => {})
  console.log('🔒 浏览器已关闭')
}
