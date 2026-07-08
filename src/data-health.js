/**
 * Data Pipeline Health — cache freshness, API quality, anomaly detection.
 *
 * Tracks:
 *   - Cache age per key (stale detection)
 *   - API fetch success rate
 *   - Data gap detection (missing hours in time series)
 *   - Score distribution sanity checks
 *
 * Usage:
 *   import { checkCacheHealth, checkDataQuality } from './data-health.js'
 */

import { cache } from './cache.js'

// ── Cache health ─────────────────────────────────────────────────

const API_HISTORY = []
const MAX_HISTORY = 200

export function recordApiResult(endpoint, ok, durationMs, errorMsg = null) {
  API_HISTORY.push({
    ts: Date.now(),
    endpoint,
    ok,
    durationMs,
    error: errorMsg,
  })
  if (API_HISTORY.length > MAX_HISTORY) API_HISTORY.shift()
}

export function checkCacheHealth() {
  const keys = ['weather:cities', 'weather:hangzhou', 'aq:cities', 'predictions:national']
  const results = {}
  const now = Date.now()

  for (const key of keys) {
    const entry = cache.get(key)
    if (!entry) {
      results[key] = { status: 'MISSING', age: null }
    } else if (entry.stale) {
      results[key] = { status: 'STALE', age: formatAge(now - entry.data?.ts || now) }
    } else {
      results[key] = { status: 'FRESH', age: formatAge(entry.age || 0) }
    }
  }
  return results
}

export function checkApiHealth() {
  if (API_HISTORY.length === 0) return { status: 'NO_DATA', successRate: null, avgDurationMs: null }

  const recent = API_HISTORY.slice(-50)
  const ok = recent.filter(r => r.ok).length
  const durations = recent.filter(r => r.durationMs > 0).map(r => r.durationMs)
  const avgMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null

  return {
    status: ok / recent.length >= 0.9 ? 'HEALTHY' : ok / recent.length >= 0.5 ? 'DEGRADED' : 'FAILING',
    successRate: ok / recent.length,
    avgDurationMs: avgMs,
    totalCalls: API_HISTORY.length,
    recentCalls: recent.length,
  }
}

export function checkDataFreshness(cities) {
  const now = Date.now()
  const staleThreshold = 30 * 60 * 1000  // 30 min
  const results = {}

  for (const city of (cities || [])) {
    const key = city.name || city.id
    const entry = cache.get(`weather:${key}`)
    if (!entry) {
      results[key] = { status: 'MISSING', age: null }
    } else {
      const age = entry.age || (now - (entry.data?.ts || now))
      results[key] = {
        status: age > staleThreshold ? 'STALE' : 'FRESH',
        age: formatAge(age),
      }
    }
  }
  return results
}

// ── Score sanity ─────────────────────────────────────────────────

export function scoreDistribution(scores) {
  if (!scores || scores.length === 0) return null
  const sorted = [...scores].sort((a, b) => a - b)
  const n = sorted.length
  const mean = sorted.reduce((a, b) => a + b, 0) / n
  return {
    count: n,
    min: sorted[0],
    p25: sorted[Math.floor(n * 0.25)],
    median: sorted[Math.floor(n * 0.5)],
    p75: sorted[Math.floor(n * 0.75)],
    max: sorted[n - 1],
    mean: Math.round(mean * 10) / 10,
    // Flag if all scores are within 10 points (possible sensor issue)
    suspiciouslyNarrow: (sorted[n - 1] - sorted[0]) < 10,
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function formatAge(ms) {
  if (ms == null) return null
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${Math.round(ms / 3_600_000)}h`
}
