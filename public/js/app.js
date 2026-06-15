import { initMap, updateMarkers, updateHeatmap, renderGridHeatmap, renderGridCells, renderContourRegions, restoreMarkers, clearGridLayer, clearContourLayer, addBatchCells, ensureGridLayer, getMap } from './map.js'
import { openPanel, closePanel, loadCityHistory } from './detail-panel.js'

let predictions = null
let gridData = null
let contourData = null
let currentView = 'national'
let nationalMode = 'contour'
let gridDisplayMode = 'heatmap'
let contourStream = null
let streamedPoints = []

function tierColor(tier) {
  return { Great: '#ef4444', Good: '#f97316', Fair: '#f59e0b', Poor: '#6b7280' }[tier] || '#6b7280'
}

async function fetchPredictions() {
  const res = await fetch('/api/predictions')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function fetchGridData() {
  const res = await fetch('/api/grid/hangzhou')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function updateSummary(data) {
  const bar = document.getElementById('summary-bar')
  const s = data.summary
  if (!s) return

  const best = s.bestCity
  bar.innerHTML = `
    <span class="summary-stat">均分 <span class="value">${s.averageScore}</span></span>
    <span class="summary-stat">极佳 <span class="value" style="color:#ef4444">${s.tierDistribution.Great}</span></span>
    <span class="summary-stat">好 <span class="value" style="color:#f97316">${s.tierDistribution.Good}</span></span>
    <span class="summary-stat">一般 <span class="value" style="color:#f59e0b">${s.tierDistribution.Fair}</span></span>
    ${best ? `<span class="summary-stat">最佳 <span class="value" style="color:#ef4444">${best.name} ${best.score}分</span></span>` : ''}
  `
}

function updateGridSummary(data) {
  const bar = document.getElementById('summary-bar')
  const pts = data.points
  if (!pts || !pts.length) return
  const scores = pts.map(p => p.score)
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
  const great = pts.filter(p => p.tier === 'Great').length
  const good = pts.filter(p => p.tier === 'Good').length
  const best = pts.reduce((a, b) => a.score > b.score ? a : b)
  bar.innerHTML = `
    <span class="summary-stat">网格均分 <span class="value">${avg}</span></span>
    <span class="summary-stat">极佳 <span class="value" style="color:#ef4444">${great}</span></span>
    <span class="summary-stat">好 <span class="value" style="color:#f97316">${good}</span></span>
    <span class="summary-stat">最佳 <span class="value" style="color:#ef4444">${best.score}分</span></span>
    <span class="summary-stat">网格 <span class="value">${pts.length}点</span></span>
  `
}

function updateContourSummary(summary, pointCount) {
  const bar = document.getElementById('summary-bar')
  if (!summary) return
  bar.innerHTML = `
    <span class="summary-stat">区域均分 <span class="value">${summary.avgScore}</span></span>
    <span class="summary-stat">极佳 <span class="value" style="color:#ef4444">${summary.greatPct}%</span></span>
    <span class="summary-stat">好 <span class="value" style="color:#f97316">${summary.goodPct}%</span></span>
    <span class="summary-stat">一般 <span class="value" style="color:#f59e0b">${summary.fairPct}%</span></span>
    <span class="summary-stat">网格 <span class="value">${pointCount}点</span></span>
  `
}

function updateProgress(batch, total) {
  const el = document.getElementById('update-time')
  el.textContent = `加载区域数据 (${batch}/${total})...`
  el.style.color = '#ffa07a'
}

function updateTime(data) {
  const el = document.getElementById('update-time')
  el.style.color = ''
  if (data.generatedAt) {
    const d = new Date(data.generatedAt)
    el.textContent = `更新于 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    if (data.stale) el.textContent += ' (旧数据)'
  }
}

function hideLoading() {
  document.getElementById('loading').classList.add('hidden')
}

function showLoading(msg) {
  const loading = document.getElementById('loading')
  loading.classList.remove('hidden')
  loading.querySelector('p').textContent = msg
  loading.querySelector('.loading-spinner').style.display = ''
}

function showError(msg) {
  const loading = document.getElementById('loading')
  loading.querySelector('p').textContent = msg
  loading.querySelector('.loading-spinner').style.display = 'none'
}

function handleCityClick(city) {
  openPanel(city)
  loadCityHistory(city.id)
}

function setActiveMode(mode) {
  document.querySelectorAll('#view-modes .view-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode)
  })
}

function stopContourStream() {
  if (contourStream) {
    contourStream.close()
    contourStream = null
  }
}

function startContourStream() {
  stopContourStream()

  if (contourData) {
    renderContourRegions(contourData.contours, predictions, handleCityClick, contourData.points)
    updateContourSummary(contourData.summary, contourData.pointCount)
    updateTime(contourData)
    return
  }

  clearGridLayer()
  if (predictions) {
    const map = getMap()
    if (!map.hasLayer(ensureGridLayer())) {
      ensureGridLayer()
    }
    updateMarkers(predictions, handleCityClick)
  }

  contourStream = new EventSource('/api/contour/stream')
  streamedPoints = []

  contourStream.onmessage = (e) => {
    const data = JSON.parse(e.data)

    if (data.type === 'batch') {
      if (currentView !== 'national' || nationalMode !== 'contour') {
        stopContourStream()
        return
      }
      streamedPoints.push(...data.points)
      addBatchCells(data.points, data.step)
      updateProgress(data.batch, data.total)
    } else if (data.type === 'complete') {
      const pts = data.points || streamedPoints
      contourData = { contours: data.contours, summary: data.summary, pointCount: data.pointCount, points: pts, generatedAt: new Date().toISOString() }
      renderContourRegions(data.contours, predictions, handleCityClick, pts)
      updateContourSummary(data.summary, data.pointCount)
      const el = document.getElementById('update-time')
      el.style.color = ''
      el.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
      stopContourStream()
    } else if (data.type === 'error') {
      const el = document.getElementById('update-time')
      el.style.color = '#ef4444'
      el.textContent = `区域加载失败: ${data.message}`
      stopContourStream()
    }
  }

  contourStream.onerror = () => {
    stopContourStream()
  }
}

async function loadNationalData() {
  try {
    const data = await fetchPredictions()
    predictions = data.cities

    if (nationalMode === 'contour') {
      restoreMarkers(predictions, handleCityClick)
      hideLoading()
      updateSummary(data)
      updateTime(data)
      startContourStream()
    } else if (nationalMode === 'heatmap') {
      clearGridLayer()
      updateHeatmap(predictions)
      updateSummary(data)
      updateTime(data)
      hideLoading()
    } else {
      restoreMarkers(predictions, handleCityClick)
      updateSummary(data)
      updateTime(data)
      hideLoading()
    }
  } catch (err) {
    console.error('Failed to load predictions:', err)
    showError(`加载失败: ${err.message}，请刷新重试`)
  }
}

async function loadGridData() {
  try {
    const data = await fetchGridData()
    gridData = data.points
    renderGridHeatmap(data.points)
    gridDisplayMode = 'heatmap'
    updateGridSummary(data)
    updateTime(data)
    hideLoading()
  } catch (err) {
    console.error('Failed to load grid:', err)
    showError(`网格数据加载失败: ${err.message}`)
  }
}

function switchToNational() {
  currentView = 'national'
  document.getElementById('btn-national').classList.remove('view-btn-inactive')
  document.getElementById('btn-hangzhou').classList.add('view-btn-inactive')
  document.getElementById('view-modes').style.display = ''
  setActiveMode(nationalMode)
  closePanel()
  const map = getMap()
  if (map) {
    clearGridLayer()
    map.setView([35.0, 105.0], 4)
  }
  loadNationalData()
}

function switchToHangzhou() {
  currentView = 'hangzhou'
  stopContourStream()
  document.getElementById('btn-hangzhou').classList.remove('view-btn-inactive')
  document.getElementById('btn-national').classList.add('view-btn-inactive')
  document.getElementById('view-modes').style.display = 'none'
  closePanel()
  const map = getMap()
  if (map) {
    clearGridLayer()
    map.setView([30.0, 120.2], 8)
  }
  showLoading('正在加载杭州区域网格数据...')
  loadGridData()
}

document.addEventListener('DOMContentLoaded', () => {
  initMap('map')
  loadNationalData()

  document.getElementById('btn-national').addEventListener('click', () => {
    if (currentView !== 'national') switchToNational()
  })

  document.getElementById('btn-hangzhou').addEventListener('click', () => {
    if (currentView !== 'hangzhou') switchToHangzhou()
  })

  document.getElementById('refresh-btn').addEventListener('click', () => {
    stopContourStream()
    if (currentView === 'hangzhou') {
      showLoading('正在刷新杭州区域数据...')
      loadGridData()
    } else {
      contourData = null
      loadNationalData()
    }
  })

  document.getElementById('panel-close').addEventListener('click', closePanel)

  document.getElementById('view-modes').addEventListener('click', async (e) => {
    const btn = e.target.closest('.view-mode-btn')
    if (!btn || currentView !== 'national') return
    const mode = btn.dataset.mode
    if (mode === nationalMode) return

    stopContourStream()
    nationalMode = mode
    setActiveMode(mode)

    if (mode === 'markers' && predictions) {
      restoreMarkers(predictions, handleCityClick)
    } else if (mode === 'heatmap' && predictions) {
      clearGridLayer()
      updateHeatmap(predictions)
    } else if (mode === 'contour') {
      startContourStream()
    }
  })

  setInterval(() => {
    if (currentView === 'hangzhou') loadGridData()
    else if (nationalMode !== 'contour') loadNationalData()
  }, 5 * 60 * 1000)
})
