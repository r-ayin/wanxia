#!/usr/bin/env node
/**
 * 📸 晚霞预报 → 小红书发帖截图生成器
 *
 * 利用现有前端页面，通过 Playwright 截取：
 *   1. 全国晚霞概览图（等高线模式）
 *   2. TOP N 城市详情卡片
 *   3. 杭州区域网格图
 *
 * Usage:
 *   node scripts/screenshot-xhs.js                    # 默认 5 城市
 *   node scripts/screenshot-xhs.js --top 3            # 只截 TOP 3
 *   node scripts/screenshot-xhs.js --port 8080        # 指定端口
 *   node scripts/screenshot-xhs.js --output ./shots   # 指定输出目录
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { writeFileSync, mkdirSync, existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ── CLI ──────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const getArg = (n, def) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : def }
const hasFlag = n => args.includes(n)

const TOP_N = parseInt(getArg('--top', '5'))
const PORT = parseInt(getArg('--port', '8080'))
const OUT_DIR = getArg('--output', join(ROOT, 'screenshots'))
const BASE = `http://localhost:${PORT}`
const VIEWPORT_W = 1440
const VIEWPORT_H = 900

// ── Helpers ──────────────────────────────────────────────────────────────────────
const wait = ms => new Promise(r => setTimeout(r, ms))

// ── Main ─────────────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

  console.log('╔══════════════════════════════════════════════╗')
  console.log('║  📸 晚霞预报 · 小红书截图生成器             ║')
  console.log('╚══════════════════════════════════════════════╝')
  console.log(`  服务器: ${BASE}`)
  console.log(`  输出:   ${OUT_DIR}`)
  console.log(`  TOP:    ${TOP_N} 城市\n`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
    deviceScaleFactor: 2,  // Retina quality
  })

  try {
    // ═══ 1. Navigate & Wait for Data ═══════════════════════════════════════════
    console.log('── 1/4 加载页面 & 等待数据 ──')
    const page = await context.newPage()
    await page.goto(BASE, { timeout: 30000, waitUntil: 'load' })  // 'load' not 'networkidle' — contour SSE keeps network open
    console.log('   ✅ 页面已加载')

    // Wait for summary bar to populate (loading hidden means data fetched)
    await page.waitForFunction(() => {
      const bar = document.getElementById('summary-bar')
      const loading = document.getElementById('loading')
      const barReady = bar && bar.textContent && bar.textContent.trim().length > 5
      const loadingHidden = loading && loading.classList.contains('hidden')
      return barReady && loadingHidden
    }, { timeout: 60000 })
    console.log('   ✅ 预测数据就绪')

    // Wait for contour regions (SSE streaming may take a while)
    console.log('   ⏳ 等待等高线渲染完成...')
    try {
      await page.waitForFunction(() => window.__contourReady === true, { timeout: 120000 })
      console.log('   ✅ __contourReady 信号收到')
    } catch {
      console.log('   ⚠️  __contourReady 超时，回退到 .contour-region 检测')
      try {
        await page.waitForSelector('.contour-region', { timeout: 90000 })
        console.log('   ✅ .contour-region 检测到')
      } catch {
        console.log('   ⚠️  等高线超时，使用已有渲染')
      }
    }
    // Extra settle time for Leaflet tile loading + SVG polygon rendering
    await wait(5000)
    console.log('   ✅ 页面渲染稳定')

    // Debug: check what's available
    const dbg = await page.evaluate(() => ({
      hasWanxia: typeof window.__wanxia,
      hasGetTop: typeof window.__wanxia?.getTopCities,
      citiesCount: window.__wanxia?.getCities()?.length || 0,
    }))
    console.log(`   DEBUG: __wanxia=${dbg.hasWanxia}, getTop=${dbg.hasGetTop}, cities=${dbg.citiesCount}`)

    // Get top cities list
    const topCities = await page.evaluate(n => window.__wanxia?.getTopCities(n), TOP_N)
    if (!topCities?.length) {
      console.log('   ❌ 无法获取城市数据 — API 回退')
      const apiData = await page.evaluate(async () => {
        const res = await fetch('/api/predictions')
        return res.json()
      })
      const fallbackCities = (apiData.cities || [])
        .filter(c => c.score != null)
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_N)
      if (!fallbackCities.length) {
        console.log('   ❌ API 也无数据')
        return
      }
      console.log(`   ✅ API 回退: ${fallbackCities.map(c => `${c.name}(${c.score})`).join(', ')}`)
      topCities.push(...fallbackCities)
    }
    console.log(`   📊 TOP ${TOP_N}: ${topCities.map(c => `${c.name}(${c.score}分)`).join(', ')}`)

    const useWanxiaGlobal = dbg.hasWanxia === 'object' && dbg.hasGetTop === 'function'

    // ═══ 2. National Contour Screenshot ════════════════════════════════════════
    console.log('\n── 2/4 全国概览图（等高线模式）──')
    await page.screenshot({
      path: join(OUT_DIR, '01-national-contour.png'),
      fullPage: false,
    })
    console.log('   ✅ 01-national-contour.png')

    // ═══ 3. National Markers Mode ══════════════════════════════════════════════
    console.log('\n── 3/4 全国标记图 ──')
    await page.click('.view-mode-btn[data-mode="markers"]')
    await wait(2000)
    await page.screenshot({
      path: join(OUT_DIR, '02-national-markers.png'),
      fullPage: false,
    })
    console.log('   ✅ 02-national-markers.png')

    // ═══ 4. City Detail Panels ═════════════════════════════════════════════════
    console.log(`\n── 4/4 TOP ${TOP_N} 城市详情 ──`)

    for (let i = 0; i < topCities.length; i++) {
      const city = topCities[i]
      const idx = String(i + 3).padStart(2, '0')

      // Open detail panel
      let opened
      if (useWanxiaGlobal) {
        opened = await page.evaluate(id => window.__wanxia.openCity(id), city.id)
      } else {
        // Fallback: click the marker on the map by lat/lon
        opened = await page.evaluate((c) => {
          const mapEl = document.getElementById('map')
          const map = mapEl._leaflet_map
          if (!map) return false
          for (const key in map._layers) {
            const layer = map._layers[key]
            if (layer._layers) {
              for (const subKey in layer._layers) {
                const marker = layer._layers[subKey]
                if (marker._latlng && marker._latlng.lat === c.lat && marker._latlng.lng === c.lon) {
                  marker.fire('click')
                  return true
                }
              }
            }
          }
          return false
        }, { id: city.id, lat: city.lat, lon: city.lon })
      }
      if (!opened) {
        console.log(`   ⚠️  ${city.name}: 无法打开面板`)
        continue
      }

      // Wait for panel to slide in
      await page.waitForSelector('#detail-panel.open', { timeout: 5000 })

      // Wait for history chart to render (or show empty state)
      try {
        await page.waitForFunction(() => {
          const chart = document.getElementById('history-chart')
          return chart && (chart.querySelector('.history-bar') || chart.querySelector('.history-empty'))
        }, { timeout: 8000 })
      } catch {
        // History fetch may fail — that's ok
      }

      await wait(1500) // let animations finish

      await page.screenshot({
        path: join(OUT_DIR, `${idx}-${city.name}-detail.png`),
        fullPage: false,
      })
      console.log(`   ✅ ${idx}-${city.name}-detail.png (${city.score}分 ${city.tierCn})`)

      // Close panel
      if (useWanxiaGlobal) {
        await page.evaluate(() => window.__wanxia.closePanel())
      } else {
        await page.click('#panel-close').catch(() => {})
      }
      await wait(800)
    }

    // ═══ Done ══════════════════════════════════════════════════════════════════
    console.log(`\n${'═'.repeat(50)}`)
    console.log(`✅ 全部完成！${2 + topCities.length} 张截图 → ${OUT_DIR}/`)
    console.log(`   01-national-contour.png  — 全国等高线概览`)
    console.log(`   02-national-markers.png  — 全国标记图`)
    for (let i = 0; i < topCities.length; i++) {
      const idx = String(i + 3).padStart(2, '0')
      console.log(`   ${idx}-${topCities[i].name}-detail.png  — ${topCities[i].name} ${topCities[i].score}分 ${topCities[i].tierCn}`)
    }

  } catch (err) {
    console.error(`\n❌ 截图失败: ${err.message}`)
    if (err.stack) console.error(err.stack.split('\n').slice(0, 4).join('\n'))
  } finally {
    await browser.close()
  }
}

main()
