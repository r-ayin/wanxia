import { computeSunsetScore } from './prediction-engine.js'
import { fetch7TimerBatch } from './seven-timer-fetcher.js'

// ── API 鉴权（懒加载：import hoisting 后 .env 才就绪） ────
// .env 中配置 OPEN_METEO_API_KEY 后，请求附加 x-api-key Header
let _apiKeyCache = undefined
function apiKey() {
  if (_apiKeyCache === undefined) {
    _apiKeyCache = process.env.OPEN_METEO_API_KEY || ''
    if (_apiKeyCache) console.log('[grid] 使用 API Key 鉴权 (x-api-key)')
  }
  return _apiKeyCache
}

// ── 代理支持 ──────────────────────────────────────────────────
// 读取 HTTPS_PROXY 环境变量，通过独立 IP 代理绕过沙箱共享 IP 限流
let dispatcher = undefined
try {
  const { ProxyAgent } = await import('undici')
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
  if (proxyUrl) {
    dispatcher = new ProxyAgent({ uri: proxyUrl })
    console.log(`[grid] 使用代理: ${proxyUrl}`)
  }
} catch {
  // undici 不可用时降级（不影响运行，仅无代理）
}

// ── 请求频率控制 ────────────────────────────────────────────────
const BATCH_SIZE = 500  // 增大批次减少请求数（全国 2331 点 → 5 批 → 10 次请求）
const BATCH_DELAY_MS = 10000  // 批次间延迟 10 秒（~6 req/min，远低于 10/min 限额）

// 全局并发信号量 — 防止多个预取任务同时向 open-meteo 发请求
let inFlight = 0
const MAX_CONCURRENT = 1  // 严格串行，避免任何并发

async function acquireSlot() {
  while (inFlight >= MAX_CONCURRENT) {
    await new Promise(r => setTimeout(r, 200))
  }
  inFlight++
}

function releaseSlot() {
  inFlight--
}

// ── 网格配置 ────────────────────────────────────────────────────

export const GRID_CONFIGS = {
  hangzhou: {
    name: '杭州及周边', center: [30.0, 120.2], zoom: 8,
    latMin: 28.5, latMax: 31.5, lonMin: 118.5, lonMax: 122.0,
    step: 0.25, region: 'east', elevation: 20,
  },
  shanghai: {
    name: '上海及周边', center: [31.2, 121.5], zoom: 8,
    latMin: 30.5, latMax: 32.0, lonMin: 120.8, lonMax: 122.2,
    step: 0.2, region: 'east', elevation: 4,
  },
  beijing: {
    name: '北京及周边', center: [39.9, 116.4], zoom: 8,
    latMin: 39.4, latMax: 41.0, lonMin: 115.8, lonMax: 117.5,
    step: 0.2, region: 'north', elevation: 49,
  },
  chengdu: {
    name: '成都及周边', center: [30.6, 104.1], zoom: 8,
    latMin: 30.0, latMax: 31.5, lonMin: 103.5, lonMax: 105.0,
    step: 0.2, region: 'southwest', elevation: 500,
  },
  guangzhou: {
    name: '广州及周边', center: [23.1, 113.3], zoom: 8,
    latMin: 22.5, latMax: 23.8, lonMin: 112.8, lonMax: 114.0,
    step: 0.2, region: 'south', elevation: 21,
  },
  xiamen: {
    name: '厦门及周边', center: [24.5, 118.1], zoom: 9,
    latMin: 24.0, latMax: 25.0, lonMin: 117.6, lonMax: 118.8,
    step: 0.15, region: 'south', elevation: 10,
  },
  kunming: {
    name: '昆明及周边', center: [25.0, 102.7], zoom: 8,
    latMin: 24.4, latMax: 25.6, lonMin: 102.2, lonMax: 103.4,
    step: 0.2, region: 'plateau', elevation: 1890,
  },
  national: {
    name: '全国', center: [35.0, 105.0], zoom: 4,
    latMin: 18, latMax: 54, lonMin: 73, lonMax: 135,
    step: 1.0, region: 'mixed', elevation: 100,
  },
  national_contour: {
    name: '全国等值面', center: [35.0, 105.0], zoom: 4,
    latMin: 18, latMax: 54, lonMin: 73, lonMax: 135,
    step: 1.0, region: 'mixed', elevation: 100,
  },
}

// 前端城市按钮按此顺序渲染（不包括 national/national_contour）
export const CITY_GRIDS = ['hangzhou', 'shanghai', 'beijing', 'chengdu', 'guangzhou', 'xiamen', 'kunming']

export function buildGrid(config) {
  const points = []
  for (let lat = config.latMin; lat <= config.latMax; lat += config.step) {
    for (let lon = config.lonMin; lon <= config.lonMax; lon += config.step) {
      points.push({ lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 })
    }
  }
  return points
}

function regionForPoint(lat, lon) {
  if (lat > 30 && lon < 105) return 'plateau'
  if (lat > 40 && lon > 115) return 'northeast'
  if (lat > 35 && lon < 110) return 'northwest'
  if (lat < 25 && lon > 105) return 'south'
  if (lon > 115) return 'east'
  if (lon < 105) return 'southwest'
  return 'north'
}

export function chunkArray(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ── 带重试和并发控制的 HTTP 请求 ───────────────────────────────

/**
 * 请求 open-meteo API，带指数退避重试 + jitter + 全局并发控制。
 * 导出供 weather-fetcher.js 等模块复用。
 *
 * @param {string} url - API URL
 * @param {number} retries - 最大重试次数
 * @returns {Promise<object>} JSON 响应
 */
export async function fetchJSON(url, retries = 5) {
  for (let i = 0; i < retries; i++) {
    await acquireSlot()
    try {
      const opts = {}
      if (dispatcher) opts.dispatcher = dispatcher
      if (apiKey()) opts.headers = { 'x-api-key': apiKey() }
      const res = await fetch(url, opts)
      if (res.status === 429) {
        releaseSlot()
        // 指数退避 + jitter 防惊群（首轮等待更长，给 API 喘息空间）
        const wait = 5000 * (i + 1) + Math.random() * 3000
        console.log(`[grid] Rate limited, waiting ${Math.round(wait)}ms (retry ${i + 1}/${retries})`)
        await delay(wait)
        continue
      }
      if (!res.ok) {
        releaseSlot()
        throw new Error(`API ${res.status}`)
      }
      const data = await res.json()
      releaseSlot()
      return data
    } catch (err) {
      releaseSlot()
      // 非 429 的网络错误也重试（但给更短等待）
      if (i < retries - 1 && err.message !== 'API 429 after retries' && !err.message.startsWith('API ')) {
        const wait = 1000 * (i + 1) + Math.random() * 1000
        console.log(`[grid] Network error, waiting ${Math.round(wait)}ms (retry ${i + 1}/${retries}): ${err.message}`)
        await delay(wait)
        continue
      }
      throw err
    }
  }
  throw new Error('API 429 after retries')
}

// ── URL 构建 ────────────────────────────────────────────────────

function buildWeatherURL(lats, lons) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,pressure_msl,visibility,relative_humidity_500hPa,relative_humidity_300hPa,vertical_velocity_500hPa&daily=sunset&timezone=Asia/Shanghai&forecast_days=1`
}

function buildAQURL(lats, lons) {
  return `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}&hourly=aerosol_optical_depth&timezone=Asia/Shanghai&forecast_days=1`
}

// ── 数据处理 ────────────────────────────────────────────────────

function processPointData(point, weatherItem, aqItem, config) {
  if (!weatherItem) return null

  try {
    const sunsetStr = weatherItem.daily.sunset[0]
    const sunsetH = parseInt(sunsetStr.split('T')[1].split(':')[0], 10)
    const h = weatherItem.hourly
    const at = (arr) => arr ? arr[sunsetH] : null
    const pStart = Math.max(0, sunsetH - 5)

    const data = {
      sunsetTime: sunsetStr,
      cloudCoverHigh: at(h.cloud_cover_high),
      cloudCoverMid: at(h.cloud_cover_mid),
      cloudCoverLow: at(h.cloud_cover_low),
      cloudCover: at(h.cloud_cover),
      rh2m: at(h.relative_humidity_2m),
      rh500: at(h.relative_humidity_500hPa),
      rh300: at(h.relative_humidity_300hPa),
      omega500: at(h.vertical_velocity_500hPa),
      visibility: at(h.visibility),
      pressureArray: h.pressure_msl ? h.pressure_msl.slice(pStart, sunsetH + 1) : [],
      aod: aqItem ? at(aqItem.hourly.aerosol_optical_depth) : null,
    }

    const city = { region: regionForPoint(point.lat, point.lon), elevation: config.elevation }
    const prediction = computeSunsetScore(data, city)

    return {
      lat: point.lat,
      lon: point.lon,
      score: prediction.score,
      tier: prediction.tier,
      tierCn: prediction.tierCn,
    }
  } catch {
    return null
  }
}

// ── 批量获取 ────────────────────────────────────────────────────

export async function fetchBatch(batchPoints, config) {
  const lats = batchPoints.map(p => p.lat).join(',')
  const lons = batchPoints.map(p => p.lon).join(',')

  const weatherData = await fetchJSON(buildWeatherURL(lats, lons))
  await delay(5000)  // weather 与 AQ 间隔 5 秒
  const aqData = await fetchJSON(buildAQURL(lats, lons)).catch(() => null)

  const weatherArr = Array.isArray(weatherData) ? weatherData : [weatherData]
  const aqArr = aqData ? (Array.isArray(aqData) ? aqData : [aqData]) : []

  const results = []
  for (let i = 0; i < batchPoints.length; i++) {
    const result = processPointData(batchPoints[i], weatherArr[i], aqArr[i] || null, config)
    if (result) results.push(result)
  }
  return results
}

// ── 网格点降采样（7Timer! 降级用） ─────────────────────────────

function downsamplePoints(points, targetCount) {
  if (points.length <= targetCount) return points
  const step = Math.floor(points.length / targetCount)
  return points.filter((_, i) => i % step === 0).slice(0, targetCount)
}

// ── 网格预测总入口 ──────────────────────────────────────────────

export async function fetchGridPredictions(gridName = 'hangzhou') {
  const config = GRID_CONFIGS[gridName]
  if (!config) throw new Error(`Unknown grid: ${gridName}`)

  const points = buildGrid(config)
  const today = new Date().toISOString().slice(0, 10)
  const isNational = gridName === 'national' || gridName === 'national_contour'

  // ── 主源：open-meteo ──
  try {
    const chunks = chunkArray(points, BATCH_SIZE)
    const allResults = []

    for (let i = 0; i < chunks.length; i++) {
      const batchResults = await fetchBatch(chunks[i], config)
      allResults.push(...batchResults)
      if (i < chunks.length - 1) await delay(BATCH_DELAY_MS)
    }

    return {
      grid: gridName,
      config: { ...config, pointCount: points.length },
      generatedAt: new Date().toISOString(),
      points: allResults,
    }
  } catch (err) {
    console.error(`[grid] open-meteo 失败 (${gridName}):`, err.message)
  }

  // ── 降级：7Timer! ──
  // 杭州用全量 195 点，全国降采样到 50 点
  const fallbackPoints = isNational ? downsamplePoints(points, 50) : points
  console.log(`[grid] 降级到 7Timer! (${gridName}: ${fallbackPoints.length}/${points.length} 点)`)

  const timerData = await fetch7TimerBatch(fallbackPoints, today)

  // 用 processPointData 统一处理（和 open-meteo 路径一致）
  const allResults = []
  for (let i = 0; i < fallbackPoints.length; i++) {
    const result = processPointData(fallbackPoints[i], timerData[i], null, config)
    if (result) allResults.push(result)
  }

  return {
    grid: gridName,
    config: { ...config, pointCount: points.length, fallbackPoints: fallbackPoints.length },
    generatedAt: new Date().toISOString(),
    points: allResults,
    source: '7timer',
  }
}
