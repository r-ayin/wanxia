#!/usr/bin/env node
/**
 * CLI: 社交数据深度调查与权重校准
 *
 * Usage:
 *   node scripts/social-calibrate.js [options]
 *
 * Options:
 *   --fetch-days N         Fetch social data for past N days (default: 1 = today)
 *   --date YYYY-MM-DD      Fetch for a specific date only
 *   --backfill-weather     Also fetch actual weather data for the same dates
 *                          (required to enable calibration on historical dates)
 *   --calibrate            Run NNLS calibration after fetching
 *   --report               Print investigation report
 *   --dry-run              Preview without network requests
 *
 * Environment:
 *   WEIBO_COOKIE   Weibo session cookie for historical data
 *                  (browser DevTools → Application → Cookies → s.weibo.com → SUB + SUBP)
 *
 * Examples:
 *   # Fetch 7 days of both social + weather, calibrate, report
 *   WEIBO_COOKIE="..." node scripts/social-calibrate.js --fetch-days 7 --backfill-weather --calibrate --report
 *
 *   # View what's currently stored
 *   node scripts/social-calibrate.js --report
 */

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const __dirname = dirname(fileURLToPath(import.meta.url))
process.chdir(join(__dirname, '..'))

const { initDatabase } = await import('../src/storage.js')
initDatabase()

const { cities } = await import('../src/cities.js')
const { fetchAndStoreSocialData, SOCIAL_CITY_IDS, hasCookie, hasXiaohongshuCookie, cookieStatus } = await import('../src/social-scraper.js')
const { runSocialCalibration, generateInvestigationReport } = await import('../src/social-calibration.js')
const { getWeights } = await import('../src/prediction-engine.js')
const { restoreWeights, fetchActualWeather } = await import('../src/calibration.js')

restoreWeights()

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const getArg = (n, def = null) => { const i = args.indexOf(n); return i >= 0 && args[i+1] ? args[i+1] : def }
const hasFlag = n => args.includes(n)

const fetchDays = parseInt(getArg('--fetch-days', '0'))
const singleDate = getArg('--date')
const doBackfillWeather = hasFlag('--backfill-weather')
const doCalibrate = hasFlag('--calibrate')
const doReport = hasFlag('--report')
const dryRun = hasFlag('--dry-run')

const targetCities = cities.filter(c => SOCIAL_CITY_IDS.includes(c.id))

// ── Banner ────────────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════════════╗')
console.log('║    晚霞预测系统 · 社交校准深度调查                      ║')
console.log('╚══════════════════════════════════════════════════════════╝\n')
const cs = cookieStatus()
console.log(`  微博:   ${cs.weibo ? '✅ 桌面搜索（含历史日期 + 互动采样）' : '⚠️  移动API（近期 | 设 WEIBO_COOKIE 解锁历史）'}`)
console.log(`  小红书: ${cs.xiaohongshu ? '✅ Playwright 无头浏览器（真实签名，反检测）' : '⚠️  未配置 | 设 XIAOHONGSHU_COOKIE 启用双源'}`)
if (cs.dual) console.log('  🟢 双源模式 — 取微博/小红书最高分融合')
console.log(`  当前权重: ${JSON.stringify(getWeights())}`)
console.log(`  目标城市: ${targetCities.length} 个\n`)

// ── Build date list ───────────────────────────────────────────────────────────
const dates = []
if (singleDate) {
  dates.push(singleDate)
} else if (fetchDays > 0) {
  for (let d = 0; d < fetchDays; d++) {
    dates.push(new Date(Date.now() - d * 86400000).toISOString().slice(0, 10))
  }
} else if (!doReport) {
  dates.push(new Date().toISOString().slice(0, 10))
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const bar = (v, w = 18) => '█'.repeat(Math.round(Math.min(Math.max(v||0,0),100)/100*w)) + '░'.repeat(w - Math.round(Math.min(Math.max(v||0,0),100)/100*w))
const fmt = (n, d = 2) => typeof n === 'number' ? n.toFixed(d) : '—'
const colorErr = n => n > 15 ? `\x1b[31m${n>0?'+':''}${n}\x1b[0m` : n < -15 ? `\x1b[34m${n}\x1b[0m` : `\x1b[32m${n>=0?'+':''}${n}\x1b[0m`

// ── Fetch social + weather ────────────────────────────────────────────────────
for (const date of dates) {
  // --- Social ---
  console.log(`── 微博抓取 ${date} (${targetCities.length} 城市) ${'─'.repeat(30)}`)
  if (dryRun) { console.log('  [dry-run] 跳过\n'); continue }

  let ok = 0, failed = 0
  const results = await fetchAndStoreSocialData(targetCities, date, (done, total, r) => {
    const info = r.error
      ? `❌ ${r.cityName}: ${r.error.slice(0, 45)}`
      : `✓ ${r.cityName.padEnd(5)} [${bar(r.socialScore||0,12)}] ${r.socialScore||0}分 帖=${r.postCount}`
    process.stdout.write(`\r  ${String(done).padStart(2)}/${total}  ${info.padEnd(68)}`)
    if (r.error) failed++; else ok++
  })
  process.stdout.write('\n')
  console.log(`  ✓${ok} ❌${failed}`)

  const top = results.filter(r => r.socialScore != null).sort((a, b) => b.socialScore - a.socialScore)
  if (top.length > 0) {
    console.log(`\n  ${date} 社交热度 TOP 8:`)
    for (const r of top.slice(0, 8)) {
      console.log(`    ${r.cityName.padEnd(6)} [${bar(r.socialScore)}] ${r.socialScore}分  帖=${r.postCount}  互动=${r.totalEngagement}`)
    }
  }

  // --- Backfill weather ---
  if (doBackfillWeather) {
    process.stdout.write(`\n  📡 回填 ${date} 气象数据...`)
    try {
      const stored = await fetchActualWeather(date)
      console.log(` ✓ ${stored}/${cities.length} 城市`)
    } catch(e) {
      console.log(` ❌ ${e.message}`)
    }
  }
  console.log()
}

// ── Calibrate ─────────────────────────────────────────────────────────────────
if (doCalibrate && !dryRun) {
  console.log('── NNLS 权重校准 ────────────────────────────────────────────────')
  const res = runSocialCalibration(Math.max(fetchDays, 30))
  if (!res.ok) {
    console.log(`  ⚠️  ${res.reason}`)
    if (dates.length > 0 && !doBackfillWeather) {
      console.log('  💡 提示: 使用 --backfill-weather 回填历史气象数据后再校准\n')
    }
  } else {
    console.log(`  样本: ${res.sampleCount}  Pearson r: ${fmt(res.pearsonBefore,3)} → ${fmt(res.pearsonAfter,3)}  MAE: ${fmt(res.mae,1)}`)
    console.log('\n  新权重 (已更新):')
    for (const [k, v] of Object.entries(res.weights)) {
      console.log(`    ${k.padEnd(22)} [${bar(v*100)}]  ${(v*100).toFixed(1)}%`)
    }
  }
  console.log()
}

// ── Report ────────────────────────────────────────────────────────────────────
if (doReport) {
  console.log('── 深度调查报告 ────────────────────────────────────────────────')
  const rpt = generateInvestigationReport(Math.max(fetchDays || 0, 30))
  if (rpt.error) {
    console.log(`  ⚠️  ${rpt.error}`)
    if (!doBackfillWeather) console.log('  💡 提示: 加 --backfill-weather 回填历史气象数据\n')
  } else {
    const { summary, currentWeights, dimensionCorrelations, falsePositives, falseNegatives, status } = rpt

    console.log(`\n  📊 总览   样本=${summary.sampleCount}  Pearson r=${fmt(summary.pearsonR,3)}  MAE=${fmt(summary.mae,1)}`)

    console.log('\n  🔬 各维度与社交得分相关性:')
    for (const [dim, r] of Object.entries(dimensionCorrelations).sort((a, b) => b[1] - a[1])) {
      const color = r > 0.3 ? '\x1b[32m' : r < 0 ? '\x1b[31m' : '\x1b[33m'
      console.log(`    ${dim.padEnd(22)} ${color}r=${r>=0?'+':''}${fmt(r,3)}\x1b[0m  权重=${(currentWeights[dim]*100).toFixed(1)}%`)
    }

    if (falsePositives.length > 0) {
      console.log('\n  🔴 高估案例 (预测>社交, 误差>10分):')
      console.log('     城市    日期         预测  社交  误差')
      for (const fp of falsePositives.slice(0, 8)) {
        console.log(`     ${(fp.city_name||fp.city_id).padEnd(6)}  ${fp.date}    ${String(fp.predScore).padStart(3)}   ${String(fp.socialScore).padStart(3)}   ${colorErr(fp.error)}`)
      }
    }
    if (falseNegatives.length > 0) {
      console.log('\n  🔵 低估案例 (预测<社交, 误差>10分):')
      console.log('     城市    日期         预测  社交  误差')
      for (const fn of falseNegatives.slice(0, 8)) {
        console.log(`     ${(fn.city_name||fn.city_id).padEnd(6)}  ${fn.date}    ${String(fn.predScore).padStart(3)}   ${String(fn.socialScore).padStart(3)}   ${colorErr(fn.error)}`)
      }
    }

    if (status.byDate?.length > 0) {
      console.log('\n  📅 近7天数据覆盖:')
      for (const d of status.byDate) {
        console.log(`     ${d.date}  ${String(d.city_count).padStart(2)}城市  avg社交=${fmt(d.avg_score,1)}`)
      }
    }
  }
  console.log()
}

console.log('══════════════════════════════════════════════════════════════\n')
