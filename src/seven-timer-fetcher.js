/**
 * 7Timer! 数据获取 & 格式转换
 *
 * 7Timer! (7timer.info) — 中科院上海天文台免费天文天气 API
 * 数据源: NOAA GFS 0.25  全球模型
 * 变量: cloudcover(oktas 1-9), seeing, transparency(1-7), lifted_index,
 *       rh2m(%), temp2m, wind10m, prec_type
 *
 * 格式转换: 7Timer! 响应 -> open-meteo 兼容格式
 * 降级场景: 缺失变量用代理/默认值填充, 预测偏保守
 * 线性插值: 3 小时间隔 -> 24 小时连续数组
 */

// ── 基础配置 ──────────────────────────────────────────────────
const TIMER_URL = 'http://www.7timer.info/bin/astro.php'
const REQUEST_DELAY_MS = 300  // 请求间延迟（别给 7Timer! 压力）

function delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ── 日落时间计算（三角法，+/-2 min 精度） ──────────────────────

function calcSunset(lat, lon, date) {
  const d = new Date(date)
  const doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000)
  const zenith = 90.833  // 大气折射修正
  const rad = Math.PI / 180

  // 太阳赤纬
  const dec = 23.45 * Math.sin(rad * (360 / 365) * (284 + doy))

  // 时角
  const latR = lat * rad
  const decR = dec * rad
  const cosH = (Math.cos(zenith * rad) - Math.sin(latR) * Math.sin(decR)) /
               (Math.cos(latR) * Math.cos(decR))
  if (cosH < -1 || cosH > 1) return lat > 60 ? '00:00' : '23:59'

  const H = Math.acos(cosH) / rad
  const utcHour = 12 + H / 15 - lon / 15
  const h = Math.floor(utcHour)
  const m = Math.round((utcHour - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ── 7Timer! API 调用 ─────────────────────────────────────────

async function fetch7TimerPoint(lat, lon) {
  const url = `${TIMER_URL}?lon=${lon}&lat=${lat}&ac=0&unit=metric&output=json&tzshift=0`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`7Timer! API ${res.status}`)
  return res.json()
}

// ── 7Timer! -> open-meteo 格式转换 ────────────────────────────

/**
 * 线性插值: 7Timer! 3 小时间隔 -> 24 小时连续数组
 * 每对相邻已知点之间线性填充
 */
function interpolate(series, getVal) {
  const known = series.map(s => ({ h: s.timepoint % 24, v: getVal(s) }))
  known.sort((a, b) => a.h - b.h)
  if (!known.length) return new Array(24).fill(null)

  const arr = new Array(24).fill(null)
  for (let i = 0; i < known.length; i++) {
    const curr = known[i]
    const next = known[(i + 1) % known.length]
    arr[curr.h] = Math.round(curr.v)

    // 中间小时线性插值
    let h1 = curr.h, v1 = curr.v
    let h2 = next.h, v2 = next.v
    if (h2 <= h1) h2 += 24  // 跨天回绕
    for (let h = h1 + 1; h < h2; h++) {
      const frac = (h - h1) / (h2 - h1)
      arr[h % 24] = Math.round(v1 + (v2 - v1) * frac)
    }
  }
  return arr
}

// AOD 需要保留小数，不取整
function interpolateFloat(series, getVal) {
  const known = series.map(s => ({ h: s.timepoint % 24, v: getVal(s) }))
  known.sort((a, b) => a.h - b.h)
  if (!known.length) return new Array(24).fill(null)

  const arr = new Array(24).fill(null)
  for (let i = 0; i < known.length; i++) {
    const curr = known[i]
    const next = known[(i + 1) % known.length]
    arr[curr.h] = Math.round(curr.v * 100) / 100

    let h1 = curr.h, v1 = curr.v
    let h2 = next.h, v2 = next.v
    if (h2 <= h1) h2 += 24
    for (let h = h1 + 1; h < h2; h++) {
      const frac = (h - h1) / (h2 - h1)
      arr[h % 24] = Math.round((v1 + (v2 - v1) * frac) * 100) / 100
    }
  }
  return arr
}

function convertToOpenMeteo(timerData, lat, lon, dateStr) {
  const series = timerData.dataseries || []
  if (!series.length) return null

  const sunsetTime = calcSunset(lat, lon, dateStr)

  // 7Timer! cloudcover 是 oktas (1-9), 转为百分比
  const oktaToPct = (okta) => Math.round((okta / 9) * 100)

  // transparency (1-7, 7=best) -> AOD 代理 (0-1, 0=clean)
  const transpToAod = (transp) => Math.max(0.01, (7 - transp) / 10)

  // seeing -> 可见性代理 (米)
  const seeingToVis = (s) => Math.round(Math.max(5000, 25000 / Math.max(s, 1)))

  const cloudArr = interpolate(series, s => oktaToPct(s.cloudcover))
  const rh2mArr = interpolate(series, s => s.rh2m)
  const aodArr = interpolateFloat(series, s => transpToAod(s.transparency))
  const visArr = interpolate(series, s => seeingToVis(s.seeing))

  return {
    daily: {
      sunset: [`${dateStr}T${sunsetTime}`],
      sunrise: [`${dateStr}T06:00`],
    },
    hourly: {
      time: Array.from({ length: 24 }, (_, i) => `${dateStr}T${String(i).padStart(2, '0')}:00`),
      cloud_cover: cloudArr,
      cloud_cover_high: new Array(24).fill(null),
      cloud_cover_mid: new Array(24).fill(null),
      cloud_cover_low: new Array(24).fill(null),
      relative_humidity_2m: rh2mArr,
      relative_humidity_500hPa: new Array(24).fill(null),
      relative_humidity_300hPa: new Array(24).fill(null),
      pressure_msl: new Array(24).fill(null),
      visibility: visArr,
      aerosol_optical_depth: aodArr,
      vertical_velocity_500hPa: new Array(24).fill(null),
    },
    _source: '7timer',
  }
}

// ── 批量获取 ──────────────────────────────────────────────────

export async function fetch7TimerBatch(points, dateStr) {
  console.log(`[7timer] 获取 ${points.length} 个点...`)
  const results = []

  for (let i = 0; i < points.length; i++) {
    try {
      const data = await fetch7TimerPoint(points[i].lat, points[i].lon)
      const converted = convertToOpenMeteo(data, points[i].lat, points[i].lon, dateStr)
      results.push(converted)
    } catch (err) {
      console.error(`[7timer] 点 ${points[i].lat},${points[i].lon} 失败: ${err.message}`)
      results.push(null)
    }
    if (i < points.length - 1) await delay(REQUEST_DELAY_MS)
  }

  const ok = results.filter(Boolean).length
  console.log(`[7timer] 完成: ${ok}/${points.length}`)
  return results
}

export default { fetch7TimerBatch }
