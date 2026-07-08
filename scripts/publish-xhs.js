#!/usr/bin/env node
/**
 * 📱 晚霞预报 → 小红书一键发帖素材包 v3.0
 *
 * 生成内容：
 *   01-national.png       全国播报截图 + 文案（v3.0 爆款标题+互动钩子）
 *   02-北京.png           一线城市独立帖（≥50分的）
 *   posts.json            所有帖子文案+截图路径+POI数据
 *
 * v3.0 升级：
 *   - 标题公式：数字+情绪+紧迫感，前18字含2个核心关键词
 *   - 正文三层：认知锚点→过程验证→结果确证
 *   - 互动钩子：每篇结尾引导评论（CES评分评论权重×4）
 *   - 标签精简：1热门+4精准
 *   - POI 数据：lat/lon + 推荐点位（提升70%曝光）
 *   - 封面 prompt：上部40%留白+摄影感
 *
 * Usage:
 *   node scripts/publish-xhs.js                    # 默认全部
 *   node scripts/publish-xhs.js --port 8080
 *   node scripts/publish-xhs.js --output ./posts   # 指定输出目录
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { execFileSync, execSync } from 'child_process'

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
const getArg = (n, def) => { const i = args.indexOf(n); if (i < 0) return def; const v = args[i + 1]; return (v && !v.startsWith('--')) ? v : def }
const PORT = parseInt(getArg('--port', '8080'))
const BASE_DIR = join(ROOT, getArg('--output', 'posts'))  // base dir, date subdir created later
const BASE = `http://localhost:${PORT}`

const wait = ms => new Promise(r => setTimeout(r, ms))

// ── 城市地标映射（POI 推荐）─────────────────────────────────────────────────────
const SPOTS = {
  北京:    { best: ['故宫角楼', '颐和园', '景山万春亭'] },
  上海:    { best: ['外滩', '浦东滨江', '徐汇滨江'] },
  杭州:    { best: ['西湖断桥', '雷峰塔', '宝石山'] },
  成都:    { best: ['龙泉山', '锦城湖', '交子大道'] },
  广州:    { best: ['珠江新城', '琶洲大桥', '白云山'] },
  深圳:    { best: ['深圳湾公园', '前海石公园', '梧桐山'] },
  重庆:    { best: ['南山一棵树', '洪崖洞', '鹅岭公园'] },
  武汉:    { best: ['长江大桥', '东湖凌波门', '汉口江滩'] },
  南京:    { best: ['玄武湖', '中山陵', '鱼嘴湿地'] },
  西安:    { best: ['城墙南门', '曲江池', '大雁塔'] },
  长沙:    { best: ['橘子洲头', '岳麓山', '梅溪湖'] },
  天津:    { best: ['天津之眼', '海河故道', '五大道'] },
  苏州:    { best: ['金鸡湖', '太湖', '独墅湖'] },
  青岛:    { best: ['信号山', '小麦岛', '栈桥'] },
  厦门:    { best: ['演武大桥', '鼓浪屿', '海湾公园'] },
  大连:    { best: ['星海湾', '金石滩', '东港'] },
}

function getSpots(cityName, score) {
  const s = SPOTS[cityName]
  if (!s) return []
  return score >= 65 ? s.best : s.best.slice(0, 1)
}

// ── Main ─────────────────────────────────────────────────────────────────────────
async function main() {
  // Get API data first (to know the date)
  console.log('📡 获取预测数据...')
  const apiRes = await fetch(`${BASE}/api/predictions`)
  if (!apiRes.ok) throw new Error(`API error: ${apiRes.status}`)
  const data = await apiRes.json()
  console.log(`   ✅ ${data.cityCount} 城市，均分 ${data.summary.averageScore}`)

  // 🔴 v3.1: 按日期归档
  const dateStr = getArg('--date', data.date)  // 默认从API取，可手动覆盖
  const OUT_DIR = join(BASE_DIR, dateStr)
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  console.log(`   📁 输出目录: ${OUT_DIR}`)

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

    // 🔴 v3.2: 多层渲染等待 —— network idle + 等高线 + Leaflet 瓦片全量 + CSS 稳定
    console.log('   ⏳ 等待地图渲染...')

    // Step 0: 等待网络空闲（确保瓦片请求完成）
    try {
      await page.waitForLoadState('networkidle', { timeout: 30000 })
      console.log('   ✅ 网络空闲')
    } catch { console.log('   ⚠️  networkidle 超时') }

    // Step 1: 等待等高线渲染
    let contourOk = false
    try {
      await page.waitForFunction(() => window.__contourReady === true, { timeout: 120000 })
      console.log('   ✅ 等高线渲染完成')
      contourOk = true
    } catch {
      console.log('   ⚠️  __contourReady 超时，回退检测')
    }
    if (!contourOk) {
      try { await page.waitForSelector('.contour-region', { timeout: 60000 }); contourOk = true } catch {}
      if (contourOk) console.log('   ✅ contour-region 检测到')
    }

    // Step 2: 等待 Leaflet 瓦片全量加载（至少 8 块，且全部 loaded）
    try {
      await page.waitForFunction(() => {
        const tiles = document.querySelectorAll('.leaflet-tile-loaded')
        if (tiles.length < 8) return false
        return Array.from(tiles).every(t => t.complete && t.naturalWidth > 0)
      }, { timeout: 90000 })
      console.log('   ✅ Leaflet 瓦片全量加载')
    } catch {
      // 回退：至少 4 块
      try {
        await page.waitForFunction(() => {
          const tiles = document.querySelectorAll('.leaflet-tile-loaded')
          return tiles.length >= 4
        }, { timeout: 30000 })
        console.log('   ⚠️  瓦片部分加载')
      } catch { console.log('   ⚠️  瓦片加载超时') }
    }

    // Step 3: 等待所有 img 标签加载完成
    try {
      await page.waitForFunction(() => {
        const imgs = document.querySelectorAll('img')
        return imgs.length > 0 && Array.from(imgs).every(i => i.complete)
      }, { timeout: 30000 })
      console.log('   ✅ 所有图片加载完成')
    } catch {}

    // Step 4: CSS 动画 + 渲染稳定
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
        const nameMatch = post.title.match(/^(\S+?)(?:今晚|晚霞|今天)/)
        return nameMatch && c.name === nameMatch[1]
      })

      // 🔴 v3.1: 预测帖（无晚霞）— 不打开面板，直接截图+文案
      if (post.isForecast || !cityData || (cityData.score != null && cityData.score < 55)) {
        const idx = String(i + 2).padStart(2, '0')
        const fname = `${idx}-${cityData?.name || post.title.slice(0, 8)}`
        // 使用当前视图截图（全国范围）+ 预测文案
        await page.screenshot({ path: join(OUT_DIR, `${fname}.png`), fullPage: false })
        writeFileSync(join(OUT_DIR, `${fname}.txt`), [
          post.title, '', post.body, '', post.hashtags || '',
        ].join('\n'), 'utf8')
        posts.push({ file: `${fname}.png`, copyFile: `${fname}.txt`, cityId: cityData?.id, cityName: cityData?.name,
          score: cityData?.score, isForecast: true, ...post })
        console.log(`   🟡 ${fname} (预测帖)`)
        continue
      }

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

      // 🔴 v3.2: 用 __wanxia.zoomToCity() 放大到城市（zoom=12）
      // 旧方案 zoom=10 范围太大，截图看起来仍是全国范围
      try {
        const zoomed = await page.evaluate((c) => {
          if (window.__wanxia?.zoomToCity) {
            return window.__wanxia.zoomToCity(c.lat, c.lon, 12)
          }
          // 兜底：直接访问 map
          const mapEl = document.getElementById('map')
          const map = mapEl?._leaflet_map
          if (map && c.lat && c.lon) {
            map.setView([c.lat, c.lon], 12, { animate: false })
            return true
          }
          return false
        }, { lat: cityData.lat, lon: cityData.lon })

        if (zoomed) {
          // 等待瓦片加载：先等 network idle，再验证 tiles
          try { await page.waitForLoadState('networkidle', { timeout: 15000 }) } catch {}
          await wait(3000)  // 额外等待渲染稳定
          try {
            await page.waitForFunction(() => {
              const tiles = document.querySelectorAll('.leaflet-tile-loaded')
              // 放大后至少要有 6 块瓦片
              return tiles.length >= 6 && Array.from(tiles).every(t => t.complete && t.naturalWidth > 0)
            }, { timeout: 30000 })
          } catch { /* 瓦片加载非阻塞 */ }
          await wait(1000)
          console.log(`   🔍 已放大到 ${cityData.name} (zoom=12)`)
        } else {
          console.log(`   ⚠️  zoomToCity 不可用，使用原始视图`)
        }
      } catch (err) {
        console.log(`   ⚠️  缩放失败: ${err.message}`)
      }

      // 等待历史图表渲染
      try {
        await page.waitForFunction(() => {
          const chart = document.getElementById('history-chart')
          return chart?.querySelector('.history-bar') || chart?.querySelector('.history-empty')
        }, { timeout: 8000 })
      } catch {}

      await wait(1500)

      // 截图 — 此时地图应该聚焦在城市上
      await page.screenshot({ path: join(OUT_DIR, `${fname}.png`), fullPage: false })
      writeFileSync(join(OUT_DIR, `${fname}.txt`), [
        post.title,
        '',
        post.body,
        '',
        post.hashtags,
      ].join('\n'), 'utf8')

      posts.push({ file: `${fname}.png`, copyFile: `${fname}.txt`, cityId: cityData.id, cityName: cityData.name, score: cityData.score, tierCn: cityData.tierCn, dominantColor: cityData.dominantColor, sunsetTime: cityData.sunsetTime,
        // 🔴 v3.0: POI 位置数据（小红书挂位置标签提升70%曝光）
        lat: cityData.lat, lon: cityData.lon,
        poiName: getSpots(cityData.name, cityData.score)?.[0] || cityData.name,
        ...post })
      console.log(`   ✅ ${fname} (${cityData.score}分 ${cityData.tierCn})`)

      // Close panel
      if (hasWanxia) {
        await page.evaluate(() => window.__wanxia.closePanel())
      } else {
        await page.click('#panel-close').catch(() => {})
      }
      await wait(800)
    }

    // ═══ 4. GPT-Image-2 封面图生成 ════════════════════════════════════════════
    const coverEnabled = (process.env.GPT_IMAGE_COVER_ENABLED || 'false') === 'true'
    const hasApiKey = !!(process.env.GPT_IMAGE_API_KEY || '')
    if (coverEnabled && hasApiKey && posts.length > 1) {
      console.log(`\n── 封面图生成 (GPT-Image-2) ──`)
      const coverLimit = parseInt(process.env.GPT_IMAGE_COVER_LIMIT || '5')
      try {
        const scriptPath = join(ROOT, 'scripts', 'generate-cover-image.py')
        // execFileSync: 参数数组避免 shell 注入（所有值均来自环境变量，无用户输入）
        const result = execFileSync('python', [scriptPath, '--limit', String(coverLimit), '--posts-dir', OUT_DIR], {
          cwd: ROOT, timeout: 600000, encoding: 'utf-8',
          shell: process.platform === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : '/bin/sh',
        })
        console.log(result.trim())

        // 重新读取 posts.json（Python 已更新封面信息），合并到内存 posts 数组
        try {
          const updated = JSON.parse(readFileSync(join(OUT_DIR, 'posts.json'), 'utf-8'))
          // 将 cover 路径合并回内存中的 posts 数组
          for (const updatedPost of updated.posts || []) {
            const memPost = posts.find(p => p.file === updatedPost.file)
            if (memPost && updatedPost.cover) {
              memPost.cover = updatedPost.cover
              memPost.coverCost = updatedPost.coverCost
            }
          }
          console.log(`   📸 ${updated.covers?.count || 0} 张封面已挂载到帖子`)
        } catch {}
      } catch (err) {
        console.error(`   ⚠️  封面生成失败: ${err.message}`)
        if (err.stderr) console.error(`   ${err.stderr.trim()}`)
      }
    } else if (coverEnabled && !hasApiKey) {
      console.log(`\n── 封面图生成 ── ⚠️  已启用但未配置 GPT_IMAGE_API_KEY`)
    }

    // ═══ 5. Output Summary ════════════════════════════════════════════════════
    const summary = {
      generatedAt: new Date().toISOString(),
      date: data.date,
      summary: data.summary,
      total: posts.length,
      posts: posts.map(p => ({ file: p.file, copyFile: p.copyFile, title: p.title, score: p.score, tierCn: p.tierCn, cityName: p.cityName, dominantColor: p.dominantColor, sunsetTime: p.sunsetTime, cover: p.cover || null })),
    }
    // 如果 covers 信息存在（从 Python 脚本回读），也写入
    if (posts.some(p => p.cover)) {
      summary.hasAICovers = true
    }
    // 保留 Python 写入的 covers 元数据块
    try {
      const prev = JSON.parse(readFileSync(join(OUT_DIR, 'posts.json'), 'utf-8'))
      if (prev.covers) {
        summary.covers = prev.covers
      }
    } catch {}
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
