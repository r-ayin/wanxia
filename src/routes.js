import { Router } from 'express'
import { fetchAllCityData } from './weather-fetcher.js'
import { computeAllPredictions, getWeights } from './prediction-engine.js'
import { cities } from './cities.js'
import { cache } from './cache.js'
import { fetchGridPredictions, GRID_CONFIGS, buildGrid, chunkArray, fetchBatch } from './grid-fetcher.js'
import { buildContourGeoJSON } from './contour-builder.js'
import {
  storeDailyPredictions, storeGridSummary,
  getPredictionHistory, getPredictionsByDate,
  getAccuracyMetrics, getWeightHistory,
  getSocialObservations, getSocialStatus,
} from './storage.js'
import { fetchAndStoreSocialData, hasCookie, hasXiaohongshuCookie, cookieStatus, SOCIAL_CITY_IDS } from './social-scraper.js'
import { runSocialCalibration, generateInvestigationReport } from './social-calibration.js'

const router = Router()

const CONTOUR_TTL = 60 * 60 * 1000

function augmentGridWithCities(gridPoints, cityPredictions) {
  if (!cityPredictions || !cityPredictions.length) return
  for (const city of cityPredictions) {
    let nearest = null, nearestDist = Infinity
    for (const p of gridPoints) {
      const d = (p.lat - city.lat) ** 2 + (p.lon - city.lon) ** 2
      if (d < nearestDist) { nearestDist = d; nearest = p }
    }
    if (nearest && nearestDist < 1.5 && city.score > nearest.score) {
      nearest.score = city.score
      nearest.tier = city.tier
      nearest.tierCn = city.tierCn
    }
  }
}

async function getPredictions() {
  const today = new Date().toISOString().slice(0, 10)
  const cacheKey = `predictions-${today}`

  const cached = cache.get(cacheKey)
  if (cached && !cached.stale) {
    return { ...cached.data, cacheAge: cached.age, fromCache: true }
  }

  if (cache.isLoading(cacheKey)) {
    if (cached) return { ...cached.data, cacheAge: 'stale', fromCache: true, stale: true }
    await new Promise(r => setTimeout(r, 2000))
    const retry = cache.get(cacheKey)
    if (retry) return { ...retry.data, fromCache: true }
  }

  cache.setLoading(cacheKey)
  try {
    const weatherData = await fetchAllCityData()
    const predictions = computeAllPredictions(weatherData, cities)

    const result = {
      generatedAt: new Date().toISOString(),
      date: today,
      cityCount: predictions.length,
      summary: buildSummary(predictions),
      cities: predictions,
    }

    cache.set(cacheKey, result)

    try { storeDailyPredictions(today, predictions) } catch (e) {
      console.error('Storage write failed:', e.message)
    }

    return { ...result, fromCache: false }
  } catch (err) {
    cache.clearLoading(cacheKey)
    if (cached) return { ...cached.data, stale: true, error: err.message }
    throw err
  }
}

function buildSummary(predictions) {
  const tiers = { Great: 0, Good: 0, Fair: 0, Poor: 0 }
  let bestCity = null
  let bestScore = -1

  for (const p of predictions) {
    tiers[p.tier]++
    if (p.score > bestScore) {
      bestScore = p.score
      bestCity = p
    }
  }

  const avgScore = Math.round(predictions.reduce((s, p) => s + p.score, 0) / predictions.length)

  return {
    averageScore: avgScore,
    tierDistribution: tiers,
    bestCity: bestCity ? { name: bestCity.name, nameEn: bestCity.nameEn, score: bestCity.score, tierCn: bestCity.tierCn } : null,
    recommendation: avgScore >= 60
      ? '今日全国晚霞条件较好，建议关注西部和高原地区'
      : avgScore >= 40
        ? '今日部分地区有机会看到不错的晚霞'
        : '今日全国晚霞条件一般',
  }
}

router.get('/predictions', async (req, res) => {
  try {
    // 支持历史日期查询（用于日环比文案）
    const targetDate = req.query.date
    if (targetDate) {
      const historical = getPredictionsByDate(targetDate)
      if (!historical) {
        return res.status(404).json({ error: '该日期无预测数据', date: targetDate })
      }
      return res.json(historical)
    }
    const data = await getPredictions()
    res.json(data)
  } catch (err) {
    console.error('Prediction fetch failed:', err.message)
    res.status(502).json({ error: '气象数据暂时不可用', detail: err.message, retry: 30 })
  }
})

router.get('/predictions/:cityId', async (req, res) => {
  try {
    const data = await getPredictions()
    const city = data.cities.find(c => c.id === req.params.cityId)
    if (!city) return res.status(404).json({ error: '城市未找到' })
    res.json(city)
  } catch (err) {
    res.status(502).json({ error: '气象数据暂时不可用', retry: 30 })
  }
})

router.get('/grid/:name', async (req, res) => {
  try {
    const gridName = req.params.name || 'hangzhou'
    const cacheKey = `grid-${gridName}-${new Date().toISOString().slice(0, 10)}`

    const cached = cache.get(cacheKey)
    if (cached && !cached.stale) {
      return res.json({ ...cached.data, cacheAge: cached.age, fromCache: true })
    }

    if (cache.isLoading(cacheKey)) {
      if (cached) return res.json({ ...cached.data, cacheAge: 'stale', fromCache: true, stale: true })
      await new Promise(r => setTimeout(r, 3000))
      const retry = cache.get(cacheKey)
      if (retry) return res.json({ ...retry.data, fromCache: true })
    }

    cache.setLoading(cacheKey)
    const data = await fetchGridPredictions(gridName)
    cache.set(cacheKey, data)
    res.json(data)
  } catch (err) {
    console.error('Grid fetch failed:', err.message)
    cache.clearLoading(`grid-${req.params.name}-${new Date().toISOString().slice(0, 10)}`)
    res.status(502).json({ error: '网格数据暂时不可用', detail: err.message, retry: 60 })
  }
})

router.get('/contour', async (req, res) => {
  try {
    const gridName = 'national_contour'
    const today = new Date().toISOString().slice(0, 10)
    const cacheKey = `contour-${today}`

    const cached = cache.get(cacheKey)
    if (cached && !cached.stale) {
      return res.json({ ...cached.data, fromCache: true })
    }

    if (cache.isLoading(cacheKey)) {
      if (cached) return res.json({ ...cached.data, fromCache: true, stale: true })
      await new Promise(r => setTimeout(r, 5000))
      const retry = cache.get(cacheKey)
      if (retry) return res.json({ ...retry.data, fromCache: true })
    }

    cache.setLoading(cacheKey)

    const gridData = await fetchGridPredictions(gridName)

    try {
      const predData = await getPredictions()
      augmentGridWithCities(gridData.points, predData.cities)
    } catch (e) {}

    const contours = buildContourGeoJSON(gridData.points, gridData.config)

    const total = gridData.points.length
    const tiers = { Great: 0, Good: 0, Fair: 0, Poor: 0 }
    for (const p of gridData.points) tiers[p.tier]++
    const avgScore = total > 0 ? Math.round(gridData.points.reduce((s, p) => s + p.score, 0) / total) : 0

    const result = {
      generatedAt: gridData.generatedAt,
      pointCount: total,
      contours,
      summary: {
        avgScore,
        greatPct: Math.round(tiers.Great / total * 100),
        goodPct: Math.round(tiers.Good / total * 100),
        fairPct: Math.round(tiers.Fair / total * 100),
        poorPct: Math.round(tiers.Poor / total * 100),
      },
    }

    cache.set(cacheKey, result, CONTOUR_TTL)

    try { storeGridSummary(today, gridName, gridData.points) } catch (e) {
      console.error('Grid summary storage failed:', e.message)
    }

    res.json(result)
  } catch (err) {
    console.error('Contour generation failed:', err.message)
    cache.clearLoading(`contour-${new Date().toISOString().slice(0, 10)}`)
    res.status(502).json({ error: '等值面数据生成失败', detail: err.message, retry: 120 })
  }
})

router.get('/contour/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const today = new Date().toISOString().slice(0, 10)
  const cacheKey = `contour-${today}`
  const cached = cache.get(cacheKey)

  if (cached && !cached.stale) {
    res.write(`data: ${JSON.stringify({ type: 'complete', contours: cached.data.contours, summary: cached.data.summary, pointCount: cached.data.pointCount, points: cached.data.points })}\n\n`)
    res.end()
    return
  }

  const gridName = 'national_contour'
  const config = GRID_CONFIGS[gridName]
  const points = buildGrid(config)
  const chunks = chunkArray(points, 200)
  const allResults = []

  try {
    for (let i = 0; i < chunks.length; i++) {
      if (res.destroyed) return

      const batchResults = await fetchBatch(chunks[i], config)
      allResults.push(...batchResults)

      res.write(`data: ${JSON.stringify({
        type: 'batch',
        batch: i + 1,
        total: chunks.length,
        points: batchResults,
        step: config.step,
      })}\n\n`)

      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 1000))
      }
    }

    try {
      const predData = await getPredictions()
      augmentGridWithCities(allResults, predData.cities)
    } catch (e) {}

    const contours = buildContourGeoJSON(allResults, config)
    const total = allResults.length
    const tiers = { Great: 0, Good: 0, Fair: 0, Poor: 0 }
    for (const p of allResults) tiers[p.tier]++
    const avgScore = total > 0 ? Math.round(allResults.reduce((s, p) => s + p.score, 0) / total) : 0

    const result = {
      generatedAt: new Date().toISOString(),
      pointCount: total,
      contours,
      points: allResults,
      summary: {
        avgScore,
        greatPct: Math.round(tiers.Great / total * 100),
        goodPct: Math.round(tiers.Good / total * 100),
        fairPct: Math.round(tiers.Fair / total * 100),
        poorPct: Math.round(tiers.Poor / total * 100),
      },
    }

    cache.set(cacheKey, result, CONTOUR_TTL)

    res.write(`data: ${JSON.stringify({ type: 'complete', contours, summary: result.summary, pointCount: total, points: allResults })}\n\n`)
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`)
  }

  res.end()
})

router.get('/history/:cityId', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90)
    const history = getPredictionHistory(req.params.cityId, days)
    res.json({ cityId: req.params.cityId, days, records: history })
  } catch (err) {
    res.status(500).json({ error: '历史数据查询失败', detail: err.message })
  }
})

router.get('/accuracy', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 14, 90)
    const metrics = getAccuracyMetrics(days)
    const currentWeights = getWeights()
    res.json({ days, ...metrics, currentWeights })
  } catch (err) {
    res.status(500).json({ error: '精度数据查询失败', detail: err.message })
  }
})

router.get('/weights/history', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90)
    const history = getWeightHistory(days)
    res.json({ days, records: history })
  } catch (err) {
    res.status(500).json({ error: '权重历史查询失败', detail: err.message })
  }
})

router.get('/health', (req, res) => {
  const today = new Date().toISOString().slice(0, 10)
  const cached = cache.get(`predictions-${today}`)
  const contourCached = cache.get(`contour-${today}`)
  res.json({
    status: 'ok',
    cacheStatus: cached ? (cached.stale ? 'stale' : 'fresh') : 'empty',
    contourCacheStatus: contourCached ? (contourCached.stale ? 'stale' : 'fresh') : 'empty',
    cityCount: cities.length,
    currentWeights: getWeights(),
  })
})

// ── Social calibration endpoints ──────────────────────────────────────────────

router.get('/social/status', (req, res) => {
  try {
    const status = getSocialStatus()
    const cookies = cookieStatus()
    res.json({
      ...status,
      ...cookies,
      weiboMode: hasCookie() ? 'desktop-search' : 'mobile-api',
      xiaohongshuMode: hasXiaohongshuCookie() ? 'enabled' : 'disabled',
      note: !cookies.dual ? '双源验证未激活：微博cookie=' + (cookies.weibo ? '✅' : '❌') + ' · 小红书cookie=' + (cookies.xiaohongshu ? '✅' : '❌') : null,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/social/fetch', async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  let ok = 0, failed = 0
  try {
    await fetchAndStoreSocialData(cities, date, (done, total, result) => {
      if (!result.error) ok++; else failed++
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify({ done, total, city: result.cityName, score: result.socialScore, error: result.error || null })}\n\n`)
      }
    })
    if (!res.destroyed) {
      res.write(`data: ${JSON.stringify({ type: 'complete', date, ok, failed })}\n\n`)
    }
  } catch (err) {
    if (!res.destroyed) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`)
    }
  }
  res.end()
})

router.post('/social/calibrate', (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90)
    const result = runSocialCalibration(days)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/social/report', (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90)
    const report = generateInvestigationReport(days)
    res.json(report)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/social/history/:cityId', (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90)
    const obs = getSocialObservations(req.params.cityId, days)
    res.json({ cityId: req.params.cityId, days, records: obs })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
