import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import cron from 'node-cron'
import routes from './src/routes.js'
import { initDatabase } from './src/storage.js'
import { restoreWeights, runDailyCalibration, fetchActualWeather } from './src/calibration.js'
import { fetchAndStoreSocialData, hasCookie, SOCIAL_CITY_IDS } from './src/social-scraper.js'
import { runSocialCalibration } from './src/social-calibration.js'
import { cities } from './src/cities.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = 8080

initDatabase()
restoreWeights()

app.use(express.static(join(__dirname, 'public')))
app.use('/api', routes)

// 22:00 CST — fetch today's social data for cities with enough Weibo activity
cron.schedule('0 22 * * *', async () => {
  if (!hasCookie()) {
    console.log('[cron] Skipping social fetch — WEIBO_COOKIE not set')
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
  }
}, { timezone: 'Asia/Shanghai' })

// 23:00 CST — backfill yesterday's actual weather + run weather calibration
cron.schedule('0 23 * * *', () => {
  console.log('[cron] Running daily weather calibration...')
  runDailyCalibration()
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

app.listen(PORT, () => {
  console.log(`🌅 全国晚霞预测系统已启动: http://localhost:${PORT}`)
})

