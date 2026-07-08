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

function initMap(containerId) {
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

function updateMarkers(predictions, onCityClick) { document.title += " [M]";
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

function updateHeatmap(predictions) {
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

function toggleView(predictions, onCityClick) {
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

function getMap() {
  return mapInstance
}

function clearGridLayer() {
  if (gridLayer) { mapInstance.removeLayer(gridLayer); gridLayer = null }
  if (heatLayer) { mapInstance.removeLayer(heatLayer); heatLayer = null }
  if (contourLayer) { mapInstance.removeLayer(contourLayer); contourLayer = null }
  if (markerLayer) mapInstance.removeLayer(markerLayer)
}

function ensureGridLayer() {
  if (!gridLayer) {
    gridLayer = L.layerGroup().addTo(mapInstance)
  }
  return gridLayer
}

function addBatchCells(points, step) {
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

function renderGridHeatmap(points) {
  clearGridLayer()

  const heatData = points.map(p => [p.lat, p.lon, p.score / 100])
  // 自适应热力半径：点数少（城市网格）用大圈，点数多（全国/杭州）用小圈
  const isSmallGrid = points.length <= 100
  heatLayer = L.heatLayer(heatData, {
    radius: isSmallGrid ? 55 : 35,
    blur: isSmallGrid ? 35 : 25,
    maxZoom: 12,
    max: 1.0,
    gradient: {
      0.0: 'rgba(255,255,255,0)',
      0.2: '#fde68a',
      0.4: '#fdba74',
      0.55: '#fb923c',
      0.7: '#f97316',
      0.85: '#ef4444',
      1.0: '#dc143c',
    },
  }).addTo(mapInstance)
}

function renderGridCells(points) {
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

function renderContourRegions(geojson, predictions, onCityClick, gridPts) {
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

function clearContourLayer() {
  if (contourLayer) { mapInstance.removeLayer(contourLayer); contourLayer = null }
}

function restoreMarkers(predictions, onCityClick) {
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
const SUBSCORE_LABELS = {
  highCloud: '高云覆盖',
  humidity: '湿度指数',
  pressure: '气压趋势',
  aerosol: '气溶胶',
  verticalVelocity: '垂直运动',
  visibility: '能见度',
}

const SUBSCORE_ORDER = ['highCloud', 'humidity', 'pressure', 'aerosol', 'verticalVelocity', 'visibility']

const RAW_DATA_LABELS = {
  cloudCoverHigh: '高云覆盖率',
  cloudCoverMid: '中云覆盖率',
  cloudCoverLow: '低云覆盖率',
  cloudCover: '总云量',
  rh2m: '地面相对湿度',
  rh500: '500hPa湿度',
  rh300: '300hPa湿度',
  aod: '气溶胶光学厚度',
  omega500: '500hPa垂直速度',
  visibility: '能见度',
  pressureTendency: '3h气压变化',
}

const RAW_DATA_UNITS = {
  cloudCoverHigh: '%',
  cloudCoverMid: '%',
  cloudCoverLow: '%',
  cloudCover: '%',
  rh2m: '%',
  rh500: '%',
  rh300: '%',
  aod: '',
  omega500: 'm/s',
  visibility: 'm',
  pressureTendency: 'hPa/h',
}

function tierColor(tier) {
  const map = { Great: '#ef4444', Good: '#f97316', Fair: '#f59e0b', Poor: '#6b7280' }
  return map[tier] || map.Poor
}

function barColor(value) {
  if (value >= 75) return '#ef4444'
  if (value >= 50) return '#f97316'
  if (value >= 25) return '#f59e0b'
  return '#6b7280'
}

function formatRawValue(key, val) {
  if (val == null) return '--'
  if (key === 'visibility') return `${(val / 1000).toFixed(1)} km`
  if (key === 'aod') return val.toFixed(3)
  if (key === 'omega500') return `${val.toFixed(3)} m/s`
  if (key === 'pressureTendency') return `${val > 0 ? '+' : ''}${val.toFixed(2)} hPa/h`
  return `${val}%`
}

function renderDetailPanel(city) {
  const color = tierColor(city.tier)
  const sunsetShort = city.sunsetTime ? city.sunsetTime.split('T')[1]?.slice(0, 5) : '--:--'

  let html = `
    <div class="panel-header">
      <div class="panel-city-name">${city.name}</div>
      <div class="panel-city-en">${city.nameEn}</div>
      <div class="panel-province">${city.province} · ${city.region}</div>

      <div class="score-circle" style="border-color: ${color}">
        <div class="score-number" style="color: ${color}">${city.score}</div>
        <div class="score-label">/ 100</div>
      </div>

      <div class="tier-badge" style="background: ${color}22; color: ${color}; border: 1px solid ${color}44">
        ${city.tierEmoji} ${city.tierCn}
      </div>
    </div>

    <div class="sunset-time-display">
      <div class="sunset-time-label">今日日落时间</div>
      <div class="sunset-time-value">${sunsetShort}</div>
    </div>

    <div class="color-preview">
      <div class="color-swatch" style="background: ${city.dominantColor.hex}"></div>
      <div>
        <div class="color-name">预计主色调: ${city.dominantColor.name}</div>
        <div class="color-name-en">${city.dominantColor.nameEn}</div>
      </div>
    </div>

    <div class="subscores-section">
      <div class="subscores-title">评分分解</div>
  `

  for (const key of SUBSCORE_ORDER) {
    const val = city.subScores[key]
    const bc = barColor(val)
    html += `
      <div class="subscore-row">
        <span class="subscore-label">${SUBSCORE_LABELS[key]}</span>
        <div class="subscore-bar-bg">
          <div class="subscore-bar-fill" style="width:${val}%; background:${bc}"></div>
        </div>
        <span class="subscore-value" style="color:${bc}">${val}</span>
      </div>
    `
  }

  html += `</div>`

  html += `
    <div class="raw-data-section">
      <button class="raw-data-toggle" onclick="this.nextElementSibling.classList.toggle('open'); this.textContent = this.nextElementSibling.classList.contains('open') ? '收起原始数据 ▲' : '展开原始数据 ▼'">
        展开原始数据 ▼
      </button>
      <div class="raw-data-table">
        <table>
          <thead><tr><th>参数</th><th>值</th></tr></thead>
          <tbody>
  `

  if (city.rawData) {
    for (const [key, label] of Object.entries(RAW_DATA_LABELS)) {
      const val = city.rawData[key]
      html += `<tr><td>${label}</td><td>${formatRawValue(key, val)}</td></tr>`
    }
  }

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `

  html += `
    <div class="history-section">
      <div class="history-title">近期趋势</div>
      <div class="history-chart" id="history-chart">
        <div class="history-loading">加载历史数据...</div>
      </div>
    </div>
  `

  return html
}

function renderHistoryChart(records) {
  const container = document.getElementById('history-chart')
  if (!container) return

  if (!records || records.length === 0) {
    container.innerHTML = '<div class="history-empty">暂无历史数据</div>'
    return
  }

  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date))

  let html = '<div class="history-bars">'
  for (const r of sorted) {
    const tier = r.score >= 75 ? 'Great' : r.score >= 50 ? 'Good' : r.score >= 18 ? 'Fair' : 'Poor'
    const color = tierColor(tier)
    const dateShort = r.date.slice(5)
    html += `
      <div class="history-bar-wrap" title="${r.date}: ${r.score}分">
        <div class="history-bar" style="height:${r.score}%; background:${color}"></div>
        <div class="history-bar-score">${r.score}</div>
        <div class="history-bar-date">${dateShort}</div>
      </div>
    `
  }
  html += '</div>'
  container.innerHTML = html
}

async function loadCityHistory(cityId) {
  try {
    const res = await fetch(`/api/history/${cityId}?days=14`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    renderHistoryChart(data.records)
  } catch {
    const container = document.getElementById('history-chart')
    if (container) container.innerHTML = '<div class="history-empty">历史数据加载失败</div>'
  }
}

function openPanel(city) {
  const panel = document.getElementById('detail-panel')
  const content = document.getElementById('panel-content')
  content.innerHTML = renderDetailPanel(city)
  panel.classList.add('open')
}

function closePanel() {
  document.getElementById('detail-panel').classList.remove('open')
}

let predictions = null
let gridData = null
let contourData = null
currentView = 'national'
let nationalMode = 'contour'
let contourStream = null
let streamedPoints = []
let cityGrids = []

async function fetchJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error('HTTP '+r.status); return r.json() }

function handleCityClick(city) { openPanel(city); loadCityHistory(city.id) }

// Expose for Playwright screenshot automation
window.__wanxia = {
  getCities: () => predictions,
  getSummary: () => {
    const bar = document.getElementById('summary-bar')
    return bar?.textContent?.trim() || ''
  },
  openCity: (cityId) => {
    const city = predictions?.find(c => c.id === cityId)
    if (city) handleCityClick(city)
    return !!city
  },
  closePanel: () => closePanel(),
  getTopCities: (n = 5) => {
    if (!predictions?.length) return []
    return [...predictions]
      .filter(c => c.score != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
  },
  getMap: () => getMap(),
  zoomToCity: (lat, lon, zoom = 12) => {
    const m = getMap()
    if (m) {
      m.setView([lat, lon], zoom, { animate: false })
      return true
    }
    return false
  },
}

function hideLoading() { document.getElementById('loading').classList.add('hidden') }
function showError(m) { const e = document.getElementById('loading'); e.querySelector('p').textContent = m; e.querySelector('.loading-spinner').style.display = 'none' }

function updateTime(data) {
  const el = document.getElementById('update-time'); el.style.color = ''
  if (data.generatedAt) { const d = new Date(data.generatedAt); el.textContent = '更新于 ' + d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}); if (data.stale) el.textContent += ' (旧数据)' }
}

function stopContourStream() { if (contourStream) { contourStream.close(); contourStream = null } }

function renderView(cData) {
  if (nationalMode === 'contour' && cData.contours) {
    renderContourRegions(cData.contours, predictions, handleCityClick, cData.points)
  } else {
    clearContourLayer(); renderGridHeatmap(cData.points)
  }
  const bar = document.getElementById('summary-bar'), s = cData.summary
  if (s) bar.innerHTML = '<span class="summary-stat">均分 <span class="value">'+s.avgScore+'</span></span> <span class="summary-stat">极佳 <span class="value" style="color:#ef4444">'+s.greatPct+'%</span></span> <span class="summary-stat">好 <span class="value" style="color:#f97316">'+s.goodPct+'%</span></span>'
  updateTime(cData)
}

function startContourStream() { document.title += " [S]";
  stopContourStream()
  if (contourData) { renderView(contourData); return }
  contourStream = new EventSource('/api/contour/stream')
  streamedPoints = []
  contourStream.onmessage = function(e) {
    var d = JSON.parse(e.data)
    if (d.type === 'batch') { streamedPoints = streamedPoints.concat(d.points) }
    else if (d.type === 'complete') {
      var pts = d.points || streamedPoints
      contourData = { contours: d.contours, summary: d.summary, pointCount: d.pointCount, points: pts, generatedAt: new Date().toISOString() }
      stopContourStream(); renderView(contourData)
    }
    else if (d.type === 'error') { var el = document.getElementById('update-time'); el.style.color = '#ef4444'; el.textContent = '数据加载失败'; stopContourStream() }
  }
}

async function loadNationalData() {
  var d = await fetchJSON('/api/predictions'); predictions = d.cities
  updateMarkers(predictions, handleCityClick); hideLoading()
    document.title += " [L]";
  var bar = document.getElementById('summary-bar'), s = d.summary
  if (s) { var best = s.bestCity; bar.innerHTML = '<span class="summary-stat">均分 <span class="value">'+s.averageScore+'</span></span> <span class="summary-stat">最佳 <span class="value" style="color:#ef4444">'+(best?best.name+' '+best.score+'分':'')+'</span></span>' }
  updateTime(d)
  if (nationalMode !== 'markers') startContourStream()
}

async function loadGridForCity(cityId) {
  var d = await fetchJSON('/api/grid/'+cityId)
  if (!d.points||!d.points.length) { showError('No data'); return }
  renderGridHeatmap(d.points)
  var bar = document.getElementById('summary-bar'), pts = d.points, scores = pts.map(function(p){return p.score})
  bar.innerHTML = '<span class="summary-stat">均分 <span class="value">'+Math.round(scores.reduce(function(a,b){return a+b},0)/scores.length)+'</span></span> <span class="summary-stat">网格 <span class="value">'+pts.length+'点</span></span>'
  updateTime(d); hideLoading()
}

async function loadCityGrids() {
  try { cityGrids = await fetchJSON('/api/grids')
    var c = document.getElementById('city-buttons'); c.innerHTML = ''
    cityGrids.forEach(function(g) { var b = document.createElement('button'); b.className='view-btn'; b.id='btn-'+g.id; b.textContent=g.name; b.addEventListener('click',function(){switchToCity(g.id)}); c.appendChild(b) })
  } catch(e) { console.error(e) }
}

function switchToCity(cityId) {
  if (currentView === cityId) return; var cfg = cityGrids.find(function(g){return g.id===cityId}); if (!cfg) return
  document.querySelectorAll('#city-buttons .view-btn').forEach(function(b){b.classList.add('view-btn-inactive')})
  if (cfg.isNational) { switchToNational() } else { document.getElementById('btn-'+cityId).classList.remove('view-btn-inactive'); switchToCityGrid(cfg) }
}

function switchToNational() {
  currentView='national'; closePanel()
  document.querySelectorAll('#city-buttons .view-btn').forEach(function(b){b.style.display=b.id==='btn-national'?'':'none'})
  document.getElementById('view-modes').style.display=''
  document.querySelectorAll('#view-modes .view-mode-btn').forEach(function(b){b.style.display=''})
  var m=getMap(); if(m){clearGridLayer();m.setView([35,105],4)}
  loadNationalData()
}

function switchToCityGrid(cfg) {
  currentView=cfg.id; stopContourStream(); closePanel()
  document.querySelectorAll('#city-buttons .view-btn').forEach(function(b){b.style.display=''})
  document.getElementById('btn-'+cfg.id).classList.remove('view-btn-inactive')
  document.getElementById('view-modes').style.display=''
  document.querySelectorAll('#view-modes .view-mode-btn').forEach(function(b){b.style.display=b.dataset.mode==='contour'?'none':''})
  var m=getMap(); if(m){clearGridLayer();m.setView(cfg.center,cfg.zoom)}
  document.getElementById('loading').classList.remove('hidden'); document.getElementById('loading').querySelector('p').textContent=cfg.name+' 数据加载中...'
  loadGridForCity(cfg.id)
}

document.addEventListener('DOMContentLoaded', function() {
  initMap('map'); loadNationalData(); loadCityGrids()
  document.getElementById('refresh-btn').addEventListener('click', function() { stopContourStream(); contourData=null; if(currentView==='national')loadNationalData();else loadGridForCity(currentView) })
  document.getElementById('panel-close').addEventListener('click', closePanel)
  document.getElementById('view-modes').addEventListener('click', function(e) {
    var btn = e.target.closest('.view-mode-btn'); if (!btn||currentView!=='national') return
    var mode = btn.dataset.mode; if (mode===nationalMode) return
    stopContourStream(); nationalMode=mode
    document.querySelectorAll('#view-modes .view-mode-btn').forEach(function(b){b.classList.toggle('active',b.dataset.mode===mode)})
    if (mode==='markers'&&predictions) { clearContourLayer(); updateMarkers(predictions,handleCityClick) }
    else { contourData=null; loadNationalData() }
  })
})
