import { computeSunsetScore } from './prediction-engine.js'

const BATCH_SIZE = 200
const BATCH_DELAY_MS = 1000

export const GRID_CONFIGS = {
  hangzhou: {
    name: '杭州及周边',
    latMin: 28.5, latMax: 31.5, lonMin: 118.5, lonMax: 122.0,
    step: 0.25,
    region: 'east', elevation: 20,
  },
  national: {
    name: '全国',
    latMin: 18, latMax: 54, lonMin: 73, lonMax: 135,
    step: 1.0,
    region: 'mixed', elevation: 100,
  },
  national_contour: {
    name: '全国等值面',
    latMin: 18, latMax: 54, lonMin: 73, lonMax: 135,
    step: 1.0,
    region: 'mixed', elevation: 100,
  },
}

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

async function fetchJSON(url, retries = 5) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url)
    if (res.status === 429) {
      const wait = 3000 * (i + 1)
      console.log(`[grid] Rate limited, waiting ${wait}ms (retry ${i + 1}/${retries})`)
      await delay(wait)
      continue
    }
    if (!res.ok) throw new Error(`API ${res.status}`)
    return res.json()
  }
  throw new Error('API 429 after retries')
}

function buildWeatherURL(lats, lons) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,pressure_msl,visibility,relative_humidity_500hPa,relative_humidity_300hPa,vertical_velocity_500hPa&daily=sunset&timezone=Asia/Shanghai&forecast_days=1`
}

function buildAQURL(lats, lons) {
  return `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}&hourly=aerosol_optical_depth&timezone=Asia/Shanghai&forecast_days=1`
}

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

export async function fetchBatch(batchPoints, config) {
  const lats = batchPoints.map(p => p.lat).join(',')
  const lons = batchPoints.map(p => p.lon).join(',')

  const weatherData = await fetchJSON(buildWeatherURL(lats, lons))
  await delay(300)
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

export async function fetchGridPredictions(gridName = 'hangzhou') {
  const config = GRID_CONFIGS[gridName]
  if (!config) throw new Error(`Unknown grid: ${gridName}`)

  const points = buildGrid(config)
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
}
