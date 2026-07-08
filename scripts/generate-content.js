#!/usr/bin/env node
/**
 * 📱 晚霞预报 → 小红书内容生成器 v1.0（轻量版·无浏览器）
 *
 * 只在服务器上跑：文案 + GPT-Image-2 封面图。
 * 不需要 Playwright/Chromium，适合低配 ECS。
 *
 * 流程：
 *   1. 从 API 获取预测数据
 *   2. 生成文案（copy-generator.js）
 *   3. 调用 Python 生成 AI 封面图
 *   4. 写入 posts.json + txt 文件
 *
 * Usage:
 *   node scripts/generate-content.js                    # 默认全部
 *   node scripts/generate-content.js --port 8080
 *   node scripts/generate-content.js --output ./posts
 *   node scripts/generate-content.js --limit-covers 3  # 最多生成 N 张封面
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Load .env
try {
  const envLines = readFileSync(join(ROOT, '.env'), 'utf8')
    .split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))
  for (const l of envLines) {
    const i = l.indexOf('=')
    if (i > 0) process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim()
  }
} catch {}

const args = process.argv.slice(2)
const getArg = (n, def) => {
  const i = args.indexOf(n)
  if (i < 0) return def
  const v = args[i + 1]
  return (v && !v.startsWith('--')) ? v : def
}
const PORT = parseInt(getArg('--port', '8080'))
const BASE_DIR = join(ROOT, getArg('--output', 'posts'))
const BASE = `http://localhost:${PORT}`
const COVER_LIMIT = parseInt(getArg('--limit-covers', process.env.GPT_IMAGE_COVER_LIMIT || '5'))

async function main() {
  console.log('📡 获取预测数据...')
  const apiRes = await fetch(`${BASE}/api/predictions`)
  if (!apiRes.ok) throw new Error(`API error: ${apiRes.status}`)
  const data = await apiRes.json()
  console.log(`   ✅ ${data.cityCount} 城市，均分 ${data.summary?.averageScore || '?'}`)

  const dateStr = getArg('--date', data.date)
  const OUT_DIR = join(BASE_DIR, dateStr)
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  console.log(`   📁 输出目录: ${OUT_DIR}`)

  // Fetch yesterday's data
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  let yesterdayData = null
  try {
    const yRes = await fetch(`${BASE}/api/predictions?date=${yesterday}`)
    if (yRes.ok) yesterdayData = await yRes.json()
  } catch {}

  // ═══ 1. 文案生成 ════════════════════════════════════════════════════════════
  console.log('\n✍️  生成文案...')
  const { generateAll } = await import('../src/copy-generator.js')
  const { national, cityPosts } = generateAll(data, yesterdayData)

  const posts = []

  // 全国播报
  writeFileSync(join(OUT_DIR, '01-national.txt'), [
    national.title, '', national.body, '', national.hashtags || '',
  ].join('\n'), 'utf8')
  posts.push({ file: '01-national.txt', title: national.title, body: national.body,
    hashtags: national.hashtags, isNational: true })
  console.log(`   ✅ 全国播报文案`)

  // 城市独立帖
  for (let i = 0; i < cityPosts.length; i++) {
    const post = cityPosts[i]
    const idx = String(i + 2).padStart(2, '0')
    const cityData = data.cities?.find(c => {
      const nameMatch = post.title?.match(/^(\S+?)(?:今晚|晚霞|今天)/)
      return nameMatch && c.name === nameMatch[1]
    })
    const cityName = cityData?.name || post.title?.slice(0, 8) || `city-${i}`
    const fname = `${idx}-${cityName}.txt`

    writeFileSync(join(OUT_DIR, fname), [
      post.title, '', post.body, '', post.hashtags || '',
    ].join('\n'), 'utf8')

    posts.push({
      file: fname,
      title: post.title,
      body: post.body,
      hashtags: post.hashtags,
      cityId: cityData?.id,
      cityName: cityData?.name,
      score: cityData?.score,
      tierCn: cityData?.tierCn,
      dominantColor: cityData?.dominantColor,
      sunsetTime: cityData?.sunsetTime,
      lat: cityData?.lat,
      lon: cityData?.lon,
      isForecast: post.isForecast || false,
    })
    console.log(`   ✅ ${fname} ${cityData?.score != null ? `(${cityData.score}分)` : ''}`)
  }

  console.log(`\n   📝 共 ${posts.length} 篇文案`)

  // ═══ 2. 写入 posts.json（封面生成前） ═══════════════════════════════════════
  const summary = {
    generatedAt: new Date().toISOString(),
    date: data.date,
    summary: data.summary,
    total: posts.length,
    posts: posts.map(p => ({
      file: p.file, title: p.title, score: p.score, tierCn: p.tierCn,
      cityName: p.cityName, dominantColor: p.dominantColor, sunsetTime: p.sunsetTime,
      isForecast: p.isForecast, cover: null,
    })),
  }
  writeFileSync(join(OUT_DIR, 'posts.json'), JSON.stringify(summary, null, 2), 'utf8')

  // ═══ 3. AI 封面图生成 ═══════════════════════════════════════════════════════
  const coverEnabled = (process.env.GPT_IMAGE_COVER_ENABLED || 'false') === 'true'
  const hasApiKey = !!(process.env.GPT_IMAGE_API_KEY || '')

  if (coverEnabled && hasApiKey) {
    console.log(`\n🎨 生成 AI 封面图 (GPT-Image-2, 最多 ${COVER_LIMIT} 张)...`)
    try {
      const scriptPath = join(ROOT, 'scripts', 'generate-cover-image.py')
      const result = execFileSync('python3', [
        scriptPath,
        '--limit', String(COVER_LIMIT),
        '--posts-dir', OUT_DIR,
      ], { cwd: ROOT, timeout: 600000, encoding: 'utf-8' })
      console.log(result.trim())

      // 重新读取 posts.json（Python 已更新封面信息）
      try {
        const updated = JSON.parse(readFileSync(join(OUT_DIR, 'posts.json'), 'utf-8'))
        const covers = updated.covers
        if (covers) {
          console.log(`\n   📸 ${covers.count || 0} 张封面已生成，总费用: ${covers.totalCost?.toFixed(4) || '?'}`)
          for (const item of covers.items || []) {
            console.log(`      - ${item.city} (${item.score}分) → ${item.file}`)
          }
        }
      } catch {}
    } catch (err) {
      console.error(`   ⚠️  封面生成失败: ${err.message}`)
      if (err.stderr) console.error(`   ${err.stderr.trim()}`)
    }
  } else if (coverEnabled && !hasApiKey) {
    console.log('\n   ⚠️  封面生成已启用但未配置 GPT_IMAGE_API_KEY')
  } else {
    console.log('\n   ℹ️  封面生成未启用（GPT_IMAGE_COVER_ENABLED != true）')
  }

  // ═══ 4. 输出汇总 ════════════════════════════════════════════════════════════
  console.log(`\n${'═'.repeat(50)}`)
  console.log(`✅ 内容包完成！${posts.length} 篇 → ${OUT_DIR}/`)
  console.log(`   posts.json — 索引 + 封面信息`)
  console.log(`   *.txt      — 文案文件`)
  const coverDir = join(OUT_DIR, 'covers')
  if (existsSync(coverDir)) {
    console.log(`   covers/    — AI 封面图`)
  }
}

main().catch(err => {
  console.error(`\n❌ 失败: ${err.message}`)
  process.exit(1)
})
