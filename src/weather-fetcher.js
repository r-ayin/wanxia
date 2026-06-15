import { getLatitudes, getLongitudes, cities } from './cities.js'

const WEATHER_BASE = 'https://api.open-meteo.com/v1/forecast'
const AQ_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality'

async function fetchJSON(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`)
  return res.json()
}

function buildWeatherURL() {
  const params = new URLSearchParams({
    latitude: getLatitudes(),
    longitude: getLongitudes(),
    hourly: [
      'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
      'relative_humidity_2m', 'pressure_msl', 'visibility',
      'relative_humidity_500hPa', 'relative_humidity_300hPa',
      'vertical_velocity_500hPa'
    ].join(','),
    daily: 'sunset,sunrise',
    timezone: 'Asia/Shanghai',
    forecast_days: '2'
  })
  return `${WEATHER_BASE}?${params}`
}

function buildAQURL() {
  const params = new URLSearchParams({
    latitude: getLatitudes(),
    longitude: getLongitudes(),
    hourly: 'aerosol_optical_depth',
    timezone: 'Asia/Shanghai',
    forecast_days: '2'
  })
  return `${AQ_BASE}?${params}`
}

function extractSunsetWindowData(weatherCity, aqCity) {
  const sunsetTimeStr = weatherCity.daily.sunset[0]
  const sunsetHour = parseInt(sunsetTimeStr.split('T')[1].split(':')[0], 10)
  const hourly = weatherCity.hourly
  const times = hourly.time

  const windowStart = Math.max(0, sunsetHour - 2)
  const windowEnd = Math.min(times.length - 1, sunsetHour + 1)

  const atSunset = (arr) => arr ? arr[sunsetHour] : null
  const windowSlice = (arr) => arr ? arr.slice(windowStart, windowEnd + 1) : []
  const pressureSlice = (arr) => {
    const start = Math.max(0, sunsetHour - 5)
    return arr ? arr.slice(start, sunsetHour + 1) : []
  }

  return {
    sunsetTime: sunsetTimeStr,
    sunsetHour,
    cloudCoverHigh: atSunset(hourly.cloud_cover_high),
    cloudCoverMid: atSunset(hourly.cloud_cover_mid),
    cloudCoverLow: atSunset(hourly.cloud_cover_low),
    cloudCover: atSunset(hourly.cloud_cover),
    rh2m: atSunset(hourly.relative_humidity_2m),
    rh500: atSunset(hourly.relative_humidity_500hPa),
    rh300: atSunset(hourly.relative_humidity_300hPa),
    omega500: atSunset(hourly.vertical_velocity_500hPa),
    visibility: atSunset(hourly.visibility),
    pressureArray: pressureSlice(hourly.pressure_msl),
    aod: aqCity ? atSunset(aqCity.hourly.aerosol_optical_depth) : null,
    cloudHighWindow: windowSlice(hourly.cloud_cover_high),
    rhWindow: windowSlice(hourly.relative_humidity_2m),
  }
}

export async function fetchAllCityData() {
  const weatherURL = buildWeatherURL()
  const aqURL = buildAQURL()

  const [weatherData, aqData] = await Promise.all([
    fetchJSON(weatherURL),
    fetchJSON(aqURL).catch(() => null)
  ])

  const weatherArray = Array.isArray(weatherData) ? weatherData : [weatherData]
  const aqArray = aqData ? (Array.isArray(aqData) ? aqData : [aqData]) : []

  return cities.map((city, i) => {
    const w = weatherArray[i]
    const aq = aqArray[i] || null
    if (!w) return null
    try {
      return { cityIndex: i, ...extractSunsetWindowData(w, aq) }
    } catch {
      return null
    }
  })
}

export default { fetchAllCityData }
