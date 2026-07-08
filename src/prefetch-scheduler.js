/**
 * 预取调度器 — 定时从 open-meteo 拉取数据写入内存缓存
 *
 * 设计原则：
 *   - 前端永远只读缓存，不穿透到 open-meteo
 *   - 时段分层频率：黄金时段高频，夜间最低频
 *   - 错峰启动 + jitter 防对齐 → 永远不会触发 429
 *   - 每日 ~460 次 API 调用 / 10,000 限额 = 4.6% 使用率
 */

import { fetchAllCityData } from './weather-fetcher.js'
import { computeAllPredictions } from './prediction-engine.js'
import { cities } from './cities.js'
import { cache } from './cache.js'
import { fetchGridPredictions, GRID_CONFIGS, CITY_GRIDS, buildGrid, chunkArray, fetchBatch } from './grid-fetcher.js'
import { buildContourGeoJSON } from './contour-builder.js'
import { storeDailyPredictions, storeGridSummary } from './storage.js'

// ── 频率配置（北京时间） ──────────────────────────────────────────
// 根据当前北京时间返回各数据类型的刷新间隔（毫秒）

function getIntervalsCST() {
  const now = new Date()
  // 用 UTC 推算北京时间（UTC+8）
  const cstHour = (now.getUTCHours() + 8) % 24

  if (cstHour >= 12 && cstHour < 20) {
    // 黄金时段 — 晚霞决策窗口
    return {
      cities: 15 * 60 * 1000,       // 15 分钟
      hangzhou: 15 * 60 * 1000,     // 15 分钟
      national: 60 * 60 * 1000,     // 1 小时
    }
  } else if (cstHour >= 6 && cstHour < 12) {
    // 上午 — 用户尚未开始关注
    return {
      cities: 60 * 60 * 1000,       // 1 小时
      hangzhou: 60 * 60 * 1000,     // 1 小时
      national: 3 * 60 * 60 * 1000, // 3 小时
    }
  } else {
    // 夜间 — 日落后极少访问
    return {
      cities: 2 * 60 * 60 * 1000,    // 2 小时
      hangzhou: 2 * 60 * 60 * 1000,  // 2 小时
      national: 6 * 60 * 60 * 1000,  // 6 小时（仅跟模型更新）
    }
  }
}

// ── 错峰偏移（毫秒）— 避免三种数据同时请求 ──────────────────────
const STAGGER_OFFSETS = {
  cities: 0,
  hangzhou: 90_000,   // +1.5 分钟
  national: 300_000,  // +5 分钟（给足限流窗口重置时间）
}

// ── Jitter — 随机 +0~30 秒，防止 cron 精确定时导致长期对齐 ─────────
// 只用正向 jitter（延迟），避免与 setTimeout 的 Math.max 下限叠加后变成负数
function jitter() {
  return Math.random() * 30_000 // 0~30s 随机延迟
}

// ── 延迟工具 ──────────────────────────────────────────────────────
function delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ── 单个数据类型的预取循环 ────────────────────────────────────────

/**
 * 启动一个预取循环
 * @param {string} name - 数据类型标识
 * @param {() => Promise<any>} fetchFn - 获取函数，返回要缓存的数据
 * @param {string} cacheKeyPrefix - 缓存键前缀
 * @param {number|null} ttlMs - 缓存 TTL（null = 使用默认值）
 */
async function prefetchLoop(name, fetchFn, cacheKeyPrefix, ttlMs = null) {
  let lastFetch = Date.now()  // 首轮 30s 后才触发，给 open-meteo 限流窗口冷却
  let firstFetch = true

  async function tick() {
    // 计算本 tick 的目标间隔（首轮 60s，后续按时段）
    const intervals = getIntervalsCST()
    const interval = intervals[name]
    const effectiveInterval = firstFetch ? 60_000 : interval

    try {
      const now = Date.now()

      // 检查是否到了刷新时间
      if (now - lastFetch >= effectiveInterval) {
        const today = new Date().toISOString().slice(0, 10)
        const cacheKey = `${cacheKeyPrefix}-${today}`

        console.log(`[prefetch] ${name} 开始刷新…`)
        const data = await fetchFn()
        cache.set(cacheKey, data, ttlMs)
        lastFetch = Date.now()
        firstFetch = false
        console.log(`[prefetch] ${name} 刷新完成 (${JSON.stringify(data).length} 字节)`)
      }
    } catch (err) {
      console.error(`[prefetch] ${name} 刷新失败:`, err.message)
      // 失败后标记首轮完成 + 重置计时器，2 分钟后重试（不等完整间隔）
      if (firstFetch) { firstFetch = false }
      lastFetch = Date.now() - effectiveInterval + 120_000  // 2 分钟后重试
      // 不抛异常 — 保留旧缓存（即使 stale），让前端有降级数据可用
    }

    // 计算下次检查时间（首轮用 effectiveInterval=30s，后续用时段间隔）
    const elapsed = Date.now() - lastFetch
    const nextCheck = Math.max(15_000, effectiveInterval - elapsed) // 最少 15 秒检查一次

    setTimeout(tick, nextCheck + jitter())
  }

  return tick
}

// ── 各数据类型的获取函数 ──────────────────────────────────────────

async function fetchCities() {
  const rawData = await fetchAllCityData()
  const predictions = computeAllPredictions(rawData, cities)
  const today = new Date().toISOString().slice(0, 10)

  // 生成与 routes.js 兼容的 summary 结构
  const tiers = { Great: 0, Good: 0, Fair: 0, Poor: 0 }
  let bestCity = null, bestScore = -1
  for (const p of predictions) {
    tiers[p.tier]++
    if (p.score > bestScore) { bestScore = p.score; bestCity = p }
  }
  const avgScore = Math.round(predictions.reduce((s, p) => s + p.score, 0) / predictions.length)

  // 检测数据源（rawData 数组级标记）
  const dataSource = rawData._source === '7timer' ? '7timer' : 'open-meteo'
  if (dataSource === '7timer') console.log('[prefetch] 数据源: 7timer (降级)')

  const result = {
    generatedAt: new Date().toISOString(),
    date: today,
    cityCount: predictions.length,
    dataSource,
    summary: {
      averageScore: avgScore,
      tierDistribution: tiers,
      bestCity: bestCity ? { name: bestCity.name, nameEn: bestCity.nameEn, score: bestCity.score, tierCn: bestCity.tierCn } : null,
      recommendation: avgScore >= 60
        ? '今日全国晚霞条件较好，建议关注西部和高原地区'
        : avgScore >= 40
          ? '今日部分地区有机会看到不错的晚霞'
          : '今日全国晚霞条件一般',
    },
    cities: predictions,
  }

  // 持久化到 SQLite（异步，不阻塞缓存写入）
  try { storeDailyPredictions(today, predictions) } catch (e) {
    console.error('[prefetch] 城市数据持久化失败:', e.message)
  }

  return result
}

async function fetchNationalGrid() {
  const gridData = await fetchGridPredictions('national_contour')

  // 尝试用城市数据增强网格（如果缓存中有的话）
  const today = new Date().toISOString().slice(0, 10)
  const citiesCache = cache.get(`predictions-${today}`)
  if (citiesCache?.data?.cities) {
    augmentGridWithCities(gridData.points, citiesCache.data.cities)
  }

  // 生成等值面
  const contours = buildContourGeoJSON(gridData.points, gridData.config)

  const total = gridData.points.length
  const tiers = { Great: 0, Good: 0, Fair: 0, Poor: 0 }
  for (const p of gridData.points) tiers[p.tier]++
  const avgScore = total > 0 ? Math.round(gridData.points.reduce((s, p) => s + p.score, 0) / total) : 0

  const result = {
    generatedAt: gridData.generatedAt,
    pointCount: total,
    contours,
    points: gridData.points,
    summary: {
      avgScore,
      greatPct: Math.round(tiers.Great / total * 100),
      goodPct: Math.round(tiers.Good / total * 100),
      fairPct: Math.round(tiers.Fair / total * 100),
      poorPct: Math.round(tiers.Poor / total * 100),
    },
  }

  // 持久化
  try { storeGridSummary(today, 'national_contour', gridData.points) } catch (e) {
    console.error('[prefetch] 网格数据持久化失败:', e.message)
  }

  // 同时写入等值面专用缓存键
  const CONTOUR_TTL = 60 * 60 * 1000
  cache.set(`contour-${today}`, result, CONTOUR_TTL)

  return gridData
}

// ── 城市增强（从 routes.js 复用） ─────────────────────────────────

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

// ── 启动入口 ──────────────────────────────────────────────────────

/**
 * 启动所有预取循环。
 * 错峰启动：cities T+0, hangzhou T+60s, national T+120s
 * 每个循环首次启动后立即执行一次首轮预热。
 */
export function startPrefetchScheduler() {
  const gridNames = CITY_GRIDS.join(', ')
  console.log('[prefetch] 预取调度器启动…')
  console.log('[prefetch]   城市预报: 15min(黄金)/1h(上午)/2h(夜间)')
  console.log(`[prefetch]   城市网格 (${gridNames}): 15min(黄金)/1h(上午)/2h(夜间)`)
  console.log('[prefetch]   全国网格:  1h(黄金)/3h(上午)/6h(夜间)')

  // 错峰：cities T+0, 每个城市网格递增 60s, national 最后
  const loops = [
    { name: 'cities', fn: fetchCities, cachePrefix: 'predictions', ttl: 30 * 60 * 1000, offset: 0 },
  ]
  CITY_GRIDS.forEach((gridName, i) => {
    loops.push({
      name: gridName,
      fn: () => fetchGridPredictions(gridName),
      cachePrefix: `grid-${gridName}`,
      ttl: 30 * 60 * 1000,
      offset: (i + 1) * 60_000,  // 每个城市网格错开 1 分钟
    })
  })
  loops.push({
    name: 'national',
    fn: fetchNationalGrid,
    cachePrefix: 'grid-national_contour',
    ttl: 90 * 60 * 1000,
    offset: (CITY_GRIDS.length + 1) * 60_000,  // 全国在所有城市之后
  })

  for (const { name, fn, cachePrefix, ttl, offset } of loops) {
    setTimeout(async () => {
      const tick = await prefetchLoop(name, fn, cachePrefix, ttl)
      // 首轮 60 秒后开始，给 open-meteo 限流窗口充分冷却
      setTimeout(tick, 60_000 + jitter())
    }, offset + jitter())
  }
}
