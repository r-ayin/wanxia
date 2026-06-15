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

export function renderDetailPanel(city) {
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

export async function loadCityHistory(cityId) {
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

export function openPanel(city) {
  const panel = document.getElementById('detail-panel')
  const content = document.getElementById('panel-content')
  content.innerHTML = renderDetailPanel(city)
  panel.classList.add('open')
}

export function closePanel() {
  document.getElementById('detail-panel').classList.remove('open')
}
