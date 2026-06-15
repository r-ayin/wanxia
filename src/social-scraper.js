/**
 * Weibo social scraper for sunset engagement data.
 *
 * Two modes:
 *  - Mobile API (no auth): recent posts, client-side date filter
 *  - Desktop search (WEIBO_COOKIE set): full historical date range
 *
 * Social score: raw = log10(postCount+1)*30 + log10(avgEng+1)*20, clamped 0-100
 */

import { storeSocialObservation } from './storage.js'

const WEIBO_COOKIE = process.env.WEIBO_COOKIE || ''
const XIAOHONGSHU_COOKIE = process.env.XIAOHONGSHU_COOKIE || ''
const FETCH_DELAY_MS = 1800
const MIN_POSTS = 2

// Cities with enough Weibo activity to yield meaningful signal
export const SOCIAL_CITY_IDS = [
  'beijing', 'shanghai', 'chongqing', 'tianjin',
  'hangzhou', 'nanjing', 'suzhou', 'ningbo', 'wenzhou',
  'guangzhou', 'shenzhen', 'zhuhai',
  'wuhan', 'changsha',
  'chengdu', 'kunming', 'guiyang', 'lijiang',
  'xian', 'lanzhou',
  'shenyang', 'dalian', 'harbin', 'changchun',
  'jinan', 'qingdao', 'zhengzhou',
  'fuzhou', 'xiamen',
  'nanning', 'guilin',
  'lhasa', 'dunhuang', 'urumqi',
]

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function timedFetch(url, headers) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 9000)
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res
  } finally {
    clearTimeout(t)
  }
}

// ── Mobile API (no auth) ──────────────────────────────────────────────────────

function parseMobileCards(cards) {
  let sampleCount = 0, totalEngagement = 0
  const rawPosts = []
  for (const card of cards) {
    const m = card.mblog
    if (!m) continue
    sampleCount++
    totalEngagement += (m.reposts_count || 0) * 2 + (m.comments_count || 0) + (m.attitudes_count || 0)
    rawPosts.push({ id: m.id, created_at: m.created_at, reposts: m.reposts_count, comments: m.comments_count, likes: m.attitudes_count })
  }
  return { sampleCount, totalEngagement, rawPosts }
}

async function fetchMobile(cityName, date) {
  const kw = encodeURIComponent(`${cityName}晚霞`)
  const cid = `100103type%3D1%26q%3D${kw}%26t%3D0`
  const url = `https://m.weibo.cn/api/container/getIndex?containerid=${cid}&page_type=searchall&page=1`
  const res = await timedFetch(url, {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    'Referer': 'https://m.weibo.cn/',
    'Accept': 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
  })
  const json = await res.json()
  const apiTotal = json?.data?.cardlistInfo?.total || 0
  const { sampleCount, totalEngagement, rawPosts } = parseMobileCards(json?.data?.cards || [])

  if (date) {
    const filtered = rawPosts.filter(p => {
      try { return new Date(p.created_at).toISOString().slice(0, 10) === date } catch { return false }
    })
    if (filtered.length > 0) {
      const eng = filtered.reduce((s, p) => s + (p.reposts || 0) * 2 + (p.comments || 0) + (p.likes || 0), 0)
      return { postCount: filtered.length, sampleCount: filtered.length, totalEngagement: eng, rawPosts: filtered, source: 'weibo-mobile-filtered' }
    }
    // No date-matched sample; approximate daily volume from total
    return { postCount: Math.max(0, Math.round(apiTotal / 30)), sampleCount, totalEngagement, rawPosts: [], source: 'weibo-mobile-est' }
  }
  return { postCount: apiTotal || sampleCount, sampleCount, totalEngagement, rawPosts, source: 'weibo-mobile' }
}

// ── Desktop search with cookie ────────────────────────────────────────────────

async function fetchDesktop(cityName, date) {
  const kw = encodeURIComponent(`${cityName}晚霞`)
  const url = `https://s.weibo.com/weibo?q=${kw}&scope=ori&suall=1&timescope=custom:${date}-0:${date}-23&Refer=g`
  const baseHeaders = {
    Cookie: WEIBO_COOKIE,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://s.weibo.com/',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  }

  const res = await timedFetch(url, { ...baseHeaders, Accept: 'text/html,application/xhtml+xml' })
  const html = await res.text()
  if (html.includes('passport.weibo.com') || html.includes('请登录')) {
    throw new Error('Weibo cookie expired — update WEIBO_COOKIE env var')
  }

  const uniqueMids = [...new Set([...html.matchAll(/mid=(\d{15,})/g)].map(m => m[1]))]
  const postCount = uniqueMids.length
  if (postCount === 0) return { postCount: 0, sampleCount: 0, totalEngagement: 0, rawPosts: [], source: 'weibo-desktop' }

  // Sample up to 3 mids via m.weibo.cn/api/statuses/show for engagement counts
  const mobileHeaders = {
    Cookie: WEIBO_COOKIE,
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    Referer: 'https://m.weibo.cn/',
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  }
  let totalEngagement = 0
  let sampled = 0
  for (const mid of uniqueMids.slice(0, 3)) {
    try {
      const r = await timedFetch(`https://m.weibo.cn/api/statuses/show?id=${mid}`, mobileHeaders)
      const j = await r.json()
      const d = j?.data || j
      if (d?.reposts_count != null || d?.attitudes_count != null) {
        // Cap per-post engagement at 5000 to exclude viral/promotional posts
        const eng = Math.min(5000,
          (d.reposts_count || 0) * 2 + (d.comments_count || 0) + (d.attitudes_count || 0))
        totalEngagement += eng
        sampled++
      }
    } catch { /* skip */ }
  }

  // Extrapolate engagement to all posts if we sampled some
  const extrapolated = sampled > 0 ? Math.round(totalEngagement / sampled * postCount) : 0
  return { postCount, sampleCount: sampled || postCount, totalEngagement: extrapolated, rawPosts: [], source: 'weibo-desktop' }
}


// ── Xiaohongshu scraper ────────────────────────────────────────────────────────

async function fetchXiaohongshu(cityName, date) {
  if (!XIAOHONGSHU_COOKIE) throw new Error('XIAOHONGSHU_COOKIE not set')

  const kw = encodeURIComponent(`${cityName}晚霞`)
  const url = `https://edith.xiaohongshu.com/api/sns/web/v1/search/notes?keyword=${kw}&page=1&page_size=20&sort=time_desc`
  const headers = {
    Cookie: XIAOHONGSHU_COOKIE,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.xiaohongshu.com/',
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://www.xiaohongshu.com',
    'X-S-Common': 'eyJzZW5kZXIiOiJ3ZWJfdjIiLCJjb250YWluZXIiOiJ3ZWIiLCJhY2Nlc3Nfc3ViX3R5cGUiOiJ3ZWIiLCJfY2xpZW50X3ZlcnNpb24iOiJmZWlzaHUiLCJfY2xpZW50X3R5cGUiOiJ3ZWIiLCJfZm10IjoianNvbiJ9',
  }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 9000)
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const items = json?.data?.items || json?.data?.notes || []
    if (!items.length) return { postCount: 0, totalEngagement: 0, sampleCount: 0, rawPosts: [] }

    let totalEngagement = 0
    let sampleCount = 0
    const rawPosts = []
    for (const item of items) {
      const note = item?.note_card || item || {}
      const id = note.id || note.note_id || ''
      const likedCount = note.liked_count || note.interact_info?.liked_count || 0
      const collectCount = note.collected_count || note.interact_info?.collected_count || 0
      const commentCount = note.comment_count || note.interact_info?.comment_count || 0
      const time = note.time || note.create_time || note.last_update_time || ''
      const eng = Math.min(5000, likedCount + collectCount * 2 + commentCount)
      totalEngagement += eng
      sampleCount++
      rawPosts.push({ id, likedCount, collectCount, commentCount, time })
    }
    return { postCount: items.length, totalEngagement, sampleCount, rawPosts }
  } finally {
    clearTimeout(t)
  }
}

// ── Score & public API ────────────────────────────────────────────────────────

export function computeSocialScore(postCount, totalEngagement, sampleCount) {
  if (!postCount || postCount < MIN_POSTS) return null
  const avgEng = sampleCount > 0 ? totalEngagement / sampleCount : 1
  return Math.min(100, Math.round(Math.log10(postCount + 1) * 30 + Math.log10(avgEng + 1) * 20))
}

export async function fetchCitySocial(city, date) {
  // Weibo
  let weiboData = null
  try {
    weiboData = (WEIBO_COOKIE && date) ? await fetchDesktop(city.name, date) : await fetchMobile(city.name, date)
  } catch (e) { weiboData = { postCount: 0, totalEngagement: 0, sampleCount: 0, rawPosts: [], error: e.message } }
  const weiboScore = computeSocialScore(weiboData.postCount, weiboData.totalEngagement, weiboData.sampleCount)

  // Xiaohongshu
  let xhsData = null
  let xhsScore = null
  if (XIAOHONGSHU_COOKIE) {
    try {
      xhsData = await fetchXiaohongshu(city.name, date)
      xhsScore = computeSocialScore(xhsData.postCount, xhsData.totalEngagement, xhsData.sampleCount)
    } catch (e) { xhsData = { postCount: 0, totalEngagement: 0, sampleCount: 0, rawPosts: [], error: e.message } }
  }

  // Fuse: take the max score (either source detecting interest counts)
  const finalScore = (weiboScore !== null && xhsScore !== null)
    ? Math.max(weiboScore, xhsScore)
    : (weiboScore !== null ? weiboScore : xhsScore)

  const sources = [weiboData?.source || 'weibo-none']
  if (xhsData) sources.push('xiaohongshu')
  if (xhsData?.error) sources.push('xhs-error')

  return {
    cityId: city.id, cityName: city.name, date,
    postCount: (weiboData?.postCount || 0) + (xhsData?.postCount || 0),
    totalEngagement: (weiboData?.totalEngagement || 0) + (xhsData?.totalEngagement || 0),
    socialScore: finalScore,
    source: sources.join('+'),
    weiboScore, xhsScore,
    weiboPosts: weiboData?.postCount || 0,
    xhsPosts: xhsData?.postCount || 0,
  }
}

export async function fetchAndStoreSocialData(cities, date, onProgress) {
  const targets = cities.filter(c => SOCIAL_CITY_IDS.includes(c.id))
  const results = []
  let done = 0

  for (const city of targets) {
    const result = await fetchCitySocial(city, date)
    results.push(result)
    done++

    if (result.socialScore !== null && !result.error) {
      try {
        storeSocialObservation(date, city.id, {
          postCount: result.postCount, totalEngagement: result.totalEngagement,
          socialScore: result.socialScore, source: result.source,
          rawData: result.rawPosts?.slice(0, 5),
        })
      } catch (e) { console.warn(`[social] store failed ${city.name}: ${e.message}`) }
    }

    if (onProgress) onProgress(done, targets.length, result)
    if (done < targets.length) await sleep(FETCH_DELAY_MS)
  }
  return results
}

export const hasCookie = () => Boolean(WEIBO_COOKIE)
export const hasXiaohongshuCookie = () => Boolean(XIAOHONGSHU_COOKIE)
export const cookieStatus = () => ({
  weibo: Boolean(WEIBO_COOKIE),
  xiaohongshu: Boolean(XIAOHONGSHU_COOKIE),
  dual: Boolean(WEIBO_COOKIE) && Boolean(XIAOHONGSHU_COOKIE),
})
