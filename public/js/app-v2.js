import { initMap, updateMarkers, updateHeatmap, renderGridHeatmap, renderGridCells, renderContourRegions, restoreMarkers, clearGridLayer, clearContourLayer, addBatchCells, ensureGridLayer, getMap } from './map.js'
import { openPanel, closePanel, loadCityHistory } from './detail-panel.js'

let predictions = null
let gridData = null
let contourData = null
let currentView = 'national'
let nationalMode = 'contour'
let contourStream = null
let streamedPoints = []
let cityGrids = []

async function fetchJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error('HTTP '+r.status); return r.json() }

function handleCityClick(city) { openPanel(city); loadCityHistory(city.id) }
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

function startContourStream() {
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
