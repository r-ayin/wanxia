import { Router } from 'express'
import { cache } from './cache.js'
import {
  getPredictionHistory, getPredictionsByDate,
  getAccuracyMetrics, getWeightHistory,
  getSocialObservations, getSocialStatus,
} from './storage.js'
import { fetchAndStoreSocialData, hasCookie, hasXiaohongshuCookie, cookieStatus, SOCIAL_CITY_IDS } from './social-scraper.js'
import { runSocialCalibration, generateInvestigationReport } from './social-calibration.js'
import { getWeights } from './prediction-engine.js'
import { cities } from './cities.js'

const router = Router()

// ── 缓存优先读取辅助函数 ──────────────────────────────────────────
// 所有气象数据端点只读内存缓存（由 prefetch-scheduler.js 定时填充）
// 永不穿透到 open-meteo API

/**
 * 从缓存读数据，提供降级响应
 * @param {string} cacheKey - 缓存键
 * @param {string} label - 人类可读的数据类型名（用于错误信息）
 * @returns {{ data: any, status: number, error?: string, detail?: string, retry?: number }}
 */
function readFromCache(cacheKey, label) {
  const entry = cache.get(cacheKey)

  if (entry) {
    // 有缓存数据 — 无论 fresh/stale 都返回
    return {
      data: {
        ...entry.data,
        cacheAge: entry.age,
        fromCache: true,
        ...(entry.stale ? { stale: true } : {}),
      },
      status: 200,
    }
  }

  // 缓存完全为空 — 冷启动阶段，尚未完成首轮预取
  return {
    data: {
      error: `${label}正在预热中`,
      detail: '预取调度器尚未完成首轮数据拉取，请稍后刷新',
      retry: 30,
      fromCache: false,
      warming: true,
    },
    status: 503,
  }
}

// ── 城市预报 ──────────────────────────────────────────────────────

router.get('/predictions', (req, res) => {
  // 历史日期查询走 SQLite，不走缓存
  const targetDate = req.query.date
  if (targetDate) {
    const historical = getPredictionsByDate(targetDate)
    if (!historical) {
      return res.status(404).json({ error: '该日期无预测数据', date: targetDate })
    }
    return res.json(historical)
  }

  const today = new Date().toISOString().slice(0, 10)
  const cacheKey = `predictions-${today}`
  const { data, status } = readFromCache(cacheKey, '城市预报数据')
  res.status(status).json(data)
})

router.get('/predictions/:cityId', (req, res) => {
  const today = new Date().toISOString().slice(0, 10)
  const cacheKey = `predictions-${today}`
  const { data, status } = readFromCache(cacheKey, '城市预报数据')

  if (status !== 200) {
    return res.status(status).json(data)
  }

  const city = data.cities?.find(c => c.id === req.params.cityId)
  if (!city) return res.status(404).json({ error: '城市未找到' })
  res.json(city)
})

// ── 网格数据 ──────────────────────────────────────────────────────

// 城市网格列表（前端按钮动态渲染）
router.get('/grids', (req, res) => {
  res.json([
    { id: 'national', name: '全国', center: [35.0, 105.0], zoom: 4, isNational: true },
    { id: 'hangzhou', name: '杭州', center: [30.0, 120.2], zoom: 8 },
    { id: 'shanghai', name: '上海', center: [31.2, 121.5], zoom: 8 },
    { id: 'beijing', name: '北京', center: [39.9, 116.4], zoom: 8 },
    { id: 'chengdu', name: '成都', center: [30.6, 104.1], zoom: 8 },
    { id: 'guangzhou', name: '广州', center: [23.1, 113.3], zoom: 8 },
    { id: 'xiamen', name: '厦门', center: [24.5, 118.1], zoom: 9 },
    { id: 'kunming', name: '昆明', center: [25.0, 102.7], zoom: 8 },
  ])
})

router.get('/grid/:name', (req, res) => {
  const gridName = req.params.name || 'hangzhou'
  const today = new Date().toISOString().slice(0, 10)
  const cacheKey = `grid-${gridName}-${today}`
  const { data, status } = readFromCache(cacheKey, '网格数据')
  res.status(status).json(data)
})

// ── 等值面（非流式） ──────────────────────────────────────────────

router.get('/contour', (req, res) => {
  const today = new Date().toISOString().slice(0, 10)
  const cacheKey = `contour-${today}`
  const { data, status } = readFromCache(cacheKey, '等值面数据')
  res.status(status).json(data)
})

// ── 等值面（SSE 流式） ────────────────────────────────────────────

router.get('/contour/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const today = new Date().toISOString().slice(0, 10)

  // 优先查 contour 缓存（含 contours + points）
  const contourKey = `contour-${today}`
  const contourEntry = cache.get(contourKey)
  if (contourEntry) {
    const d = contourEntry.data
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      contours: d.contours,
      summary: d.summary,
      pointCount: d.pointCount,
      points: d.points,
    })}\n\n`)
    res.end()
    return
  }

  // 降级：查网格原始数据缓存（无等值面，但有点数据）
  const gridKey = `grid-national_contour-${today}`
  const gridEntry = cache.get(gridKey)
  if (gridEntry) {
    const d = gridEntry.data
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      points: d.points,
      pointCount: d.points?.length || 0,
      contours: null,
      summary: null,
      degraded: true,
      message: '等值面尚未生成，使用网格点数据',
    })}\n\n`)
    res.end()
    return
  }

  // 完全无缓存 — 预热中
  res.write(`data: ${JSON.stringify({
    type: 'error',
    message: '数据正在预热中，请稍后刷新',
    retry: 30,
  })}\n\n`)
  res.end()
})

// ── 历史数据 ──────────────────────────────────────────────────────

router.get('/history/:cityId', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90)
    const history = getPredictionHistory(req.params.cityId, days)
    res.json({ cityId: req.params.cityId, days, records: history })
  } catch (err) {
    console.error('Route error:', err)
    res.status(500).json({ error: '历史数据查询失败' })
  }
})

router.get('/accuracy', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 14, 90)
    const metrics = getAccuracyMetrics(days)
    const currentWeights = getWeights()
    res.json({ days, ...metrics, currentWeights })
  } catch (err) {
    console.error('Route error:', err)
    res.status(500).json({ error: '精度数据查询失败' })
  }
})

router.get('/weights/history', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90)
    const history = getWeightHistory(days)
    res.json({ days, records: history })
  } catch (err) {
    console.error('Route error:', err)
    res.status(500).json({ error: '权重历史查询失败' })
  }
})

router.get('/health', (req, res) => {
  const today = new Date().toISOString().slice(0, 10)
  const predEntry = cache.get(`predictions-${today}`)
  const contourEntry = cache.get(`contour-${today}`)
  const gridHZ = cache.get(`grid-hangzhou-${today}`)
  const gridNatl = cache.get(`grid-national_contour-${today}`)

  res.json({
    status: 'ok',
    cache: {
      predictions: predEntry ? (predEntry.stale ? 'stale' : 'fresh') : 'empty',
      contour: contourEntry ? (contourEntry.stale ? 'stale' : 'fresh') : 'empty',
      'grid-hangzhou': gridHZ ? (gridHZ.stale ? 'stale' : 'fresh') : 'empty',
      'grid-national': gridNatl ? (gridNatl.stale ? 'stale' : 'fresh') : 'empty',
    },
    cityCount: cities.length,
    currentWeights: getWeights(),
    dataSource: 'prefetch-cache', // 标记数据来源，便于排查
  })
})

// ── 社媒校准（不变） ──────────────────────────────────────────────

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
    console.error('Route error:', err)
    res.status(500).json({ error: '社媒状态查询失败' })
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
    console.error('Route error:', err)
    if (!res.destroyed) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: '数据获取失败' })}\n\n`)
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
    console.error('Route error:', err)
    res.status(500).json({ error: '社媒校准失败' })
  }
})

router.get('/social/report', (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90)
    const report = generateInvestigationReport(days)
    res.json(report)
  } catch (err) {
    console.error('Route error:', err)
    res.status(500).json({ error: '报告生成失败' })
  }
})

router.get('/social/history/:cityId', (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90)
    const obs = getSocialObservations(req.params.cityId, days)
    res.json({ cityId: req.params.cityId, days, records: obs })
  } catch (err) {
    console.error('Route error:', err)
    res.status(500).json({ error: '社媒历史查询失败' })
  }
})

export default router
