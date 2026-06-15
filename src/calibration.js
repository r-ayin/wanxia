import { cities, getLatitudes, getLongitudes } from './cities.js'
import { computeSunsetScore, getWeights, setWeights } from './prediction-engine.js'
import {
  storeActualWeather, getCalibrationPairs, saveWeightRecord, getLatestWeights,
} from './storage.js'

const WEIGHT_BOUNDS = {
  highCloud: [0.15, 0.45],
  humidity: [0.10, 0.35],
  pressure: [0.05, 0.25],
  aerosol: [0.05, 0.25],
  verticalVelocity: [0.03, 0.20],
  visibility: [0.02, 0.15],
}

const MIN_CALIBRATION_DAYS = 7
const EMA_ALPHA = 0.15

async function fetchJSON(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}

export async function fetchActualWeather(date) {
  const lats = getLatitudes()
  const lons = getLongitudes()

  const weatherURL = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,pressure_msl,visibility,relative_humidity_500hPa,relative_humidity_300hPa,vertical_velocity_500hPa&daily=sunset&timezone=Asia/Shanghai&start_date=${date}&end_date=${date}`
  const aqURL = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}&hourly=aerosol_optical_depth&timezone=Asia/Shanghai&start_date=${date}&end_date=${date}`

  const [weatherData, aqData] = await Promise.all([
    fetchJSON(weatherURL),
    fetchJSON(aqURL).catch(() => null),
  ])

  const weatherArr = Array.isArray(weatherData) ? weatherData : [weatherData]
  const aqArr = aqData ? (Array.isArray(aqData) ? aqData : [aqData]) : []

  let stored = 0
  for (let i = 0; i < cities.length; i++) {
    const w = weatherArr[i]
    const aq = aqArr[i] || null
    if (!w) continue

    try {
      const sunsetStr = w.daily.sunset[0]
      const sunsetH = parseInt(sunsetStr.split('T')[1].split(':')[0], 10)
      const h = w.hourly
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
        aod: aq ? at(aq.hourly.aerosol_optical_depth) : null,
      }

      const prediction = computeSunsetScore(data, cities[i])
      const pressureTendency = data.pressureArray?.length >= 2
        ? (data.pressureArray[data.pressureArray.length - 1] - data.pressureArray[0]) / (data.pressureArray.length - 1)
        : null

      storeActualWeather(date, cities[i].id, {
        score: prediction.score,
        subScores: prediction.subScores,
        rawData: {
          cloudCoverHigh: data.cloudCoverHigh,
          cloudCoverMid: data.cloudCoverMid,
          cloudCoverLow: data.cloudCoverLow,
          cloudCover: data.cloudCover,
          rh2m: data.rh2m,
          rh500: data.rh500,
          rh300: data.rh300,
          aod: data.aod,
          omega500: data.omega500,
          visibility: data.visibility,
          pressureTendency,
        },
      })
      stored++
    } catch {
      // skip failed cities
    }
  }

  console.log(`[calibration] Stored actual weather for ${date}: ${stored}/${cities.length} cities`)
  return stored
}

export function calibrateWeights(lookbackDays = 14) {
  const pairs = getCalibrationPairs(lookbackDays)

  if (pairs.length < MIN_CALIBRATION_DAYS * 10) {
    console.log(`[calibration] Not enough data: ${pairs.length} pairs (need ${MIN_CALIBRATION_DAYS * 10})`)
    return null
  }

  const dims = ['humidity', 'high_cloud', 'pressure', 'aerosol', 'vertical_velocity', 'visibility']
  const dimKeys = ['humidity', 'highCloud', 'pressure', 'aerosol', 'verticalVelocity', 'visibility']
  const dimErrors = {}

  for (const dim of dims) {
    let sum = 0, count = 0
    for (const pair of pairs) {
      const pred = pair[`pred_${dim}`]
      const actual = pair[`actual_${dim}`]
      if (pred != null && actual != null) {
        sum += Math.abs(pred - actual)
        count++
      }
    }
    dimErrors[dim] = count > 0 ? sum / count : 50
  }

  const rawWeights = {}
  for (let i = 0; i < dims.length; i++) {
    rawWeights[dimKeys[i]] = 1 / (1 + dimErrors[dims[i]])
  }

  const rawSum = Object.values(rawWeights).reduce((s, v) => s + v, 0)
  const normalized = {}
  for (const k of dimKeys) {
    normalized[k] = rawWeights[k] / rawSum
  }

  const current = getWeights()
  const blended = {}
  for (const k of dimKeys) {
    blended[k] = (1 - EMA_ALPHA) * current[k] + EMA_ALPHA * normalized[k]
  }

  for (const k of dimKeys) {
    const [lo, hi] = WEIGHT_BOUNDS[k]
    blended[k] = Math.max(lo, Math.min(hi, blended[k]))
  }

  const blendedSum = Object.values(blended).reduce((s, v) => s + v, 0)
  for (const k of dimKeys) {
    blended[k] = Math.round(blended[k] / blendedSum * 10000) / 10000
  }

  const totalMAE = Math.round(
    pairs.reduce((s, p) => s + Math.abs(p.pred_score - p.actual_score), 0) / pairs.length * 100
  ) / 100

  const today = new Date().toISOString().slice(0, 10)
  saveWeightRecord(today, blended, totalMAE, dimErrors, pairs.length, 'auto-calibration')
  setWeights(blended)

  console.log(`[calibration] Updated weights (${pairs.length} pairs, MAE=${totalMAE}):`, blended)
  return { weights: blended, mae: totalMAE, sampleCount: pairs.length }
}

export async function runDailyCalibration() {
  try {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    console.log(`[calibration] Starting daily calibration for ${yesterday}`)

    await fetchActualWeather(yesterday)
    const result = calibrateWeights()

    if (result) {
      console.log(`[calibration] Calibration complete. New MAE: ${result.mae}`)
    }
    return result
  } catch (err) {
    console.error('[calibration] Daily calibration failed:', err.message)
    return null
  }
}

export function restoreWeights() {
  const saved = getLatestWeights()
  if (saved) {
    try {
      setWeights({
        highCloud: saved.w_high_cloud,
        humidity: saved.w_humidity,
        pressure: saved.w_pressure,
        aerosol: saved.w_aerosol,
        verticalVelocity: saved.w_vertical_velocity,
        visibility: saved.w_visibility,
      })
      console.log('[calibration] Restored weights from database')
      return true
    } catch (err) {
      console.error('[calibration] Failed to restore weights:', err.message)
    }
  }
  return false
}
