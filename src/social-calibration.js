/**
 * Social-validation-based weight calibration.
 *
 * Uses Weibo engagement (social_score) as a proxy for actual sunset beauty.
 * Runs non-negative least squares (projected gradient descent) to find the
 * weight vector that best predicts social engagement from weather sub-scores.
 *
 * Because social scores carry population-size bias (Shanghai posts more than
 * Dunhuang), we z-score normalize within each city before regression.
 *
 * Calibration is blended with current weights via EMA (alpha=0.2) so a single
 * noisy session can't destabilize predictions.
 */

import { getSocialCalibrationPairs, saveWeightRecord, getSocialStatus } from './storage.js'
import { getWeights, setWeights } from './prediction-engine.js'

const DIMS = ['humidity', 'highCloud', 'pressure', 'aerosol', 'verticalVelocity', 'visibility']
const DB_COLS = ['sub_humidity', 'sub_high_cloud', 'sub_pressure', 'sub_aerosol', 'sub_vertical_velocity', 'sub_visibility']

const WEIGHT_BOUNDS = {
  highCloud: [0.15, 0.45],
  humidity: [0.10, 0.35],
  pressure: [0.05, 0.25],
  aerosol: [0.05, 0.25],
  verticalVelocity: [0.03, 0.20],
  visibility: [0.02, 0.15],
}

const EMA_ALPHA = 0.20
const MIN_PAIRS = 20
const NNLS_LR = 0.005
const NNLS_ITER = 2000

// ── NNLS via projected gradient descent ──────────────────────────────────────

function nnls(A, y, initialW, boundsArr) {
  const n = A.length
  const m = A[0].length
  let w = [...initialW]

  for (let iter = 0; iter < NNLS_ITER; iter++) {
    // gradient of ||Aw - y||^2 / n
    const g = Array(m).fill(0)
    for (let i = 0; i < n; i++) {
      let resid = -y[i]
      for (let j = 0; j < m; j++) resid += A[i][j] * w[j]
      for (let j = 0; j < m; j++) g[j] += 2 * A[i][j] * resid / n
    }
    const wNew = w.map((v, j) => v - NNLS_LR * g[j])
    // Project to [lo, hi]
    for (let j = 0; j < m; j++) {
      const [lo, hi] = boundsArr[j]
      wNew[j] = Math.max(lo, Math.min(hi, wNew[j]))
    }
    // Renormalize to sum = 1
    const s = wNew.reduce((a, v) => a + v, 0)
    for (let j = 0; j < m; j++) wNew[j] /= s
    w = wNew
  }
  return w
}

// ── Z-score normalization (per city) ─────────────────────────────────────────

function zNormalize(pairs) {
  const byCity = new Map()
  for (const p of pairs) {
    if (!byCity.has(p.city_id)) byCity.set(p.city_id, [])
    byCity.get(p.city_id).push(p.social_score)
  }

  const stats = new Map()
  for (const [id, scores] of byCity) {
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length
    const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length
    stats.set(id, { mean, std: Math.sqrt(variance) || 1 })
  }

  return pairs.map(p => {
    const { mean, std } = stats.get(p.city_id)
    return {
      ...p,
      social_score_norm: Math.min(100, Math.max(0, 50 + (p.social_score - mean) / std * 15)),
    }
  })
}

// ── Pearson correlation ───────────────────────────────────────────────────────

function pearsonR(xs, ys) {
  const n = xs.length
  if (n < 2) return 0
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let num = 0, dx2 = 0, dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  }
  return Math.sqrt(dx2 * dy2) < 1e-9 ? 0 : num / Math.sqrt(dx2 * dy2)
}

// ── Main calibration ──────────────────────────────────────────────────────────

export function runSocialCalibration(lookbackDays = 30) {
  const raw = getSocialCalibrationPairs(lookbackDays)
  if (raw.length < MIN_PAIRS) {
    return { ok: false, reason: `Not enough pairs: ${raw.length} < ${MIN_PAIRS}`, pairs: raw.length }
  }

  const pairs = zNormalize(raw)

  // Build matrices
  const A = pairs.map(p => DB_COLS.map(c => p[c] ?? 50))
  const y = pairs.map(p => p.social_score_norm)

  const current = getWeights()
  const initialW = DIMS.map(k => current[k])
  const boundsArr = DIMS.map(k => WEIGHT_BOUNDS[k])

  const optW = nnls(A, y, initialW, boundsArr)

  // Build new weight object
  const newWeights = {}
  for (let i = 0; i < DIMS.length; i++) newWeights[DIMS[i]] = Math.round(optW[i] * 10000) / 10000

  // EMA blend with current
  const blended = {}
  for (const k of DIMS) {
    blended[k] = Math.round(((1 - EMA_ALPHA) * current[k] + EMA_ALPHA * newWeights[k]) * 10000) / 10000
  }

  // Renormalize after EMA
  const sum = Object.values(blended).reduce((s, v) => s + v, 0)
  for (const k of DIMS) blended[k] = Math.round(blended[k] / sum * 10000) / 10000

  // Compute metrics
  const predScores = pairs.map(p => p.pred_score)
  const socialNorm = pairs.map(p => p.social_score_norm)
  const rBefore = pearsonR(predScores, socialNorm)

  const predictedAfter = pairs.map(p => {
    let s = 0
    for (let i = 0; i < DIMS.length; i++) s += (p[DB_COLS[i]] ?? 50) * blended[DIMS[i]]
    return s
  })
  const rAfter = pearsonR(predictedAfter, socialNorm)

  const mae = Math.round(
    pairs.reduce((s, p, i) => s + Math.abs(predictedAfter[i] - p.social_score_norm), 0) / pairs.length * 100
  ) / 100

  const date = new Date().toISOString().slice(0, 10)
  saveWeightRecord(date + '-social', blended, mae, { pearson_before: rBefore, pearson_after: rAfter }, pairs.length, 'social-calibration')
  setWeights(blended)

  console.log(`[social-cal] Pearson r: ${rBefore.toFixed(3)} → ${rAfter.toFixed(3)}, MAE: ${mae}, n=${pairs.length}`)
  return { ok: true, weights: blended, pearsonBefore: rBefore, pearsonAfter: rAfter, mae, sampleCount: pairs.length }
}

// ── Investigation report ──────────────────────────────────────────────────────

export function generateInvestigationReport(lookbackDays = 30) {
  const raw = getSocialCalibrationPairs(lookbackDays)
  if (raw.length === 0) return { error: 'No social observation data. Run fetch first.' }

  const pairs = zNormalize(raw)
  const current = getWeights()

  // Compute prediction error per pair
  const analyzed = pairs.map(p => {
    const predicted = DIMS.reduce((s, k, i) => s + (p[DB_COLS[i]] ?? 50) * current[k], 0)
    const error = predicted - p.social_score_norm
    return {
      date: p.date, city_id: p.city_id, city_name: p.city_name,
      predScore: Math.round(predicted),
      socialScore: Math.round(p.social_score_norm),
      rawSocial: p.social_score,
      postCount: p.post_count,
      error: Math.round(error),
    }
  })

  analyzed.sort((a, b) => Math.abs(b.error) - Math.abs(a.error))

  // Overall stats
  const predScores = pairs.map(p => DIMS.reduce((s, k, i) => s + (p[DB_COLS[i]] ?? 50) * current[k], 0))
  const socialNorm = pairs.map(p => p.social_score_norm)
  const r = pearsonR(predScores, socialNorm)
  const mae = predScores.reduce((s, v, i) => s + Math.abs(v - socialNorm[i]), 0) / predScores.length

  const falsePosTop = analyzed.filter(a => a.error > 10).slice(0, 10) // overestimates
  const falseNegTop = analyzed.filter(a => a.error < -10).slice(0, 10) // underestimates

  // Dimension importance (how much each sub-score correlates with social)
  const dimCorrelations = {}
  for (let i = 0; i < DIMS.length; i++) {
    const subScores = pairs.map(p => p[DB_COLS[i]] ?? 50)
    dimCorrelations[DIMS[i]] = Math.round(pearsonR(subScores, socialNorm) * 1000) / 1000
  }

  return {
    summary: { sampleCount: pairs.length, pearsonR: Math.round(r * 1000) / 1000, mae: Math.round(mae * 10) / 10 },
    currentWeights: current,
    dimensionCorrelations: dimCorrelations,
    falsePositives: falsePosTop,
    falseNegatives: falseNegTop,
    status: getSocialStatus(),
  }
}
