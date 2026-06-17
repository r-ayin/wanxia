import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, '..', 'data', 'sunset.db')

let db

export function initDatabase() {
  mkdirSync(join(__dirname, '..', 'data'), { recursive: true })
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      city_id TEXT NOT NULL,
      city_name TEXT,
      lat REAL,
      lon REAL,
      region TEXT,
      score INTEGER,
      tier TEXT,
      sub_humidity REAL,
      sub_high_cloud REAL,
      sub_pressure REAL,
      sub_aerosol REAL,
      sub_vertical_velocity REAL,
      sub_visibility REAL,
      cloud_cover_high REAL,
      cloud_cover_mid REAL,
      cloud_cover_low REAL,
      cloud_cover REAL,
      rh2m REAL,
      rh500 REAL,
      rh300 REAL,
      aod REAL,
      omega500 REAL,
      visibility REAL,
      pressure_tendency REAL,
      sunset_time TEXT,
      dominant_color TEXT,
      generated_at TEXT,
      UNIQUE(date, city_id)
    );

    CREATE TABLE IF NOT EXISTS actual_weather (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      city_id TEXT NOT NULL,
      actual_score INTEGER,
      sub_humidity REAL,
      sub_high_cloud REAL,
      sub_pressure REAL,
      sub_aerosol REAL,
      sub_vertical_velocity REAL,
      sub_visibility REAL,
      cloud_cover_high REAL,
      cloud_cover_mid REAL,
      cloud_cover_low REAL,
      cloud_cover REAL,
      rh2m REAL,
      rh500 REAL,
      rh300 REAL,
      aod REAL,
      omega500 REAL,
      visibility REAL,
      pressure_tendency REAL,
      fetched_at TEXT,
      UNIQUE(date, city_id)
    );

    CREATE TABLE IF NOT EXISTS weight_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      w_high_cloud REAL,
      w_humidity REAL,
      w_pressure REAL,
      w_aerosol REAL,
      w_vertical_velocity REAL,
      w_visibility REAL,
      mean_abs_error REAL,
      dimension_mae TEXT,
      sample_count INTEGER,
      notes TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_grid_summary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      grid_name TEXT NOT NULL,
      point_count INTEGER,
      avg_score REAL,
      great_pct REAL,
      good_pct REAL,
      fair_pct REAL,
      poor_pct REAL,
      created_at TEXT,
      UNIQUE(date, grid_name)
    );

    CREATE TABLE IF NOT EXISTS social_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      city_id TEXT NOT NULL,
      post_count INTEGER DEFAULT 0,
      total_engagement INTEGER DEFAULT 0,
      social_score REAL,
      source TEXT,
      raw_data TEXT,
      fetched_at TEXT,
      UNIQUE(date, city_id)
    );

    CREATE INDEX IF NOT EXISTS idx_predictions_city_date ON daily_predictions(city_id, date);
    CREATE INDEX IF NOT EXISTS idx_actual_city_date ON actual_weather(city_id, date);
    CREATE INDEX IF NOT EXISTS idx_social_city_date ON social_observations(city_id, date);
  `)

  return db
}

export function getDb() {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function storeDailyPredictions(date, predictions) {
  const stmt = getDb().prepare(`
    INSERT OR REPLACE INTO daily_predictions
    (date, city_id, city_name, lat, lon, region, score, tier,
     sub_humidity, sub_high_cloud, sub_pressure, sub_aerosol, sub_vertical_velocity, sub_visibility,
     cloud_cover_high, cloud_cover_mid, cloud_cover_low, cloud_cover,
     rh2m, rh500, rh300, aod, omega500, visibility, pressure_tendency,
     sunset_time, dominant_color, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertAll = getDb().transaction((preds) => {
    for (const p of preds) {
      stmt.run(
        date, p.id, p.name, p.lat, p.lon, p.region, p.score, p.tier,
        p.subScores?.humidity, p.subScores?.highCloud, p.subScores?.pressure,
        p.subScores?.aerosol, p.subScores?.verticalVelocity, p.subScores?.visibility,
        p.rawData?.cloudCoverHigh, p.rawData?.cloudCoverMid, p.rawData?.cloudCoverLow, p.rawData?.cloudCover,
        p.rawData?.rh2m, p.rawData?.rh500, p.rawData?.rh300, p.rawData?.aod,
        p.rawData?.omega500, p.rawData?.visibility, p.rawData?.pressureTendency,
        p.sunsetTime, p.dominantColor ? JSON.stringify(p.dominantColor) : null,
        new Date().toISOString()
      )
    }
  })

  insertAll(predictions)
}

export function storeActualWeather(date, cityId, data) {
  getDb().prepare(`
    INSERT OR REPLACE INTO actual_weather
    (date, city_id, actual_score,
     sub_humidity, sub_high_cloud, sub_pressure, sub_aerosol, sub_vertical_velocity, sub_visibility,
     cloud_cover_high, cloud_cover_mid, cloud_cover_low, cloud_cover,
     rh2m, rh500, rh300, aod, omega500, visibility, pressure_tendency, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    date, cityId, data.score,
    data.subScores?.humidity, data.subScores?.highCloud, data.subScores?.pressure,
    data.subScores?.aerosol, data.subScores?.verticalVelocity, data.subScores?.visibility,
    data.rawData?.cloudCoverHigh, data.rawData?.cloudCoverMid, data.rawData?.cloudCoverLow, data.rawData?.cloudCover,
    data.rawData?.rh2m, data.rawData?.rh500, data.rawData?.rh300, data.rawData?.aod,
    data.rawData?.omega500, data.rawData?.visibility, data.rawData?.pressureTendency,
    new Date().toISOString()
  )
}

export function getPredictionHistory(cityId, days = 30) {
  return getDb().prepare(`
    SELECT date, score, tier, sub_humidity, sub_high_cloud, sub_pressure,
           sub_aerosol, sub_vertical_velocity, sub_visibility, dominant_color, sunset_time
    FROM daily_predictions
    WHERE city_id = ? AND date >= date('now', ?)
    ORDER BY date DESC
  `).all(cityId, `-${days} days`)
}

export function getPredictionsByDate(date) {
  const rows = getDb().prepare(`
    SELECT city_id, city_name, lat, lon, region, score, tier,
           sub_humidity, sub_high_cloud, sub_pressure, sub_aerosol,
           sub_vertical_velocity, sub_visibility, dominant_color, sunset_time
    FROM daily_predictions
    WHERE date = ?
  `).all(date)

  if (!rows.length) return null

  return {
    date,
    cities: rows.map(r => ({
      id: r.city_id,
      name: r.city_name,
      lat: r.lat,
      lon: r.lon,
      region: r.region,
      score: r.score,
      tier: r.tier,
      tierCn: r.tier === 'Great' ? '极佳' : r.tier === 'Good' ? '好' : r.tier === 'Fair' ? '一般' : '翻车',
      dominantColor: safeJsonParse(r.dominant_color),
      sunsetTime: r.sunset_time,
      subScores: {
        humidity: r.sub_humidity,
        highCloud: r.sub_high_cloud,
        pressure: r.sub_pressure,
        aerosol: r.sub_aerosol,
        verticalVelocity: r.sub_vertical_velocity,
        visibility: r.sub_visibility,
      },
    })),
  }
}

function safeJsonParse(str) {
  if (!str) return null
  try { return JSON.parse(str) } catch { return null }
}

export function getCalibrationPairs(days = 14) {
  return getDb().prepare(`
    SELECT
      p.date, p.city_id,
      p.sub_humidity AS pred_humidity, p.sub_high_cloud AS pred_high_cloud,
      p.sub_pressure AS pred_pressure, p.sub_aerosol AS pred_aerosol,
      p.sub_vertical_velocity AS pred_vertical_velocity, p.sub_visibility AS pred_visibility,
      p.score AS pred_score,
      a.sub_humidity AS actual_humidity, a.sub_high_cloud AS actual_high_cloud,
      a.sub_pressure AS actual_pressure, a.sub_aerosol AS actual_aerosol,
      a.sub_vertical_velocity AS actual_vertical_velocity, a.sub_visibility AS actual_visibility,
      a.actual_score
    FROM daily_predictions p
    JOIN actual_weather a ON p.date = a.date AND p.city_id = a.city_id
    WHERE p.date >= date('now', ?)
    ORDER BY p.date DESC
  `).all(`-${days} days`)
}

export function saveWeightRecord(date, weights, mae, dimensionMae, sampleCount, notes) {
  getDb().prepare(`
    INSERT OR REPLACE INTO weight_history
    (date, w_high_cloud, w_humidity, w_pressure, w_aerosol, w_vertical_velocity, w_visibility,
     mean_abs_error, dimension_mae, sample_count, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    date,
    weights.highCloud, weights.humidity, weights.pressure,
    weights.aerosol, weights.verticalVelocity, weights.visibility,
    mae, JSON.stringify(dimensionMae), sampleCount, notes,
    new Date().toISOString()
  )
}

export function getLatestWeights() {
  return getDb().prepare(`
    SELECT w_high_cloud, w_humidity, w_pressure, w_aerosol, w_vertical_velocity, w_visibility
    FROM weight_history
    ORDER BY date DESC LIMIT 1
  `).get()
}

export function getWeightHistory(days = 30) {
  return getDb().prepare(`
    SELECT date, w_high_cloud, w_humidity, w_pressure, w_aerosol, w_vertical_velocity, w_visibility,
           mean_abs_error, sample_count, notes
    FROM weight_history
    WHERE date >= date('now', ?)
    ORDER BY date ASC
  `).all(`-${days} days`)
}

export function getAccuracyMetrics(days = 14) {
  const pairs = getCalibrationPairs(days)
  if (pairs.length === 0) return { sampleCount: 0, overallMAE: null, dimensions: {} }

  const dims = ['humidity', 'high_cloud', 'pressure', 'aerosol', 'vertical_velocity', 'visibility']
  const dimErrors = {}
  let totalScoreError = 0

  for (const dim of dims) {
    dimErrors[dim] = { sum: 0, count: 0 }
  }

  for (const pair of pairs) {
    totalScoreError += Math.abs(pair.pred_score - pair.actual_score)
    for (const dim of dims) {
      const pred = pair[`pred_${dim}`]
      const actual = pair[`actual_${dim}`]
      if (pred != null && actual != null) {
        dimErrors[dim].sum += Math.abs(pred - actual)
        dimErrors[dim].count++
      }
    }
  }

  const dimensions = {}
  for (const dim of dims) {
    const e = dimErrors[dim]
    dimensions[dim] = e.count > 0 ? Math.round(e.sum / e.count * 100) / 100 : null
  }

  return {
    sampleCount: pairs.length,
    overallMAE: Math.round(totalScoreError / pairs.length * 100) / 100,
    dimensions,
  }
}

export function storeGridSummary(date, gridName, points) {
  const total = points.length
  if (total === 0) return

  const avgScore = Math.round(points.reduce((s, p) => s + p.score, 0) / total * 10) / 10
  const tiers = { Great: 0, Good: 0, Fair: 0, Poor: 0 }
  for (const p of points) tiers[p.tier]++

  getDb().prepare(`
    INSERT OR REPLACE INTO daily_grid_summary
    (date, grid_name, point_count, avg_score, great_pct, good_pct, fair_pct, poor_pct, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    date, gridName, total, avgScore,
    Math.round(tiers.Great / total * 100 * 10) / 10,
    Math.round(tiers.Good / total * 100 * 10) / 10,
    Math.round(tiers.Fair / total * 100 * 10) / 10,
    Math.round(tiers.Poor / total * 100 * 10) / 10,
    new Date().toISOString()
  )
}

export function storeSocialObservation(date, cityId, data) {
  getDb().prepare(`
    INSERT OR REPLACE INTO social_observations
    (date, city_id, post_count, total_engagement, social_score, source, raw_data, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    date, cityId, data.postCount, data.totalEngagement, data.socialScore,
    data.source, data.rawData ? JSON.stringify(data.rawData) : null,
    new Date().toISOString()
  )
}

export function getSocialObservations(cityId, days = 30) {
  return getDb().prepare(`
    SELECT date, post_count, total_engagement, social_score, source
    FROM social_observations
    WHERE city_id = ? AND date >= date('now', ?)
    ORDER BY date DESC
  `).all(cityId, `-${days} days`)
}

export function getSocialCalibrationPairs(days = 30, minPostCount = 2) {
  // Use actual_weather (backfilled historical) instead of daily_predictions
  // so we can calibrate on dates before the server was running
  return getDb().prepare(`
    SELECT
      aw.date, aw.city_id,
      c.city_name,
      aw.sub_humidity, aw.sub_high_cloud, aw.sub_pressure,
      aw.sub_aerosol, aw.sub_vertical_velocity, aw.sub_visibility,
      aw.actual_score AS pred_score,
      so.social_score, so.post_count, so.total_engagement
    FROM actual_weather aw
    JOIN social_observations so ON aw.date = so.date AND aw.city_id = so.city_id
    LEFT JOIN (SELECT city_id, city_name FROM daily_predictions GROUP BY city_id) c ON c.city_id = aw.city_id
    WHERE aw.date >= date('now', ?)
      AND so.post_count >= ?
      AND so.social_score IS NOT NULL
      AND aw.sub_humidity IS NOT NULL
    ORDER BY aw.date DESC
  `).all(`-${days} days`, minPostCount)
}

export function getSocialStatus() {
  const db = getDb()
  const total = db.prepare('SELECT COUNT(*) as n FROM social_observations').get()?.n || 0
  const latest = db.prepare('SELECT MAX(fetched_at) as t FROM social_observations').get()?.t || null
  const byDate = db.prepare(`
    SELECT date, COUNT(*) as city_count, AVG(social_score) as avg_score
    FROM social_observations
    WHERE date >= date('now', '-7 days')
    GROUP BY date ORDER BY date DESC
  `).all()
  return { total, latest, byDate }
}

