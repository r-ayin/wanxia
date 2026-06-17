#!/usr/bin/env node
/**
 * 🔧 小红书 Cookie 导出工具 (Playwright Node.js)
 *
 * 打开可视化浏览器 → 用户扫码登录 → 自动保存 storage_state + 打印 cookie 字符串
 *
 * Usage: node scripts/export-xhs-cookie.js
 */

import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const STORAGE_STATE = join(__dirname, '.xhs_storage_state.json')
const ENV_FILE = join(ROOT, '.env')

console.log('╔══════════════════════════════════════════════╗')
console.log('║  🔧 小红书 Cookie 导出工具 (Playwright)     ║')
console.log('╚══════════════════════════════════════════════╝')
console.log()
console.log('即将打开浏览器窗口，请按以下步骤操作：')
console.log('  1. 浏览器会打开 https://creator.xiaohongshu.com')
console.log('  2. 扫码登录')
console.log('  3. 确认已登录后，回到终端按 Enter')
console.log()

// 先关闭用户当前 Chrome（避免 profile lock）
console.log('⚠️  注意：如果当前 Chrome 正在运行，请手动关闭后按 Enter 继续...')
console.log('   (否则 Chromium 无法复制 profile)')

const browser = await chromium.launch({ headless: false })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
})

const page = await context.newPage()
await page.goto('https://creator.xiaohongshu.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(2000)

console.log('✅ 浏览器已打开 → 请扫码登录小红书创作者平台')
console.log('   登录后回到终端，按 Enter 继续...')

// Wait for user input
await new Promise(resolve => process.stdin.once('data', resolve))

// Check if login worked
const url = page.url()
if (url.includes('/login')) {
  console.log('⚠️  仍显示登录页面，cookie 可能无效')
  console.log('   继续导出当前 cookie（可能包含部分登录态）...')
} else {
  console.log('✅ 已登录，导出 cookie...')
}

// Save Playwright storage state
await context.storageState({ path: STORAGE_STATE })
console.log(`\n✅ storage_state 已保存: ${STORAGE_STATE}`)

// Extract cookie string for .env
const cookies = await context.cookies()
const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ')
console.log(`\n📋 Cookie 字符串 (${cookies.length} 个):`)
console.log(`   XIAOHONGSHU_COOKIE=${cookieStr}`)

// Auto-update .env
try {
  let envContent = readFileSync(ENV_FILE, 'utf8')
  const xhsLineRegex = /^XIAOHONGSHU_COOKIE=.*$/m
  if (xhsLineRegex.test(envContent)) {
    envContent = envContent.replace(xhsLineRegex, `XIAOHONGSHU_COOKIE=${cookieStr}`)
    writeFileSync(ENV_FILE, envContent, 'utf8')
    console.log(`\n✅ .env 已自动更新`)
  } else {
    console.log(`\n⚠️  请在 .env 中手动添加: XIAOHONGSHU_COOKIE=...`)
  }
} catch (e) {
  console.log(`\n⚠️  .env 更新失败: ${e.message}`)
}

await browser.close()
console.log('\n🔧 完成！现在运行: node scripts/publish-xhs.js && python scripts/post_xhs_browseruse.py --limit 1')
