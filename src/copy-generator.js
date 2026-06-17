/**
 * 小红书文案生成器 — 风格 B（轻活泼，不矫揉造作）
 *
 * 两种模式：
 *   national — 全国播报（一篇）
 *   city     — 指定城市独立播报（一篇一城）
 *
 * 设计原则：
 *   - 用数据说话，不编造感受
 *   - 适度 emoji，不刷屏
 *   - 口语但不卖萌
 *   - 给读者行动指引（去哪看）
 */

// ── 城市地标映射 ────────────────────────────────────────────────────────────────
const SPOTS = {
  北京: ['故宫角楼', '颐和园', '景山万春亭'],
  上海: ['外滩', '浦东滨江', '徐汇滨江'],
  广州: ['珠江新城', '琶洲大桥', '白云山'],
  深圳: ['深圳湾公园', '前海石公园', '梧桐山'],
  杭州: ['西湖断桥', '雷峰塔', '宝石山'],
  成都: ['龙泉山', '锦城湖', '交子大道'],
  重庆: ['南山一棵树', '洪崖洞', '鹅岭公园'],
  武汉: ['长江大桥', '东湖凌波门', '汉口江滩'],
  南京: ['玄武湖', '中山陵', '鱼嘴湿地'],
  西安: ['城墙南门', '曲江池', '大雁塔'],
  长沙: ['橘子洲头', '岳麓山', '梅溪湖'],
  天津: ['天津之眼', '海河故道', '五大道'],
  苏州: ['金鸡湖', '太湖', '独墅湖'],
  青岛: ['信号山', '小麦岛', '栈桥'],
  厦门: ['演武大桥', '鼓浪屿', '海湾公园'],
  大连: ['星海湾', '金石滩', '东港'],
  昆明: ['滇池海埂', '长虫山', '翠湖'],
  贵阳: ['花果园', '黔灵山', '观山湖公园'],
  哈尔滨: ['松花江', '太阳岛', '中央大街'],
  沈阳: ['浑河晚渡', '丁香湖', '北陵公园'],
  济南: ['大明湖', '千佛山', '泉城广场'],
  郑州: ['大玉米', '龙子湖', '黄河滩'],
  福州: ['鼓山', '闽江之心', '西湖公园'],
  南宁: ['青秀山', '南湖', '邕江边'],
  南昌: ['滕王阁', '赣江', '艾溪湖'],
  合肥: ['天鹅湖', '巢湖', '大蜀山'],
  兰州: ['白塔山', '黄河边', '中山桥'],
  呼和浩特: ['大召', '如意河', '敕勒川公园'],
  乌鲁木齐: ['红山公园', '南山', '红光山'],
  拉萨: ['布达拉宫广场', '药王山', '拉鲁湿地'],
  西宁: ['南山公园', '湟水河', '人民公园'],
  银川: ['览山公园', '贺兰山', '阅海'],
  海口: ['万绿园', '假日海滩', '世纪大桥'],
  三亚: ['椰梦长廊', '鹿回头', '凤凰岭'],
}

function getSpots(cityName) {
  return SPOTS[cityName] || []
}

// ── 文案组件 ──────────────────────────────────────────────────────────────────

function colorDescription(hex, name, seed = 0) {
  // ── 颜色叙事变体库（每色 3 种表达，基于 seed 轮换）──
  const variants = {
    '#DC143C': [
      '层层叠叠的红，烧得比较透的那种',
      '浓烈的绯红色，像油画颜料泼在天上',
      '红得很正，不带杂色，今天属于高饱和输出',
    ],
    '#FF4500': [
      '偏橙的红，像橘子味晚霞',
      '橙红调，不是那种艳红，偏暖偏柔',
      '火烧云的那种橙红，层次感很丰富',
    ],
    '#FF8C00': [
      '偏金偏橘，暖色调，比较温柔',
      '橙金色，不像盛夏那么烈，温吞但持久',
      '落日熔金那种色调，自带滤镜',
    ],
    '#FA8072': [
      '偏粉的淡红，饱和度不高但舒服',
      '淡粉红，雾蒙蒙的柔光感',
      '浅浅的鲑鱼粉，不是浓艳挂，清新路线',
    ],
    '#FFD700': [
      '金黄色，不会太炸，温柔挂',
      '金色调，像被暖光灯打了一层',
      '偏金，不是那种刺眼的亮，是软软的金',
    ],
    '#DDA0DD': [
      '淡紫色晚霞，比较少见',
      '紫调，不是常见配色，今天有点特别',
      '偏紫偏粉，比较罕见的那种天色',
    ],
    '#808080': [
      '今天云况比较复杂，颜色不好判断',
      '灰色主调，云层比较厚，颜色被压住了',
      '云多，天色偏灰，但也可能有意外的层次',
    ],
  }

  const pool = variants[hex]
  if (pool) {
    const idx = Math.abs(seed) % pool.length
    return pool[idx]
  }

  // 回退：基于色名
  if (name.includes('红')) {
    const reds = ['红色系晚霞', '偏红的调子', '暖红色调']
    return reds[Math.abs(seed) % reds.length]
  }
  if (name.includes('橙')) {
    const oranges = ['橙色调晚霞', '橘色系', '偏橘偏暖']
    return oranges[Math.abs(seed) % oranges.length]
  }
  if (name.includes('金')) {
    const golds = ['金色系晚霞', '暖金调', '金黄色泽']
    return golds[Math.abs(seed) % golds.length]
  }
  if (name.includes('紫')) {
    const purples = ['紫色调晚霞', '偏紫的色调', '紫霞']
    return purples[Math.abs(seed) % purples.length]
  }
  if (name.includes('灰')) {
    const grays = ['条件一般，不抱太高期待', '灰色调，顺其自然', '云量偏多，颜色被压制']
    return grays[Math.abs(seed) % grays.length]
  }
  return '天色值得期待'
}

// ── 趋势感知：日环比 ─────────────────────────────────────────────────────────
function trendNarrative(city, yesterdayCity) {
  if (!yesterdayCity || yesterdayCity.score == null) return ''

  const delta = city.score - yesterdayCity.score
  const todayTier = city.tierCn || ''
  const yesterdayTier = yesterdayCity.tierCn || ''

  // 等级跃升
  if (todayTier === '极佳' && yesterdayTier !== '极佳') {
    return `比昨天升了一档，今天值得出门。`
  }
  // 大幅提升
  if (delta >= 15) {
    return `比昨天高了${delta}分，明显好转。`
  }
  // 小幅提升
  if (delta >= 5) {
    return `比昨天好了一点（+${delta}），可以期待。`
  }
  // 连续高位
  if (city.score >= 80 && yesterdayCity.score >= 80) {
    return `连续两天高分，最近天气给力。`
  }
  // 持平
  if (Math.abs(delta) < 5) {
    return `和昨天差不多，保持稳定。`
  }
  // 下降但还行
  if (delta <= -5 && city.score >= 65) {
    return `比昨天低了${Math.abs(delta)}分，但仍有看头。`
  }
  // 大幅下降
  if (delta <= -15) {
    return `比昨天降了不少，且看且珍惜。`
  }

  return ''
}

// ── 模板轮换：3 种 intro 风格 ──────────────────────────────────────────────────
function introTemplate(variant, city, score, tier, comment) {
  const date = new Date()
  const dayOfMonth = date.getDate()

  // 基于日期 + 城市名字符码和选择模板（同城同日一致，跨城跨日变化）
  const charSum = [...(city.name || '')].reduce((s, c) => s + c.charCodeAt(0), 0)
  const seed = dayOfMonth * 31 + charSum
  const t = seed % 3

  switch (t) {
    case 0:
      // 风格A：直接行动号召
      return `今天${city.name}${comment}。`
    case 1:
      // 风格B：感官描述开场
      if (score >= 75) {
        return `${city.name}今晚的天空值得抬头看一眼——`
      }
      return `${city.name}今晚天色${comment === '随缘出门' ? '一般' : '尚可'}——`
    case 2:
      // 风格C：简洁数据开场
      return `${score}分·${tier || '--'} | ${city.name}`
    default:
      return `今天${city.name}${comment}。`
  }
}

function scoreEmoji(score) {
  if (score >= 85) return '🔥'
  if (score >= 75) return '🌅'
  if (score >= 65) return '🌇'
  return '☁️'
}

function scoreComment(score) {
  if (score >= 85) return '值得出门蹲'
  if (score >= 75) return '大概率能看到'
  if (score >= 65) return '看运气，可以一试'
  if (score >= 50) return '随缘出门'
  return '今晚不如在家'
}

function tierComment(tierCn, score) {
  if (tierCn === '极佳') return score >= 85 ? '今天很可能是大烧' : '品质不错'
  if (tierCn === '好') return '不出意外能看到'
  return '看缘分'
}

function subScoreNarrative(subs) {
  // Pick 1-2 most notable sub-scores and narrate them naturally
  const parts = []
  if (subs.highCloud >= 80) parts.push('高云条件好')
  if (subs.highCloud < 30) parts.push('高云偏少')
  if (subs.humidity >= 80) parts.push('湿度够，颜色会比较透')
  if (subs.aerosol >= 80) parts.push('气溶胶条件不错')
  if (subs.visibility >= 70) parts.push('能见度高，拍出来清楚')
  if (subs.verticalVelocity >= 70) parts.push('大气垂直运动有利')
  return parts.slice(0, 2).join('，') || '综合条件尚可'
}

function formatSunset(isoStr) {
  try {
    const d = new Date(isoStr)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  } catch { return isoStr?.slice(11, 16) || '未知' }
}

// ── 标签生成 ──────────────────────────────────────────────────────────────────

function nationalHashtags() {
  return '#晚霞预报 #一起看晚霞 #日落收集计划 #今日晚霞'
}

function cityHashtags(cityName) {
  const base = '#晚霞预报 #一起看晚霞'
  return `${base} #${cityName}晚霞 #${cityName}拍照`
}

// ── 全国播报 ─────────────────────────────────────────────────────────────────

export function generateNationalCopy(data) {
  const { summary, cities } = data
  const top5 = (cities || [])
    .filter(c => c.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  const great = summary.tierDistribution?.Great || 0
  const good = summary.tierDistribution?.Good || 0
  const poor = summary.tierDistribution?.Poor || 0

  // Headline
  let headline = ''
  if (great >= 10) {
    headline = `${great} 个城市今晚很可能烧起来 🔥`
  } else if (great >= 5) {
    headline = `今晚 ${great} 城极佳，挑个地方出门吧`
  } else if (good >= 30) {
    headline = `大部分城市能看到，品质中上`
  } else {
    headline = `今天整体一般，不用特意跑`
  }

  // Body — top cities
  let topLines = ''
  for (const c of top5) {
    const emoji = scoreEmoji(c.score)
    const time = formatSunset(c.sunsetTime)
    topLines += `${emoji} ${c.name} ${c.score} · ${c.dominantColor?.name || ''} · ${time}\n`
  }

  // Regional quick take
  const westernCities = top5.filter(c =>
    ['吐鲁番', '哈密', '银川', '兰州', '西宁', '乌鲁木齐', '拉萨', '西安'].includes(c.name)
  )
  let westernNote = ''
  if (westernCities.length >= 3) {
    westernNote = `\n西部今晚很稳——${westernCities.map(c => c.name).join('、')}全在85+。新疆的日落时间在9点半以后，下班慢悠悠走过去都够。`
  }

  // Bad region warning
  const southBad = (cities || []).filter(c =>
    ['广州', '深圳', '南宁', '海口', '三亚', '福州', '厦门'].includes(c.name) && c.tier === 'Fair'
  )
  let southNote = ''
  if (southBad.length >= 2) {
    southNote = `\n⚠️ 华南云量偏多，${southBad.map(c => c.name).join('、')}今晚不建议特意跑。`
  }

  const body = [
    headline,
    '',
    topLines.trim(),
    westernNote,
    southNote,
    '',
    `📊 全国 ${cities.length} 城：极佳 ${great} · 好 ${good} · 翻车 ${poor}`,
  ].filter(Boolean).join('\n')

  return {
    title: `📸 今日晚霞地图 · ${data.date?.slice(5) || ''}`,
    body: body.trim(),
    hashtags: nationalHashtags(),
  }
}

// ── 城市独立播报 ──────────────────────────────────────────────────────────────

export function generateCityCopy(city, date, yesterdayCity) {
  const score = city.score || 0
  const tier = city.tierCn || ''
  const color = city.dominantColor || {}
  const subs = city.subScores || {}
  const time = formatSunset(city.sunsetTime)
  const spots = getSpots(city.name)
  const emoji = scoreEmoji(score)
  const comment = scoreComment(score)

  // 种子：日期+城市名哈希 → 同一城市每天变，不同城市同天不同
  const seed = (date || '').length + (city.name || '').length + score

  // Title: city name + score hook
  const title = `${emoji} ${city.name}晚霞 · ${score}分 ${tier}`

  // Color narrative with variation
  const colorNarr = colorDescription(color.hex, color.name, seed)

  // Trend awareness
  const trend = trendNarrative(city, yesterdayCity)

  // Varied intro
  const intro = introTemplate(null, city, score, tier, comment)

  // Sub-score narrative
  const subNarr = subScoreNarrative(subs)

  // Build body with optional trend
  const body = [
    intro,
    '',
    `${emoji} ${score}分 · ${tier}`,
    `🎨 预测色：${color.name}（${colorNarr}）`,
    `🕐 日落约 ${time}`,
    '',
    subNarr ? `💡 ${subNarr}。` : '',
    trend ? `📈 ${trend}` : '',
    spots.length ? `📍 推荐蹲点：${spots.slice(0, 3).join('、')}` : '',
  ].filter(Boolean).join('\n')

  const hashtags = cityHashtags(city.name)

  return { title, body: body.trim(), hashtags }
}

// ── 一线城市列表（用于逐城生成）─────────────────────────────────────────────────

export const TIER1_CITY_IDS = [
  'beijing', 'shanghai', 'guangzhou', 'shenzhen',
  'hangzhou', 'chengdu', 'chongqing', 'wuhan',
  'nanjing', 'xian', 'changsha', 'tianjin',
  'suzhou', 'qingdao', 'xiamen', 'dalian',
]

// ── 批量生成 ──────────────────────────────────────────────────────────────────

export function generateAll(data, yesterdayData) {
  const cities = data.cities || []
  const yesterdayCities = yesterdayData?.cities || []
  const national = generateNationalCopy(data)

  const cityPosts = TIER1_CITY_IDS
    .map(id => {
      const c = cities.find(c => c.id === id)
      if (!c || c.score == null || c.score < 50) return null  // 只发 ≥50 分的城市
      const yc = yesterdayCities.find(y => y.id === id)
      return generateCityCopy(c, data.date, yc)
    })
    .filter(Boolean)

  return { national, cityPosts }
}
