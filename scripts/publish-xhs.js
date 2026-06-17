#!/usr/bin/env node
/**
 * 📱 晚霞预报 → 小红书一键发帖素材包
 *
 * 生成内容：
 *   01-national.png       全国播报截图 + 文案
 *   02-北京.png           一线城市独立帖（≥50分的）
 *   posts.json            所有帖子文案+截图路径
 *
 * Usage:
 *   node scripts/publish-xhs.js                    # 默认全部
 *   node scripts/publish-xhs.js --port 8080
 *   node scripts/publish-xhs.js --output ./posts   # 指定输出目录
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { writeFileSync, mkdirSync, existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const args = process.argv.slice(2)
const getArg = (n, def) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : def }
const PORT = parseInt(getArg('--port', '8080'))
const OUT_DIR = join(ROOT, getArg('--output', 'posts'))
const BASE = `http://localhost:${PORT}`

const wait = ms => new Promise(r => setTimeout(r, ms))

// ── Main ─────────────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

  // Get API data
  console.log('📡 获取预测数据...')
  const apiRes = await fetch(`${BASE}/api/predictions`)
  if (!apiRes.ok) throw new Error(`API error: ${apiRes.status}`)
  const data = await apiRes.json()
  console.log(`   ✅ ${data.cityCount} 城市，均分 ${data.summary.averageScore}`)

  // Fetch yesterday's data for trend awareness
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  let yesterdayData = null
  try {
    const yRes = await fetch(`${BASE}/api/predictions?date=${yesterday}`)
    if (yRes.ok) {
      yesterdayData = await yRes.json()
      console.log(`   📈 昨日数据已加载（${yesterdayData.cities?.length || 0} 城）`)
    }
  } catch { /* yesterday data is optional */ }

  // Generate copy
  const { generateAll } = await import('../src/copy-generator.js')
  const { national, cityPosts } = generateAll(data, yesterdayData)

  // Launch browser
  console.log('\n🚀 启动浏览器...')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  })

  const posts = []

  try {
    const page = await context.newPage()

    // ═══ 1. Navigate & Wait ═══════════════════════════════════════════════════
    console.log('\n📄 加载前端...')
    await page.goto(BASE, { timeout: 30000, waitUntil: 'load' })
    await page.waitForFunction(() => {
      const bar = document.getElementById('summary-bar')
      const loading = document.getElementById('loading')
      return bar?.textContent?.trim().length > 5 && loading?.classList.contains('hidden')
    }, { timeout: 60000 })
    console.log('   ✅ 数据就绪')

    // Wait for contour SSE stream to complete + Leaflet rendering to settle
    console.log('   ⏳ 等待等高线渲染完成...')
    try {
      await page.waitForFunction(() => window.__contourReady === true, { timeout: 120000 })
      console.log('   ✅ 等高线渲染完成')
    } catch {
      // Fallback: wait for .contour-region elements and extra settle time
      console.log('   ⚠️  __contourReady 超时，回退到 .contour-region 检测')
      try {
        await page.waitForSelector('.contour-region', { timeout: 90000 })
      } catch {}
    }
    // Extra settle time for Leaflet tile rendering
    await wait(5000)
    console.log('   ✅ 页面渲染稳定，开始截图')

    // ═══ 2. National Screenshot + Copy ════════════════════════════════════════
    console.log('\n── 全国播报 ──')
    await page.screenshot({ path: join(OUT_DIR, '01-national.png'), fullPage: false })
    writeFileSync(join(OUT_DIR, '01-national.txt'), [
      national.title,
      '',
      national.body,
      '',
      national.hashtags,
    ].join('\n'), 'utf8')
    posts.push({ file: '01-national.png', copyFile: '01-national.txt', ...national })
    console.log(`   ✅ 截图 + 文案已保存`)

    // ═══ 3. City Detail Screenshots + Copy ═══════════════════════════════════
    console.log(`\n── 城市独立播报 (${cityPosts.length} 篇) ──`)

    // First verify __wanxia is available
    const hasWanxia = await page.evaluate(() => typeof window.__wanxia?.openCity === 'function')
    if (!hasWanxia) {
      console.log('   ⚠️  __wanxia 不可用，使用标记点点击模式')
    }

    for (let i = 0; i < cityPosts.length; i++) {
      const post = cityPosts[i]
      const cityData = data.cities.find(c => {
        // Match by city name from post title (e.g., "🔥 西安晚霞 · 87分 极佳")
        const nameMatch = post.title.match(/(\S+)晚霞/)
        return nameMatch && c.name === nameMatch[1]
      })

      if (!cityData) {
        console.log(`   ⚠️  ${post.title.slice(0, 15)}... 无法匹配城市数据`)
        continue
      }

      const idx = String(i + 2).padStart(2, '0')
      const fname = `${idx}-${cityData.name}`

      // Open detail panel
      let opened
      if (hasWanxia) {
        opened = await page.evaluate(id => window.__wanxia.openCity(id), cityData.id)
      } else {
        opened = await page.evaluate((c) => {
          const mapEl = document.getElementById('map')
          const map = mapEl?._leaflet_map
          if (!map) return false
          for (const key in map._layers) {
            const layer = map._layers[key]
            if (layer._layers) {
              for (const subKey in layer._layers) {
                const marker = layer._layers[subKey]
                if (marker._latlng && Math.abs(marker._latlng.lat - c.lat) < 0.01 && Math.abs(marker._latlng.lng - c.lon) < 0.01) {
                  marker.fire('click')
                  return true
                }
              }
            }
          }
          return false
        }, { lat: cityData.lat, lon: cityData.lon })
      }

      if (!opened) {
        console.log(`   ⚠️  ${cityData.name}: 无法打开面板`)
        continue
      }

      await page.waitForSelector('#detail-panel.open', { timeout: 5000 })

      try {
        await page.waitForFunction(() => {
          const chart = document.getElementById('history-chart')
          return chart?.querySelector('.history-bar') || chart?.querySelector('.history-empty')
        }, { timeout: 8000 })
      } catch {}

      await wait(1500)

      // Screenshot + copy
      await page.screenshot({ path: join(OUT_DIR, `${fname}.png`), fullPage: false })
      writeFileSync(join(OUT_DIR, `${fname}.txt`), [
        post.title,
        '',
        post.body,
        '',
        post.hashtags,
      ].join('\n'), 'utf8')

      posts.push({ file: `${fname}.png`, copyFile: `${fname}.txt`, cityId: cityData.id, ...post })
      console.log(`   ✅ ${fname} (${cityData.score}分 ${cityData.tierCn})`)

      // Close panel
      if (hasWanxia) {
        await page.evaluate(() => window.__wanxia.closePanel())
      } else {
        await page.click('#panel-close').catch(() => {})
      }
      await wait(800)
    }

    // ═══ 4. Output Summary ════════════════════════════════════════════════════
    const summary = {
      generatedAt: new Date().toISOString(),
      date: data.date,
      summary: data.summary,
      total: posts.length,
      posts: posts.map(p => ({ file: p.file, copyFile: p.copyFile, title: p.title })),
    }
    writeFileSync(join(OUT_DIR, 'posts.json'), JSON.stringify(summary, null, 2), 'utf8')

    console.log(`\n${'═'.repeat(50)}`)
    console.log(`✅ 发帖素材包完成！${posts.length} 篇 → ${OUT_DIR}/`)
    console.log(`   posts.json — 索引文件`)
    for (const p of posts) {
      console.log(`   ${p.file} — ${p.title?.slice(0, 30) || ''}`)
    }

  } finally {
    await browser.close()
  }
}

main().catch(err => {
  console.error(`\n❌ 失败: ${err.message}`)
  process.exit(1)
})
