function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function gaussian(x, peak, sigma) {
  return 100 * Math.exp(-((x - peak) ** 2) / (2 * sigma ** 2))
}

function humidityScore(rh500, rh300, rh2m) {
  if (rh500 == null && rh300 == null) return 50

  const upper500 = rh500 != null ? gaussian(rh500, 50, 25) : 50
  const upper300 = rh300 != null ? gaussian(rh300, 45, 22) : 50
  const surfaceComponent = rh2m != null ? (100 - rh2m) / 100 * 100 : 50
  const surfacePenalty = rh2m != null ? (rh2m > 90 ? 0.8 : rh2m > 80 ? 0.9 : 1.0) : 1.0

  return clamp((upper500 * 0.45 + upper300 * 0.40 + surfaceComponent * 0.15) * surfacePenalty, 0, 100)
}

function highCloudScore(cloudHigh, cloudMid, cloudLow, cloudTotal) {
  if (cloudHigh == null) return 50

  let score
  if (cloudHigh >= 20 && cloudHigh <= 80) score = 90
  else if (cloudHigh > 80) score = 75
  else if (cloudHigh >= 10) score = 60
  else score = 35

  if (cloudMid != null && cloudMid >= 10 && cloudMid <= 50) score += 8

  if (cloudLow != null && cloudLow > 85) score *= 0.15
  else if (cloudLow != null && cloudLow > 70) score *= 0.35
  else if (cloudLow != null && cloudLow > 55) score *= 0.6

  return clamp(score, 0, 100)
}

function pressureTendencyScore(pressures) {
  if (!pressures || pressures.length < 2) return 50

  const valid = pressures.filter(p => p != null)
  if (valid.length < 2) return 50

  const tendency = (valid[valid.length - 1] - valid[0]) / (valid.length - 1)

  if (tendency < -1.5) return 90
  if (tendency < -0.8) return 80
  if (tendency < -0.3) return 70
  if (tendency < 0.3) return 50
  if (tendency < 0.8) return 60
  if (tendency < 1.5) return 55
  return 30
}

function aerosolScore(aod, region) {
  if (aod == null) return 50

  let score
  if (aod < 0.05) score = 30
  else if (aod < 0.1) score = 55
  else if (aod < 0.15) score = 80
  else if (aod < 0.25) score = 95
  else if (aod < 0.4) score = 80
  else if (aod < 0.6) score = 50
  else if (aod < 0.8) score = 30
  else score = Math.max(5, 30 - (aod - 0.8) * 50)

  if (['north', 'east'].includes(region) && aod >= 0.3 && aod < 0.6) {
    score += 10
  }
  if (region === 'plateau' && aod < 0.1) {
    score = 55
  }

  return clamp(score, 0, 100)
}

function verticalVelocityScore(omega) {
  if (omega == null) return 50
  if (omega < -0.5) return 35
  if (omega < -0.2) return 85
  if (omega < -0.05) return 70
  if (omega < 0.1) return 50
  return 40
}

function visibilityScore(vis) {
  if (vis == null) return 50
  if (vis > 30000) return 70
  if (vis > 20000) return 80
  if (vis > 10000) return 65
  if (vis > 5000) return 45
  if (vis > 1000) return 25
  return 10
}

let weights = {
  highCloud: 0.30,
  humidity: 0.25,
  pressure: 0.15,
  aerosol: 0.15,
  verticalVelocity: 0.10,
  visibility: 0.05,
}

export function getWeights() {
  return { ...weights }
}

export function setWeights(newWeights) {
  const keys = ['highCloud', 'humidity', 'pressure', 'aerosol', 'verticalVelocity', 'visibility']
  for (const k of keys) {
    if (typeof newWeights[k] !== 'number') throw new Error(`Missing weight: ${k}`)
  }
  const sum = keys.reduce((s, k) => s + newWeights[k], 0)
  if (Math.abs(sum - 1.0) > 0.01) throw new Error(`Weights must sum to 1.0, got ${sum}`)
  weights = { ...newWeights }
}

function getTier(score) {
  if (score >= 75) return 'Great'
  if (score >= 50) return 'Good'
  if (score >= 18) return 'Fair'
  return 'Poor'
}

function getTierCn(score) {
  if (score >= 75) return '极佳'
  if (score >= 50) return '好'
  if (score >= 18) return '一般'
  return '差'
}

function getTierEmoji(score) {
  if (score >= 75) return '🌅'
  if (score >= 50) return '🌇'
  if (score >= 18) return '⛅'
  return '☁️'
}

const COLORS = [
  { hex: '#DC143C', name: '绯红', nameEn: 'Crimson', condition: (s, d) => d.aod >= 0.15 && d.cloudCoverHigh >= 30 && s.humidity > 60 },
  { hex: '#FF4500', name: '火焰橙红', nameEn: 'Orange Red', condition: (s, d) => d.cloudCoverHigh >= 40 && d.aod >= 0.1 },
  { hex: '#FF8C00', name: '金橙', nameEn: 'Golden Orange', condition: (s, d) => d.aod >= 0.1 && d.aod < 0.3 && s.humidity > 50 },
  { hex: '#FA8072', name: '浅鲑红', nameEn: 'Salmon Pink', condition: (s, d) => d.cloudCoverHigh >= 20 && (d.aod == null || d.aod < 0.15) },
  { hex: '#FFD700', name: '金黄', nameEn: 'Gold', condition: (s, d) => (d.aod == null || d.aod < 0.1) && d.cloudCoverHigh < 20 },
  { hex: '#DDA0DD', name: '淡紫', nameEn: 'Plum', condition: (s, d) => d.rh500 != null && d.rh500 > 60 },
  { hex: '#808080', name: '灰白', nameEn: 'Grey', condition: () => true },
]

function estimateDominantColor(subScores, data) {
  for (const c of COLORS) {
    if (c.condition(subScores, data)) return { hex: c.hex, name: c.name, nameEn: c.nameEn }
  }
  return COLORS[COLORS.length - 1]
}

export function computeSunsetScore(data, city) {
  const subScores = {
    humidity: Math.round(humidityScore(data.rh500, data.rh300, data.rh2m)),
    highCloud: Math.round(highCloudScore(data.cloudCoverHigh, data.cloudCoverMid, data.cloudCoverLow, data.cloudCover)),
    pressure: Math.round(pressureTendencyScore(data.pressureArray)),
    aerosol: Math.round(aerosolScore(data.aod, city.region)),
    verticalVelocity: Math.round(verticalVelocityScore(data.omega500)),
    visibility: Math.round(visibilityScore(data.visibility)),
  }

  let composite = 0
  for (const [key, weight] of Object.entries(weights)) {
    composite += subScores[key] * weight
  }

  const ch = data.cloudCoverHigh ?? 0
  const cl = data.cloudCoverLow ?? 0
  const aod = data.aod ?? 0
  const vis = data.visibility ?? 20000
  if (ch >= 30 && aod >= 0.1 && aod < 0.5 && cl < 55) composite += 8
  if (ch >= 50 && aod >= 0.15 && aod < 0.4 && cl < 40) composite += 5
  if (vis < 10000) composite *= 0.6

  // Southwest basin cities (成都/重庆): atmospheric scatter in hazy basins enhances colour
  if (city.region === 'southwest' && cl >= 30 && cl <= 70 && aod >= 0.1 && ch >= 20) composite += 10

  // North/northeast heavy pollution blocks the horizon — confirmed over-estimated by ~20 pts
  if (['north', 'northeast'].includes(city.region) && aod > 0.5) composite *= 0.75

  const score = Math.round(clamp(composite, 0, 100))

  return {
    score,
    tier: getTier(score),
    tierCn: getTierCn(score),
    tierEmoji: getTierEmoji(score),
    subScores,
    dominantColor: estimateDominantColor(subScores, data),
    sunsetTime: data.sunsetTime,
  }
}

export function computeAllPredictions(weatherDataArray, cities) {
  return weatherDataArray.map((data, i) => {
    if (!data) return null
    const city = cities[i]
    const prediction = computeSunsetScore(data, city)
    return {
      ...city,
      ...prediction,
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
        pressureTendency: data.pressureArray && data.pressureArray.length >= 2
          ? Math.round((data.pressureArray[data.pressureArray.length - 1] - data.pressureArray[0]) / (data.pressureArray.length - 1) * 100) / 100
          : null,
      },
    }
  }).filter(Boolean)
}

export {
  humidityScore, highCloudScore, pressureTendencyScore,
  aerosolScore, verticalVelocityScore, visibilityScore,
}

export default { computeSunsetScore, computeAllPredictions, getWeights, setWeights }
