#!/usr/bin/env node
/**
 * 双源采集端到端测试 — 单城 Weibo + XHS 全链路
 * Usage: node scripts/test-e2e.js
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
process.chdir(join(__dirname, '..'))

const envLines = readFileSync('.env', 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#'))
for (const l of envLines) { const i = l.indexOf('='); if (i > 0) process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim() }

const { initDatabase } = await import('../src/storage.js')
initDatabase()
const { fetchCitySocial, computeSocialScore, closeBrowser, cookieStatus } = await import('../src/social-scraper.js')

const cs = cookieStatus()
console.log('╔══════════════════════════════════════════╗')
console.log('║   双源采集端到端测试 (Weibo + XHS)     ║')
console.log('╚══════════════════════════════════════════╝')
console.log(`  微博: ${cs.weibo ? '✅' : '❌'}  小红书: ${cs.xiaohongshu ? '✅' : '❌'}`)
console.log('')

const city = { id: 'hangzhou', name: '杭州' }
const date = '2026-06-16'

console.log(`📡 采集: ${city.name} (${date})`)
console.log('─'.repeat(42))

try {
  const result = await fetchCitySocial(city, date)

  console.log(`  微博帖子: ${result.weiboPosts}  得分: ${result.weiboScore ?? '—'}`)
  console.log(`  小红书帖子: ${result.xhsPosts}  得分: ${result.xhsScore ?? '—'}`)
  console.log(`  ──────────────────────────────────`)
  console.log(`  融合帖子: ${result.postCount}  融合得分: ${result.socialScore ?? '—'}`)
  console.log(`  数据源: ${result.source}`)

  if (result.error) {
    console.log(`  ⚠️  错误: ${result.error}`)
  }

  console.log('\n' + '─'.repeat(42))
  if (result.socialScore !== null) {
    console.log('✅ 双源采集成功！')
    console.log(`   ${city.name} 今日晚霞社交热度: ${result.socialScore}/100`)
  } else {
    console.log('⚠️  未达阈值 (MIN_POSTS=2) 或无数据')
  }
} catch (e) {
  console.log(`❌ 失败: ${e.message}`)
} finally {
  await closeBrowser()
  console.log('🔒 浏览器已清理')
}
