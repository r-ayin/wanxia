const TIER_COLORS = {
  Great: '#ef4444',
  Good: '#f97316',
  Fair: '#f59e0b',
  Poor: '#6b7280',
}

let mapInstance = null
let markerLayer = null
let heatLayer = null
let gridLayer = null
let contourLayer = null
let contourGridPoints = []
let contourGridMap = new Map()
let currentView = 'markers'

export function initMap(containerId) {
  mapInstance = L.map(containerId, {
    center: [35.0, 105.0],
    zoom: 4,
    minZoom: 3,
    maxZoom: 12,
    zoomControl: true,
  })

  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
    attribution: '&copy; <a href="https://www.amap.com/">高德地图</a>',
    subdomains: '1234',
    maxZoom: 18,
  }).addTo(mapInstance)

  markerLayer = L.featureGroup().addTo(mapInstance)

  return mapInstance
}

function scoreToRadius(score) {
  return 6 + (score / 100) * 12
}

function tierToColor(tier) {
  return TIER_COLORS[tier] || TIER_COLORS.Poor
}

export function updateMarkers(predictions, onCityClick) {
  if (!markerLayer) return
  markerLayer.clearLayers()

  predictions.forEach(city => {
    const color = tierToColor(city.tier)
    const radius = scoreToRadius(city.score)
    const sunsetShort = city.sunsetTime ? city.sunsetTime.split('T')[1]?.slice(0, 5) : '--:--'

    const marker = L.circleMarker([city.lat, city.lon], {
      radius,
      fillColor: color,
      color: 'rgba(0,0,0,0.25)',
      weight: 1.5,
      opacity: 0.9,
      fillOpacity: 0.8,
      className: city.tier === 'Great' ? 'great-marker' : '',
    })

    const tooltipContent = `
      <div class="tooltip-name">${city.name} ${city.tierEmoji}</div>
      <div class="tooltip-score">${city.score}分 · ${city.tierCn}</div>
      <div class="tooltip-time">日落 ${sunsetShort} · ${city.dominantColor.name}</div>
    `

    marker.bindTooltip(tooltipContent, {
      className: 'city-tooltip',
      direction: 'top',
      offset: [0, -radius],
    })

    marker.on('click', () => onCityClick(city))
    markerLayer.addLayer(marker)
  })
}

export function updateHeatmap(predictions) {
  if (heatLayer) {
    mapInstance.removeLayer(heatLayer)
    heatLayer = null
  }

  const heatData = predictions.map(p => [p.lat, p.lon, p.score / 100])

  heatLayer = L.heatLayer(heatData, {
    radius: 45,
    blur: 35,
    maxZoom: 8,
    max: 1.0,
    gradient: {
      0.0: 'rgba(200,200,200,0)',
      0.2: '#fde68a',
      0.4: '#fdba74',
      0.6: '#fb923c',
      0.8: '#f97316',
      1.0: '#ef4444',
    },
  }).addTo(mapInstance)
}

export function toggleView(predictions, onCityClick) {
  if (currentView === 'markers') {
    currentView = 'heatmap'
    if (markerLayer) mapInstance.removeLayer(markerLayer)
    updateHeatmap(predictions)
    return 'markers'
  } else {
    currentView = 'markers'
    if (heatLayer) { mapInstance.removeLayer(heatLayer); heatLayer = null }
    markerLayer.addTo(mapInstance)
    updateMarkers(predictions, onCityClick)
    return 'heatmap'
  }
}

export function getMap() {
  return mapInstance
}

export function clearGridLayer() {
  if (gridLayer) { mapInstance.removeLayer(gridLayer); gridLayer = null }
  if (heatLayer) { mapInstance.removeLayer(heatLayer); heatLayer = null }
  if (contourLayer) { mapInstance.removeLayer(contourLayer); contourLayer = null }
  if (markerLayer) mapInstance.removeLayer(markerLayer)
}

export function ensureGridLayer() {
  if (!gridLayer) {
    gridLayer = L.layerGroup().addTo(mapInstance)
  }
  return gridLayer
}

export function addBatchCells(points, step) {
  const layer = ensureGridLayer()
  const half = step / 2

  points.forEach(p => {
    const color = scoreToColor(p.score)
    const bounds = [[p.lat - half, p.lon - half], [p.lat + half, p.lon + half]]
    L.rectangle(bounds, {
      color: 'transparent',
      fillColor: color,
      fillOpacity: 0.5,
      weight: 0,
    }).addTo(layer)
  })
}

function scoreToColor(score) {
  if (score >= 80) return '#ef4444'
  if (score >= 70) return '#f97316'
  if (score >= 55) return '#f59e0b'
  if (score >= 40) return '#a3e635'
  return '#6b7280'
}

export function renderGridHeatmap(points) {
  clearGridLayer()

  const heatData = points.map(p => [p.lat, p.lon, p.score / 100])
  heatLayer = L.heatLayer(heatData, {
    radius: 35,
    blur: 25,
    maxZoom: 12,
    max: 1.0,
    gradient: {
      0.0: 'rgba(200,200,200,0)',
      0.2: '#fde68a',
      0.4: '#fdba74',
      0.55: '#fb923c',
      0.7: '#f97316',
      0.8: '#ef4444',
      1.0: '#dc143c',
    },
  }).addTo(mapInstance)
}

export function renderGridCells(points) {
  clearGridLayer()
  gridLayer = L.layerGroup().addTo(mapInstance)

  const step = 0.25
  const cellSize = 0.25

  points.forEach(p => {
    const color = scoreToColor(p.score)
    const bounds = [[p.lat - cellSize / 2, p.lon - cellSize / 2], [p.lat + cellSize / 2, p.lon + cellSize / 2]]
    L.rectangle(bounds, {
      color: 'transparent',
      fillColor: color,
      fillOpacity: 0.55,
      weight: 0,
    }).addTo(gridLayer)
  })
}

export function renderContourRegions(geojson, predictions, onCityClick, gridPts) {
  if (contourLayer) { mapInstance.removeLayer(contourLayer); contourLayer = null }
  if (heatLayer) { mapInstance.removeLayer(heatLayer); heatLayer = null }
  if (gridLayer) { mapInstance.removeLayer(gridLayer); gridLayer = null }

  contourGridPoints = gridPts || []
  contourGridMap = new Map()
  for (const p of contourGridPoints) {
    contourGridMap.set(`${p.lat},${p.lon}`, p)
  }

  contourLayer = L.geoJSON(geojson, {
    style: function (feature) {
      const p = feature.properties
      return {
        fillColor: p.fillColor,
        fillOpacity: p.fillOpacity,
        color: p.stroke,
        opacity: p.strokeOpacity,
        weight: p.strokeWidth,
        className: 'contour-region',
      }
    },
    onEachFeature: function (feature, layer) {
      const p = feature.properties
      layer.bindTooltip(`${p.tierCn} (≥${p.threshold}分)`, {
        sticky: true,
        className: 'contour-tooltip',
      })
      if (contourGridPoints.length > 0) {
        layer.on('mousemove', (e) => {
          const result = interpolateGridScore(e.latlng.lat, e.latlng.lng)
          if (result) {
            layer.setTooltipContent(`${result.score}分 · ${result.tierCn}`)
          }
        })
      }
    },
  }).addTo(mapInstance)

  if (predictions && predictions.length > 0) {
    if (!mapInstance.hasLayer(markerLayer)) {
      markerLayer.addTo(mapInstance)
    }
    updateMarkers(predictions, onCityClick)
    markerLayer.bringToFront()
  }
}

export function clearContourLayer() {
  if (contourLayer) { mapInstance.removeLayer(contourLayer); contourLayer = null }
}

export function restoreMarkers(predictions, onCityClick) {
  if (gridLayer) { mapInstance.removeLayer(gridLayer); gridLayer = null }
  if (heatLayer) { mapInstance.removeLayer(heatLayer); heatLayer = null }
  if (contourLayer) { mapInstance.removeLayer(contourLayer); contourLayer = null }
  markerLayer.addTo(mapInstance)
  updateMarkers(predictions, onCityClick)
}

function interpolateGridScore(lat, lon) {
  if (contourGridMap.size === 0) return null

  const lat0 = Math.floor(lat)
  const lon0 = Math.floor(lon)
  const lat1 = lat0 + 1
  const lon1 = lon0 + 1

  const p00 = contourGridMap.get(`${lat0},${lon0}`)
  const p10 = contourGridMap.get(`${lat1},${lon0}`)
  const p01 = contourGridMap.get(`${lat0},${lon1}`)
  const p11 = contourGridMap.get(`${lat1},${lon1}`)

  if (!p00 || !p10 || !p01 || !p11) {
    let best = null, bestDist = Infinity
    for (const p of contourGridPoints) {
      const d = (p.lat - lat) ** 2 + (p.lon - lon) ** 2
      if (d < bestDist) { bestDist = d; best = p }
    }
    return best
  }

  const t = lat - lat0
  const s = lon - lon0

  const score = Math.round(
    p00.score * (1 - t) * (1 - s) +
    p01.score * (1 - t) * s +
    p10.score * t * (1 - s) +
    p11.score * t * s
  )

  const tierCn = score >= 90 ? '极佳' : score >= 80 ? '优秀' : score >= 70 ? '很好' : score >= 60 ? '好' : score >= 50 ? '尚可' : '差'
  return { score, tierCn }
}
