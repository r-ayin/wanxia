import { contours } from 'd3-contour'

const TIER_STYLES = [
  { threshold: 95, tierCn: '极佳', fillColor: '#880e4f', fillOpacity: 0.42 },
  { threshold: 90, tierCn: '极佳', fillColor: '#c2185b', fillOpacity: 0.40 },
  { threshold: 85, tierCn: '优秀', fillColor: '#d32f2f', fillOpacity: 0.38 },
  { threshold: 80, tierCn: '优秀', fillColor: '#e53935', fillOpacity: 0.36 },
  { threshold: 75, tierCn: '很好', fillColor: '#ef5350', fillOpacity: 0.34 },
  { threshold: 70, tierCn: '很好', fillColor: '#ff7043', fillOpacity: 0.32 },
  { threshold: 65, tierCn: '好',   fillColor: '#ff9800', fillOpacity: 0.30 },
  { threshold: 60, tierCn: '好',   fillColor: '#ffb74d', fillOpacity: 0.26 },
  { threshold: 55, tierCn: '尚可', fillColor: '#ffe082', fillOpacity: 0.20 },
  { threshold: 50, tierCn: '尚可', fillColor: '#fff9c4', fillOpacity: 0.12 },
]

const UPSCALE = 3
const SMOOTH_ITER = 3

function upscaleMatrix(matrix, width, height) {
  const nw = (width - 1) * UPSCALE + 1
  const nh = (height - 1) * UPSCALE + 1
  const out = new Float64Array(nw * nh)

  for (let r = 0; r < nh; r++) {
    for (let c = 0; c < nw; c++) {
      const sr = r / UPSCALE, sc = c / UPSCALE
      const r0 = Math.floor(sr), c0 = Math.floor(sc)
      const r1 = Math.min(r0 + 1, height - 1), c1 = Math.min(c0 + 1, width - 1)
      const dr = sr - r0, dc = sc - c0
      out[r * nw + c] =
        matrix[r0 * width + c0] * (1 - dr) * (1 - dc) +
        matrix[r0 * width + c1] * (1 - dr) * dc +
        matrix[r1 * width + c0] * dr * (1 - dc) +
        matrix[r1 * width + c1] * dr * dc
    }
  }
  return { matrix: out, width: nw, height: nh }
}

function chaikinSmooth(ring) {
  if (ring.length < 4) return ring
  let pts = ring.slice(0, -1)
  for (let i = 0; i < SMOOTH_ITER; i++) {
    const n = pts.length, next = []
    for (let j = 0; j < n; j++) {
      const a = pts[j], b = pts[(j + 1) % n]
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    }
    pts = next
  }
  pts.push(pts[0])
  return pts
}

export function buildContourGeoJSON(points, gridConfig) {
  const { latMin, latMax, lonMin, lonMax, step } = gridConfig
  const width = Math.round((lonMax - lonMin) / step) + 1
  const height = Math.round((latMax - latMin) / step) + 1

  const matrix = new Float64Array(width * height).fill(0)
  for (const p of points) {
    const col = Math.round((p.lon - lonMin) / step)
    const row = Math.round((latMax - p.lat) / step)
    if (col >= 0 && col < width && row >= 0 && row < height) {
      matrix[row * width + col] = p.score
    }
  }

  const up = upscaleMatrix(matrix, width, height)
  const thresholds = TIER_STYLES.map(t => t.threshold)
  const gen = contours().size([up.width, up.height]).thresholds(thresholds).smooth(true)
  const raw = gen(up.matrix)

  const features = []
  for (const c of raw) {
    const style = TIER_STYLES.find(t => t.threshold === c.value)
    if (!style) continue
    const geo = transformCoordinates(c.coordinates, up.width, up.height, lonMin, lonMax, latMin, latMax)
    const smoothed = geo.map(poly => poly.map(ring => chaikinSmooth(ring)))

    features.push({
      type: 'Feature',
      properties: {
        threshold: style.threshold,
        tierCn: style.tierCn,
        fillColor: style.fillColor,
        fillOpacity: style.fillOpacity,
        stroke: 'transparent',
        strokeOpacity: 0,
        strokeWidth: 0,
      },
      geometry: { type: c.type, coordinates: smoothed },
    })
  }

  return { type: 'FeatureCollection', features }
}

function transformCoordinates(coordinates, width, height, lonMin, lonMax, latMin, latMax) {
  const lonRange = lonMax - lonMin
  const latRange = latMax - latMin
  const tw = width - 1, th = height - 1

  function tp(p) {
    return [
      Math.round((lonMin + (p[0] / tw) * lonRange) * 1000) / 1000,
      Math.round((latMax - (p[1] / th) * latRange) * 1000) / 1000,
    ]
  }

  return coordinates.map(poly => poly.map(ring => ring.map(tp)))
}
