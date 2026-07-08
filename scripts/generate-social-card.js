#!/usr/bin/env node
/**
 * 📸 晚霞预报 → 小红书社交分享卡生成器 (v1.0)
 *
 * 使用 Playwright 渲染专用极简 HTML 卡片，截图作为小红书配图。
 * 相比 screenshot-xhs.js 的地图整页截图，本脚本产出的是：
 *   - 干净的内容卡片（无地图UI控件）
 *   - 小红书风格排版（大字分数 + 一句话文案 + 蹲点推荐）
 *
 * Usage:
 *   node scripts/generate-social-card.js                         # 默认 TOP 5 城市
 *   node scripts/generate-social-card.js --top 3                 # 只生成 TOP 3
 *   node scripts/generate-social-card.js --port 8080             # 指定 wanxia 服务端口
 *   node scripts/generate-social-card.js --output ./posts        # 输出到 posts 目录
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import { writeFileSync, mkdirSync, existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ── CLI args
const args = process.argv.slice(2)
const getArg = (n, def) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : def }
const TOP_N = parseInt(getArg('--top', '5'))
const PORT = parseInt(getArg('--port', '8080'))
const OUT_DIR = getArg('--output', join(ROOT, 'posts'))
const BASE = `http://localhost:${PORT}`
const CARD_W = 1080
const CARD_H = 1350  // 4:5 ratio for 小红书

const absOutDir = resolve(OUT_DIR)

const wait = ms => new Promise(r => setTimeout(r, ms))

// ── Emoji helpers
function scoreEmoji(score) {
  if (score >= 85) return '🔥'
  if (score >= 75) return '🌅'
  if (score >= 65) return '🌇'
  return '☁️'
}

function tierLabel(tierCn) {
  if (tierCn === '极佳') return '🔥 极佳'
  if (tierCn === '好') return '✨ 好'
  return tierCn || '--'
}

// ── Card HTML template (v3.1 — 爆款风格：分数分档调色 + 感官描述 + 机位推荐)
function cardHTML(city, dateStr) {
  const score = city.score || 0
  const emoji = scoreEmoji(score)
  const tier = tierLabel(city.tierCn)
  const colorName = city.dominantColor?.name || '--'
  const time = (() => { try { const d = new Date(city.sunsetTime); return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}` } catch { return '--' } })()
  const spots = (() => {
    const SPOTS = {
      北京:['故宫角楼','景山万春亭','颐和园'],上海:['外滩','浦东滨江','徐汇滨江'],
      广州:['珠江新城','琶洲大桥'],深圳:['深圳湾公园','前海石公园'],
      杭州:['西湖断桥','雷峰塔','宝石山'],成都:['龙泉山','锦城湖'],
      重庆:['南山一棵树','洪崖洞'],武汉:['长江大桥','东湖凌波门'],
      南京:['玄武湖','中山陵'],西安:['城墙南门','曲江池'],
      长沙:['橘子洲头','岳麓山'],天津:['天津之眼','海河故道'],
      苏州:['金鸡湖','太湖'],青岛:['信号山','小麦岛'],
      厦门:['演武大桥','鼓浪屿'],大连:['星海湾','东港'],
      昆明:['滇池海埂','长虫山'],贵阳:['花果园','黔灵山'],
      哈尔滨:['松花江','中央大街'],沈阳:['浑河晚渡','丁香湖'],
      济南:['大明湖','千佛山'],郑州:['大玉米','龙子湖'],
      福州:['鼓山','闽江之心'],南宁:['青秀山','南湖'],
      南昌:['滕王阁','赣江'],合肥:['天鹅湖','巢湖'],
      兰州:['白塔山','中山桥'],呼和浩特:['大召','如意河'],
      乌鲁木齐:['红山公园','南山'],拉萨:['布达拉宫广场','药王山'],
      西宁:['南山公园','湟水河'],银川:['览山公园','贺兰山'],
      海口:['万绿园','假日海滩'],三亚:['椰梦长廊','鹿回头'],
    }
    const s = SPOTS[city.name]
    return s ? s.slice(0, 3).join(' · ') : ''
  })()

  // 🔴 v3.1: 分数分档 — 不同分数用不同配色和文案
  const isGreat = score >= 85
  const isGood = score >= 65
  const gradientTop = isGreat ? '#2d1b00' : isGood ? '#1a1a2e' : '#1a1a2e'
  const gradientMid = isGreat ? '#4a1a00' : isGood ? '#16213e' : '#16213e'
  const gradientBot = isGreat ? '#1a0a00' : isGood ? '#0f3460' : '#1a1a2e'
  const accentColor = isGreat ? '#ff6b35' : isGood ? '#ff8c42' : '#ffd700'
  const glowColor = isGreat ? 'rgba(255,60,0,0.15)' : isGood ? 'rgba(255,107,53,0.08)' : 'rgba(255,200,50,0.05)'

  const oneLiners = score >= 85
    ? ['年度级火烧云预警 🔥', '如果只出门一次就是今天', '史诗级的天空正在加载']
    : score >= 75
    ? ['大概率看到，值得出门', '黄金光线，别错过', '天空在准备一场演出']
    : score >= 65
    ? ['看运气，说不定有惊喜', '带着随缘的心态出门', '有时候这种天反而出片']
    : ['随缘出门，顺其自然', '不抱期待往往有惊喜', '淡季也有淡季的美']

  const oneLiner = oneLiners[Math.abs(score * 7 + city.name.length * 3) % oneLiners.length]
  const dateLabel = dateStr?.slice(5) || new Date().toISOString().slice(5, 10)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:${CARD_W}px; height:${CARD_H}px;
    background: linear-gradient(180deg, ${gradientTop} 0%, ${gradientMid} 40%, ${gradientBot} 100%);
    color: #fff;
    font-family: "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    padding: 60px 80px;
    position: relative;
    overflow: hidden;
  }
  .deco-circle {
    position: absolute;
    border-radius: 50%;
    opacity: 0.06;
    background: radial-gradient(circle, rgba(255,255,255,0.8) 0%, transparent 70%);
  }
  .deco-top { width:500px; height:500px; top:-150px; right:-100px; }
  .deco-bot { width:350px; height:350px; bottom:-100px; left:-80px; }

  .header {
    text-align: center; margin-bottom: 40px; z-index: 1;
  }
  .header .date {
    font-size: 28px; color: rgba(255,255,255,0.5); letter-spacing: 4px; margin-bottom: 8px;
  }
  .header .title {
    font-size: 36px; font-weight: 700; letter-spacing: 2px;
  }

  .score-area {
    text-align: center; margin-bottom: 36px; z-index: 1;
  }
  .score-big {
    font-size: 140px; font-weight: 900; line-height: 1;
    background: linear-gradient(180deg, ${accentColor} 0%, ${accentColor} 40%, #ffd700 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .score-label {
    font-size: 32px; color: rgba(255,255,255,0.7); margin-top: 4px; letter-spacing: 2px;
  }
  .city-name {
    font-size: 64px; font-weight: 800; letter-spacing: 6px; margin-top: 8px;
  }

  .info-row {
    display: flex; gap: 40px; justify-content: center; margin-bottom: 32px; z-index: 1;
  }
  .info-item {
    text-align: center;
  }
  .info-item .val {
    font-size: 36px; font-weight: 700; color: ${accentColor};
  }
  .info-item .lbl {
    font-size: 20px; color: rgba(255,255,255,0.45); margin-top: 4px;
  }

  .one-liner {
    font-size: 28px; color: rgba(255,255,255,0.85); text-align: center;
    max-width: 700px; line-height: 1.6; margin-bottom: 30px; z-index: 1;
    font-style: italic;
  }

  .spot-line {
    font-size: 22px; color: rgba(255,255,255,0.55); text-align: center; z-index: 1;
  }
  .spot-line .pin { color: ${accentColor}; }

  .footer {
    position: absolute; bottom: 40px;
    font-size: 18px; color: rgba(255,255,255,0.25); letter-spacing: 2px;
  }

  .sunset-glow {
    position: absolute; top:30%; left:50%; transform:translate(-50%,-50%);
    width:600px; height:600px;
    background: radial-gradient(ellipse, ${glowColor} 0%, transparent 70%);
    border-radius: 50%;
  }
</style>
</head>
<body>
  <div class="deco-circle deco-top"></div>
  <div class="deco-circle deco-bot"></div>
  <div class="sunset-glow"></div>

  <div class="header">
    <div class="date">📸 晚霞预报 · ${dateLabel}</div>
    <div class="title">${city.name} · 今日晚霞</div>
  </div>

  <div class="score-area">
    <div class="score-big">${score}</div>
    <div class="score-label">${tier}</div>
    <div class="city-name">${emoji} ${city.name}</div>
  </div>

  <div class="info-row">
    <div class="info-item">
      <div class="val">${colorName}</div>
      <div class="lbl">预测色</div>
    </div>
    <div class="info-item">
      <div class="val">${time}</div>
      <div class="lbl">日落时间</div>
    </div>
  </div>

  <div class="one-liner">${oneLiner}</div>

  ${spots ? `<div class="spot-line"><span class="pin">📍</span> ${spots}</div>` : ''}

  <div class="footer">#晚霞预报 #一起看晚霞</div>
</body>
</html>`
}

function nationalCardHTML(data) {
  const { summary, cities } = data
  const great = summary?.tierDistribution?.Great || 0
  const good = summary?.tierDistribution?.Good || 0
  const top3 = (cities || [])
    .filter(c => c.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  const dateLabel = data.date?.slice(5) || new Date().toISOString().slice(5, 10)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:${CARD_W}px; height:${CARD_H}px;
    background: linear-gradient(180deg, #1a1a2e 0%, #16213e 40%, #0f3460 70%, #1a1a2e 100%);
    color: #fff;
    font-family: "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    padding: 60px 80px; position: relative; overflow: hidden;
  }
  .deco-circle {
    position: absolute; border-radius: 50%; opacity: 0.06;
    background: radial-gradient(circle, rgba(255,255,255,0.8) 0%, transparent 70%);
  }
  .deco-top { width:500px; height:500px; top:-150px; right:-100px; }
  .sunset-glow {
    position: absolute; top:40%; left:50%; transform:translate(-50%,-50%);
    width:700px; height:700px;
    background: radial-gradient(ellipse, rgba(255,107,53,0.06) 0%, transparent 70%);
    border-radius: 50%;
  }

  .header { text-align:center; margin-bottom:30px; z-index:1; }
  .header .date { font-size:28px; color:rgba(255,255,255,0.5); letter-spacing:4px; }
  .header .main { font-size:44px; font-weight:800; margin-top:12px; letter-spacing:2px; }

  .stats { display:flex; gap:36px; margin-bottom:36px; z-index:1; }
  .stat { text-align:center; }
  .stat .n { font-size:56px; font-weight:900; }
  .stat .l { font-size:20px; color:rgba(255,255,255,0.45); margin-top:4px; }

  .top-list { z-index:1; width:100%; max-width:700px; }
  .top-row { display:flex; align-items:center; padding:16px 24px; margin-bottom:10px; background:rgba(255,255,255,0.05); border-radius:12px; }
  .top-row .rank { font-size:28px; font-weight:800; color:#ffd700; width:40px; }
  .top-row .name { font-size:30px; font-weight:700; flex:1; }
  .top-row .pts { font-size:32px; font-weight:900; color:#ff6b35; }
  .top-row .tier { font-size:20px; color:rgba(255,255,255,0.5); margin-left:12px; }

  .footer { position:absolute; bottom:40px; font-size:18px; color:rgba(255,255,255,0.25); letter-spacing:2px; }
</style>
</head>
<body>
  <div class="deco-circle deco-top"></div>
  <div class="sunset-glow"></div>

  <div class="header">
    <div class="date">📸 全国晚霞地图 · ${dateLabel}</div>
    <div class="main">${great >= 10 ? '今晚大概率大烧 🔥' : '全国晚霞质量播报'}</div>
  </div>

  <div class="stats">
    <div class="stat"><div class="n" style="color:#ff6b35">${great}</div><div class="l">极佳</div></div>
    <div class="stat"><div class="n" style="color:#ffd700">${good}</div><div class="l">好</div></div>
    <div class="stat"><div class="n">${cities.length}</div><div class="l">城市</div></div>
  </div>

  <div class="top-list">
    ${top3.map((c, i) => `
    <div class="top-row">
      <div class="rank">${i+1}</div>
      <div class="name">${c.name}</div>
      <div class="pts">${c.score}</div>
      <div class="tier">${c.tierCn||''}</div>
    </div>`).join('')}
  </div>

  <div class="footer">#晚霞预报 #一起看晚霞 #日落收集计划</div>
</body>
</html>`
}

// ── Main
async function main() {
  if (!existsSync(absOutDir)) mkdirSync(absOutDir, { recursive: true })

  console.log('╔══════════════════════════════════════════╗')
  console.log('║  📸 小红书社交分享卡生成器 v1.0        ║')
  console.log('╚══════════════════════════════════════════╝')
  console.log(`  尺寸: ${CARD_W}x${CARD_H} (4:5)`)
  console.log(`  TOP: ${TOP_N} 城市`)
  console.log(`  输出: ${absOutDir}\n`)

  // ── Fetch data from wanxia API
  console.log('── 1/3 获取预测数据 ──')
  let data
  try {
    const res = await fetch(`${BASE}/api/predictions`)
    data = await res.json()
    console.log(`   ✅ ${data.cities?.length || 0} 个城市数据`)
  } catch (err) {
    console.error(`   ❌ 无法获取数据: ${err.message}`)
    console.error(`   ⚠️  请确认 wanxia 服务正在运行: cd wanxia && node server.js`)
    process.exit(1)
  }

  const topCities = (data.cities || [])
    .filter(c => c.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N)

  if (!topCities.length) {
    console.error('   ❌ 无有效城市数据')
    process.exit(1)
  }

  console.log(`   📊 TOP ${TOP_N}: ${topCities.map(c => `${c.name}(${c.score})`).join(', ')}`)

  // ── Launch browser
  console.log('\n── 2/3 渲染卡片 ──')
  const browser = await chromium.launch({ headless: true })

  try {
    // National card
    {
      const html = nationalCardHTML(data)
      const tmpPath = join(absOutDir, '.tmp_national.html')
      writeFileSync(tmpPath, html, 'utf-8')

      const page = await browser.newPage()
      await page.setViewportSize({ width: CARD_W, height: CARD_H })
      await page.goto(`file://${tmpPath}`, { waitUntil: 'load' })
      await wait(500)

      const outPath = join(absOutDir, '01-national-card.png')
      await page.screenshot({ path: outPath, fullPage: false })
      console.log(`   ✅ 全国概览卡 → 01-national-card.png`)
      await page.close()
    }

    // City cards
    for (let i = 0; i < topCities.length; i++) {
      const city = topCities[i]
      const idx = String(i + 2).padStart(2, '0')
      const html = cardHTML(city, data.date)
      const tmpPath = join(absOutDir, `.tmp_${city.name}.html`)
      writeFileSync(tmpPath, html, 'utf-8')

      const page = await browser.newPage()
      await page.setViewportSize({ width: CARD_W, height: CARD_H })
      await page.goto(`file://${tmpPath}`, { waitUntil: 'load' })
      await wait(500)

      const outPath = join(absOutDir, `${idx}-${city.name}-card.png`)
      await page.screenshot({ path: outPath, fullPage: false })
      console.log(`   ✅ ${city.name} (${city.score}分) → ${idx}-${city.name}-card.png`)
      await page.close()
    }

    // Cleanup temp files
    const { rmSync } = await import('fs')
    try { rmSync(join(absOutDir, '.tmp_national.html')) } catch {}
    for (const c of topCities) {
      try { rmSync(join(absOutDir, `.tmp_${c.name}.html`)) } catch {}
    }

  } finally {
    await browser.close()
  }

  console.log(`\n${'═'.repeat(50)}`)
  console.log('✅ 全部完成！')
  console.log(`   01-national-card.png  — 全国概览卡`)
  for (let i = 0; i < topCities.length; i++) {
    const idx = String(i + 2).padStart(2, '0')
    console.log(`   ${idx}-${topCities[i].name}-card.png  — ${topCities[i].name}`)
  }
  console.log(`\n📱 可直接上传到小红书 (4:5 比例)`)
}

main().catch(err => {
  console.error(`\n❌ 失败: ${err.message}`)
  process.exit(1)
})
