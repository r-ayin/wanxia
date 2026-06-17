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
import { cities } from './src/cities.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = 8080

initDatabase()
restoreWeights()

app.use(express.static(join(__dirname, 'public')))
app.use('/api', routes)

// 22:00 CST — fetch today's social data for cities with enough social media activity
cron.schedule('0 22 * * *', async () => {
  if (!hasCookie() && !hasXiaohongshuCookie()) {
    console.log('[cron] Skipping social fetch — neither WEIBO_COOKIE nor XIAOHONGSHU_COOKIE set')
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

// 22:30 CST — generate XHS publish material package (screenshots + copy + posts.json)
cron.schedule('30 22 * * *', async () => {
  console.log('[cron] Generating XHS publish package...')
  try {
    const { stdout, stderr } = await execAsync('node scripts/publish-xhs.js', {
      cwd: new URL('.', import.meta.url).pathname,
      timeout: 120000,
    })
    if (stdout) console.log(stdout.trim())
    if (stderr) console.error(stderr.trim())

    // 22:35 CST — Browser Use 自动发帖（通过 BROWSER_USE_AUTO_POST=true 开关控制）
    if (process.env.BROWSER_USE_AUTO_POST === 'true' && process.env.ANTHROPIC_API_KEY) {
      console.log('[cron] Starting Browser Use auto-posting...')
      const limit = parseInt(process.env.BROWSER_USE_POST_LIMIT || '3')
      try {
        const { stdout: postOut, stderr: postErr } = await execAsync(
          `python scripts/post_xhs_browseruse.py --headless true --limit ${limit} --delay-between 60`,
          { cwd: new URL('.', import.meta.url).pathname, timeout: 600000 }  // 10min for LLM trips
        )
        if (postOut) console.log(postOut.trim())
        if (postErr) console.error(postErr.trim())
      } catch (postErr) {
        console.error('[cron] Browser Use posting failed:', postErr.message)
      }
    }
  } catch (err) {
    console.error('[cron] Publish package generation failed:', err.message)
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

// 🫀 每 4 小时保活小红书 Cookie — 访问 creator.xiaohongshu.com 刷新 session
cron.schedule('57 */4 * * *', async () => {
  console.log('[cron] XHS cookie keepalive check...')
  try {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)
    const { stdout, stderr } = await execAsync('python scripts/xhs_keepalive.py --cron', {
      cwd: new URL('.', import.meta.url).pathname,
      timeout: 60000,
    })
    if (stderr) console.error('[cron] XHS keepalive error:', stderr.trim())
  } catch (err) {
    console.error('[cron] XHS keepalive failed:', err.message)
  }
}, { timezone: 'Asia/Shanghai' })

app.listen(PORT, () => {
  console.log(`🌅 全国晚霞预测系统已启动: http://localhost:${PORT}`)
})

