import { readFileSync } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
const execAsync = promisify(exec)
const envLines = readFileSync(new URL('.env', import.meta.url), 'utf8')
  .split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))
const env = Object.fromEntries(
  envLines.map(l => {
    const i = l.indexOf('=')
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
  })
)
for (const [k, v] of Object.entries(env)) process.env[k] = v

import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import cron from 'node-cron'
import routes from './src/routes.js'
import { initDatabase } from './src/storage.js'
import { restoreWeights, runDailyCalibration, fetchActualWeather } from './src/calibration.js'
import { fetchAndStoreSocialData, hasCookie, hasXiaohongshuCookie, closeBrowser, SOCIAL_CITY_IDS } from './src/social-scraper.js'
import { runSocialCalibration } from './src/social-calibration.js'
import { startPrefetchScheduler } from './src/prefetch-scheduler.js'
import { cities } from './src/cities.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = 8080

initDatabase()
restoreWeights()

app.use(express.static(join(__dirname, 'public')))
app.use('/api', routes)

// 🕐 启动预取调度器 — 定时从 open-meteo 拉数据写入内存缓存
// 错峰启动: cities T+0s / hangzhou T+60s / national T+120s
startPrefetchScheduler()

// 22:00 CST — daily calibration (weather backfill + weight optimization)
// 同时尝试采集社媒数据作为校准输入（需要 Cookie，无则跳过）
cron.schedule('0 22 * * *', async () => {
  // ① 天气回填 + 权重校准
  console.log('[cron] Running daily weather calibration...')
  try {
    await runDailyCalibration()
  } catch (err) {
    console.error('[cron] Weather calibration failed:', err.message)
  }

  // ② 社媒数据采集（校正输入源，需配置 Cookie）
  if (!hasCookie() && !hasXiaohongshuCookie()) {
    console.log('[cron] Skipping social fetch — no Cookie configured')
    return
  }
  const today = new Date().toISOString().slice(0, 10)
  console.log(`[cron] Fetching social data for ${today}...`)
  try {
    const results = await fetchAndStoreSocialData(cities, today)
    const ok = results.filter(r => !r.error && r.socialScore !== null).length
    console.log(`[cron] Social fetch done: ${ok}/${results.length} cities scored`)
  } catch (err) {
    console.error('[cron] Social fetch failed:', err.message)
  } finally {
    await closeBrowser()
  }
}, { timezone: 'Asia/Shanghai' })

// 12:00 CST — generate XHS content package (文案 + GPT-Image-2 封面图，无需浏览器截图)
cron.schedule('0 12 * * *', async () => {
  const cwd = new URL('.', import.meta.url).pathname
  console.log('[cron] Generating XHS content package (copywriting + AI covers)...')
  try {
    // generate-content.js: 纯 API 管线，无需 Playwright/Chromium
    // 超时: API 封面 ~5min(5张×1min)，设 10min 安全边界
    const { stdout, stderr } = await execAsync('node scripts/generate-content.js', {
      cwd,
      timeout: 600000,  // 10min
      shell: process.platform === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : '/bin/sh',
    })
    if (stdout) console.log(stdout.trim())
    if (stderr) console.error(stderr.trim())
  } catch (err) {
    console.error('[cron] Content generation failed:', err.message)
  }
}, { timezone: 'Asia/Shanghai' })

// 23:30 CST — run social calibration using yesterday's social + backfilled weather
cron.schedule('30 23 * * *', async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  console.log(`[cron] Running social calibration (yesterday=${yesterday})...`)
  try {
    // Ensure yesterday's actual weather is available for joining
    await fetchActualWeather(yesterday).catch(() => {})
    const result = runSocialCalibration(30)
    if (result?.sampleCount > 0) {
      console.log(`[cron] Social calibration done: ${result.sampleCount} pairs, r=${result.correlation?.toFixed(3)}`)
    } else {
      console.log('[cron] Social calibration skipped — insufficient data')
    }
  } catch (err) {
    console.error('[cron] Social calibration failed:', err.message)
  }
}, { timezone: 'Asia/Shanghai' })

// 🔴 2026-06-20: Cookie 保活已禁用——小红书检测到自动化脚本，不再自动发帖
// cron.schedule('57 */4 * * *', async () => { ... })

app.listen(PORT, () => {
  console.log(`🌅 全国晚霞预测系统已启动: http://localhost:${PORT}`)
})

