/**
 * 小红书文案生成器 — v3.0 爆款方法论版
 *
 * 两种模式：
 *   national — 全国播报（一篇）
 *   city     — 指定城市独立播报（一篇一城）
 *
 * v3.0 爆款优化（基于对标 @中国朝晚霞爱好者 等账号研究）：
 *   - 标题公式：数字+情绪+紧迫感，前18字含2个核心关键词
 *   - 正文三层结构：认知锚点→过程验证→结果确证
 *   - 感官描述：不只是分数，写"从橙黄渐变到深紫"
 *   - 互动钩子：每篇结尾引导评论（CES评分评论权重×4）
 *   - 标签精简：1热门 + 4精准（不堆砌）
 *   - 倒计时感：加入"还有X小时日落"
 *   - POI位置：每个城市挂位置标签（提升70%曝光）
 */

// ── 城市地标映射 ────────────────────────────────────────────────────────────────
const SPOTS = {
  北京:    { best: ['故宫角楼', '颐和园', '景山万春亭'],   quick: ['北海公园', '奥森南园'] },
  上海:    { best: ['外滩', '浦东滨江', '徐汇滨江'],       quick: ['世纪公园', '静安公园'] },
  广州:    { best: ['珠江新城', '琶洲大桥', '白云山'],     quick: ['二沙岛', '花城广场'] },
  深圳:    { best: ['深圳湾公园', '前海石公园', '梧桐山'], quick: ['人才公园', '莲花山'] },
  杭州:    { best: ['西湖断桥', '雷峰塔', '宝石山'],       quick: ['城西银泰天台', '钱塘江边'] },
  成都:    { best: ['龙泉山', '锦城湖', '交子大道'],       quick: ['太古里天台', '浣花溪'] },
  重庆:    { best: ['南山一棵树', '洪崖洞', '鹅岭公园'],   quick: ['南滨路', '江北嘴'] },
  武汉:    { best: ['长江大桥', '东湖凌波门', '汉口江滩'], quick: ['沙湖公园', '楚河汉街'] },
  南京:    { best: ['玄武湖', '中山陵', '鱼嘴湿地'],       quick: ['颐和路', '石头城'] },
  西安:    { best: ['城墙南门', '曲江池', '大雁塔'],       quick: ['大唐芙蓉园', '兴庆宫'] },
  长沙:    { best: ['橘子洲头', '岳麓山', '梅溪湖'],       quick: ['湘江边', '月湖'] },
  天津:    { best: ['天津之眼', '海河故道', '五大道'],     quick: ['水上公园', '津湾广场'] },
  苏州:    { best: ['金鸡湖', '太湖', '独墅湖'],           quick: ['平江路', '山塘街'] },
  青岛:    { best: ['信号山', '小麦岛', '栈桥'],           quick: ['五四广场', '太平角'] },
  厦门:    { best: ['演武大桥', '鼓浪屿', '海湾公园'],     quick: ['白城沙滩', '环岛路'] },
  大连:    { best: ['星海湾', '金石滩', '东港'],           quick: ['付家庄', '黑石礁'] },
  昆明:    { best: ['滇池海埂', '长虫山', '翠湖'],         quick: ['大观楼', '西山脚下'] },
  贵阳:    { best: ['花果园', '黔灵山', '观山湖公园'],     quick: ['甲秀楼', '南明河'] },
  哈尔滨:  { best: ['松花江', '太阳岛', '中央大街'],       quick: ['斯大林公园', '群力'] },
  沈阳:    { best: ['浑河晚渡', '丁香湖', '北陵公园'],     quick: ['沈水湾', '万泉公园'] },
  济南:    { best: ['大明湖', '千佛山', '泉城广场'],       quick: ['趵突泉', '黑虎泉'] },
  郑州:    { best: ['大玉米', '龙子湖', '黄河滩'],         quick: ['北龙湖', '碧沙岗'] },
  福州:    { best: ['鼓山', '闽江之心', '西湖公园'],       quick: ['光明港', '温泉公园'] },
  南宁:    { best: ['青秀山', '南湖', '邕江边'],           quick: ['人民公园', '民歌湖'] },
  南昌:    { best: ['滕王阁', '赣江', '艾溪湖'],           quick: ['八一公园', '瑶湖'] },
  合肥:    { best: ['天鹅湖', '巢湖', '大蜀山'],           quick: ['包公园', '环城公园'] },
  兰州:    { best: ['白塔山', '黄河边', '中山桥'],         quick: ['兰州中心天台', '银滩'] },
  呼和浩特:{ best: ['大召', '如意河', '敕勒川公园'],       quick: ['青城公园', '新华广场'] },
  乌鲁木齐:{ best: ['红山公园', '南山', '红光山'],         quick: ['人民公园', '水磨沟'] },
  拉萨:    { best: ['布达拉宫广场', '药王山', '拉鲁湿地'], quick: ['宗角禄康', '仙足岛'] },
  西宁:    { best: ['南山公园', '湟水河', '人民公园'],     quick: ['中心广场', '海湖'] },
  银川:    { best: ['览山公园', '贺兰山', '阅海'],         quick: ['中山公园', '宝湖'] },
  海口:    { best: ['万绿园', '假日海滩', '世纪大桥'],     quick: ['白沙门', '金牛岭'] },
  三亚:    { best: ['椰梦长廊', '鹿回头', '凤凰岭'],       quick: ['大东海', '三亚湾'] },
  // 🔴 v3.1 新增
  宁波:    { best: ['老外滩', '东钱湖', '月湖'],           quick: ['三江口', '鄞州公园'] },
  无锡:    { best: ['太湖鼋头渚', '蠡湖', '惠山'],         quick: ['长广溪', '金城湾'] },
  常州:    { best: ['滆湖', '西太湖', '天宁宝塔'],         quick: ['红梅公园', '青枫公园'] },
  佛山:    { best: ['千灯湖', '东平河', '西樵山'],         quick: ['亚洲艺术公园', '文华公园'] },
  东莞:    { best: ['松山湖', '同沙水库', '旗峰山'],       quick: ['中心广场', '水濂山'] },
  珠海:    { best: ['情侣路', '野狸岛', '横琴'],           quick: ['海滨公园', '板樟山'] },
  太原:    { best: ['汾河公园', '晋阳湖', '双塔寺'],       quick: ['迎泽公园', '长风商务区'] },
  石家庄:  { best: ['滹沱河', '世纪公园', '龙泉湖'],       quick: ['长安公园', '水上公园'] },
  长春:    { best: ['净月潭', '南湖公园', '伊通河'],       quick: ['长春公园', '文化广场'] },
  洛阳:    { best: ['龙门石窟', '洛河', '应天门'],         quick: ['洛浦公园', '隋唐遗址'] },
  桂林:    { best: ['漓江', '两江四湖', '象鼻山'],         quick: ['七星公园', '榕湖'] },
  大理:    { best: ['洱海环海路', '苍山', '双廊'],         quick: ['大理古城', '龙龛码头'] },
}

function getSpots(cityName, score) {
  const s = SPOTS[cityName]
  if (!s) return []
  // 高分（≥80）→ best spots，低分 → quick spots（方便撤退）
  if (score >= 80) return s.best
  if (score >= 65) return [...s.best.slice(0, 1), ...s.quick.slice(0, 1)]
  return s.quick
}

// ── 季节感知 ────────────────────────────────────────────────────────────────────
function getSeason() {
  const m = new Date().getMonth() + 1
  if (m >= 6 && m <= 8) return 'summer'
  if (m >= 9 && m <= 10) return 'autumn'
  if (m >= 12 || m <= 2) return 'winter'
  return 'spring'
}

// ── 🔴 v3.1 节气 + 节假日感知 ─────────────────────────────────────────────────────
const SOLAR_TERMS = {
  '0105': '小寒', '0120': '大寒', '0204': '立春', '0219': '雨水',
  '0305': '惊蛰', '0320': '春分', '0404': '清明', '0419': '谷雨',
  '0505': '立夏', '0520': '小满', '0605': '芒种', '0621': '夏至',
  '0706': '小暑', '0722': '大暑', '0807': '立秋', '0822': '处暑',
  '0907': '白露', '0922': '秋分', '1008': '寒露', '1023': '霜降',
  '1107': '立冬', '1122': '小雪', '1207': '大雪', '1222': '冬至',
}
const HOLIDAYS = [
  { match: d => d.getMonth()+1===1&&d.getDate()===1, name: '元旦', vibe: '新年第一场晚霞，开个好头', tag: '#元旦晚霞' },
  { match: d => d.getMonth()+1===5&&d.getDate()<=3, name: '五一', vibe: '假期配晚霞，不用上班的日子真好看', tag: '#五一假期' },
  { match: d => d.getMonth()+1===6&&d.getDate()===1, name: '儿童节', vibe: '不管几岁，看晚霞都是最开心的事', tag: '#六一' },
  { match: d => d.getMonth()+1===10&&d.getDate()<=7, name: '国庆', vibe: '黄金周配火烧云', tag: '#国庆出游' },
  { match: d => d.getMonth()+1===2&&d.getDate()===14, name: '情人节', vibe: '陪TA看场晚霞，比什么礼物都浪漫', tag: '#情人节晚霞' },
  { match: d => d.getMonth()+1===7&&d.getDate()===7, name: '七夕', vibe: '七夕晚上的霞光，比任何烟花都好看', tag: '#七夕晚霞' },
]

function getDateContext() {
  const now = new Date()
  const mmdd = `${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`
  const term = SOLAR_TERMS[mmdd]
  const holiday = HOLIDAYS.find(h => h.match(now))
  const contexts = []
  if (term) contexts.push({ hook: `今日${term}，适合看一场好晚霞`, vibe: `${term}时节的天空，颜色总是特别通透`, tag: `#${term}` })
  if (holiday) contexts.push(holiday)
  if (!contexts.length) {
    const wk = now.getDay()
    if (wk === 5) contexts.push({ hook: '周五了，下班去看晚霞吧', vibe: '周末前的晚霞最有仪式感', tag: '#周五晚霞' })
    else if (wk === 6 || wk === 0) contexts.push({ hook: '周末不赶时间，去看场晚霞吧', vibe: '周末的节奏，适合慢慢等一场日落', tag: '#周末晚霞' })
  }
  return contexts
}

// ── 🔴 v3.1 互动钩子轮换库（防重复）─────────────────────────────────────────────
const ENGAGEMENT_HOOKS = [
  '你那儿今天好看吗？拍到了发评论 📸',
  '你在哪个城市？看到的天空是什么颜色的？',
  '今天拍到晚霞的举手 🙋  发评论看看你拍的',
  '你们今天那儿能看到吗？评论区报个到',
  '今天的晚霞你打几分？评论区说说',
  '分享一下你拍的晚霞 🌇  好想看看不同城市的天空',
  '你今年看过最好看的一场晚霞是什么时候？',
  '有没有人跟我一样觉得今天的晚霞特别好看？',
  '下班路上拍到晚霞了吗？发来看看',
  '今晚的云烧起来了吗？你那儿呢',
]
let _hookIdx = 0
function rotatingHook() {
  return ENGAGEMENT_HOOKS[_hookIdx++ % ENGAGEMENT_HOOKS.length]
}

function seasonMood(season) {
  const moods = {
    summer: { adj: '炸裂', verb: '烧', feel: '夏天的晚霞是最有力量的那种，不藏着掖着' },
    autumn: { adj: '温柔', verb: '染', feel: '秋高气爽，天色干净，是看晚霞最好的季节' },
    winter: { adj: '暖调', verb: '晕', feel: '冬天晚霞不刺眼，是那种柔柔的暖色' },
    spring: { adj: '透亮', verb: '泼', feel: '春天空气湿润，颜色容易被水汽晕开，层次感更好' },
  }
  return moods[season] || moods.summer
}

// ── 颜色叙事变体库（v2.0 扩展版）──────────────────────────────────────────────────
const COLOR_VARIANTS = {
  '#DC143C': {
    summer: [
      '烧得很透的绯红，今天属于老天爷开了滤镜',
      '浓烈的火烧云红，像油画颜料泼在天上',
      '红得很正，不带杂色，今晚是大片级',
      '那种能上热搜的红色，不是天天有的',
      '深绯红，云被点燃了的感觉',
    ],
    winter: [
      '温柔的绯红色，不刺眼但很耐看',
      '淡绯红，像腮红轻轻扫了一层',
      '暖调的绯红，冬天里的一抹温度',
      '柔和的绯色，不像夏天那么烈',
    ],
    default: [
      '层层叠叠的红，烧得比较透的那种',
      '浓烈的绯红色，像油画颜料泼在天上',
      '红得很正，不带杂色，今天属于高饱和输出',
      '那种让人想拍照的红色',
      '绯红铺开，从浅到深很有层次',
    ],
  },
  '#FF4500': {
    summer: [
      '橙红调，像夏天橘子汽水洒在天上',
      '火焰般的橙红，热烈但不刺眼',
      '偏橘的红，饱和度拉满',
    ],
    winter: [
      '橘红里带点金，很温暖的颜色',
      '像壁炉里的火光，暖暖的橘红',
      '柔和的橙红调，不张扬',
    ],
    default: [
      '偏橙的红，像橘子味晚霞',
      '橙红调，不是那种艳红，偏暖偏柔',
      '火烧云的那种橙红，层次感很丰富',
      '橘红渐变，从浓到淡过渡得很好看',
      '暖暖的橘红，看着就舒服',
    ],
  },
  '#FF8C00': {
    summer: [
      '落日熔金色，自带高级滤镜',
      '金橘色，夏天的天空像被镀了一层',
    ],
    winter: [
      '淡淡金色，温柔不刺眼',
      '暖金调，冬天傍晚的一抹亮色',
    ],
    default: [
      '偏金偏橘，暖色调，比较温柔',
      '橙金色，不像盛夏那么烈，温吞但持久',
      '落日熔金那种色调，自带滤镜',
      '金橙色渐变，不浓不淡刚好',
      '温润的金橘色，看着很舒服',
    ],
  },
  '#FA8072': {
    default: [
      '浅浅的鲑鱼粉，不是浓艳挂，清新路线',
      '偏粉的淡红，雾蒙蒙的柔光感',
      '淡粉红，饱和度不高但很耐看',
      '温柔的三文鱼色，像被柔光镜处理过',
      '淡淡的粉色，适合不喜欢太浓烈的人',
    ],
  },
  '#FFD700': {
    default: [
      '软软的金色，像被暖光灯打了一层',
      '金黄色，不会太炸，温柔挂',
      '偏金，不是那种刺眼的亮，是软软的金',
      '柔和的金光，铺在天边很低调',
      '淡淡的暖金，看着就觉得很舒服',
    ],
  },
  '#DDA0DD': {
    default: [
      '淡紫色晚霞，今天有点特别',
      '紫调，不是常见配色，属于稀有款',
      '偏紫偏粉，比较罕见的那种天色',
      '浅紫霞光，手机很难拍但肉眼看很妙',
      '淡淡的紫色，今天的天色不太一样',
    ],
  },
  '#808080': {
    default: [
      '云层比较厚，颜色被压住了',
      '灰色主调，但说不定有惊喜',
      '云多天色偏灰，光线可能会从缝隙漏出来',
      '今天云况复杂，颜色不好判断——但也可能意外出片',
      '灰调为主，顺其自然吧，有时候这种天反而出大片',
    ],
  },
  // 新增颜色
  '#FF6347': {
    default: [
      '番茄红，比绯红更活泼一点',
      '明亮的番茄色，饱和度很高',
      '鲜艳的红，看着就很有生命力',
      '番茄红，不是暗红，是很亮的那种红',
    ],
  },
  '#FFA500': {
    default: [
      '标准橘色，不偏红不偏金，正经晚霞色',
      '橘色调，像是被水彩渲染上去的',
      '干净的橘色，渐变过渡很自然',
    ],
  },
  '#FFB6C1': {
    default: [
      '淡粉色，像少女的脸红',
      '浅浅的粉，很轻盈不厚重',
      '棉花糖粉，软软糯糯的颜色',
    ],
  },
}

function colorDescription(hex, name, seed = 0, season = 'spring') {
  const safeName = name || ''
  const pool = COLOR_VARIANTS[hex]
  if (pool) {
    const seasonal = pool[season] || pool.default
    const idx = Math.abs(seed) % seasonal.length
    return seasonal[idx]
  }

  // 回退：基于色名关键词匹配
  const fallbacks = {
    '红': ['红色系晚霞', '偏红的调子', '暖红色调', '今天走红色系路线'],
    '橙': ['橙色调晚霞', '橘色系', '偏橘偏暖', '橙色系，很正的晚霞色'],
    '金': ['金色系晚霞', '暖金调', '金黄色泽', '金色系，自带高级感'],
    '紫': ['紫色调晚霞', '偏紫的色调', '紫霞', '今天走紫色系，比较少见'],
    '灰': ['条件一般，不抱太高期待', '灰色调，顺其自然', '云量偏多，颜色被压制', '今天不强求，随缘'],
  }
  for (const [key, arr] of Object.entries(fallbacks)) {
    if (safeName.includes(key)) return arr[Math.abs(seed) % arr.length]
  }
  return '天色值得期待'
}

// ── 子分数叙事（人话版）─────────────────────────────────────────────────────────
function subScoreNarrative(subs) {
  const parts = []
  if (subs.highCloud >= 80) parts.push('高云条件好，光线容易被抓住')
  else if (subs.highCloud >= 50) parts.push('云量合适，有发挥空间')
  else if (subs.highCloud < 30) parts.push('高云偏少，可能会比较寡淡')

  if (subs.humidity >= 80) parts.push('湿度刚好，晚霞会更透亮')
  else if (subs.humidity >= 50) parts.push('空气不算太干，颜色应该能出来')

  if (subs.visibility >= 70) parts.push('能见度不错，拍照清晰度高')

  if (subs.aerosol >= 75) parts.push('空气质量好，不容易灰蒙蒙')

  return parts.slice(0, 2).join('。') || '综合条件尚可'
}

// ── 连续趋势感知 ────────────────────────────────────────────────────────────────
function trendNarrative(city, yesterdayCity, recentDays = null) {
  if (!yesterdayCity || yesterdayCity.score == null) return ''

  const delta = city.score - yesterdayCity.score
  const todayTier = city.tierCn || ''
  const yesterdayTier = yesterdayCity.tierCn || ''

  // 如果有多日数据，检测连续趋势
  if (recentDays && recentDays.length >= 3) {
    const scores = recentDays.map(d => d.score).filter(s => s != null)
    if (scores.length >= 3) {
      const recent = scores.slice(-3)
      const ascending = recent[0] < recent[1] && recent[1] < recent[2]
      const descending = recent[0] > recent[1] && recent[1] > recent[2]
      if (ascending) return `连续3天走高，最近天气太给面子了。`
      if (descending) return `连降3天，趁今天还行就出门吧。`
    }
    // 连续高分
    if (scores.slice(-3).every(s => s >= 80)) return `最近几天都很好，挑个人少的点去蹲。`
    if (scores.slice(-5).every(s => s >= 75)) return `这周天气很稳，每天都值得出门。`
  }

  // 日环比
  if (todayTier === '极佳' && yesterdayTier !== '极佳') return `比昨天升了一档，今天值得出门。`
  if (delta >= 15) return `比昨天高了${delta}分，明显好转。`
  if (delta >= 5) return `比昨天好了一点（+${delta}），可以期待。`
  if (city.score >= 80 && yesterdayCity.score >= 80) return `连续两天高分，最近天气给力。`
  if (Math.abs(delta) < 5) return `和昨天差不多，保持稳定。`
  if (delta <= -5 && city.score >= 65) return `比昨天低了${Math.abs(delta)}分，但仍有看头。`
  if (delta <= -15) return `比昨天降了不少，且看且珍惜。`

  return ''
}

// ── 天气简报 ────────────────────────────────────────────────────────────────────
function weatherBrief(city) {
  const parts = []
  if (city.temp != null) parts.push(`${city.temp}°C`)
  if (city.weatherDesc) parts.push(city.weatherDesc)
  if (city.humidity != null) parts.push(`湿度${city.humidity}%`)
  return parts.join(' · ') || ''
}

// ── 模板轮换（3种intro风格）─────────────────────────────────────────────────────
function introTemplate(city, score, tier, comment, season) {
  const date = new Date()
  const charSum = [...(city.name || '')].reduce((s, c) => s + c.charCodeAt(0), 0)
  const seed = date.getDate() * 31 + charSum
  const t = seed % 3

  switch (t) {
    case 0:
      return `今天${city.name}${comment}。`
    case 1:
      if (score >= 75) return `${city.name}今晚的天空值得抬头看一眼——`
      return `${city.name}今晚天色${comment === '随缘出门' ? '一般' : '尚可'}——`
    case 2:
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
  return '不建议特意出门'
}

// ── 诗意天气叙事 ──────────────────────────────────────────────────────────
function weatherNarrative(city) {
  const parts = []
  if (city.temp != null) {
    if (city.temp >= 35) {
      const opts = [`${city.temp}度的风裹着热浪，但越热的黄昏天空越干净`]
      parts.push(opts[0])
    } else if (city.temp >= 30) {
      const opts = [
        `${city.temp}度，空气里有夏天的味道——温热的、带着青草香的`,
        `体感${city.temp}度，刚好是晚霞喜欢的温度`,
      ]
      parts.push(opts[Math.abs(city.temp * 7) % opts.length])
    } else if (city.temp >= 25) {
      parts.push(`${city.temp}度，不冷不热，适合什么都不想、只是抬头看天`)
    } else {
      parts.push(`微凉的${city.temp}度，天空往往比热天更清澈`)
    }
  }
  if (city.weatherDesc) {
    const opts = city.weatherDesc.includes('晴') ? [
      '天是干净的蓝，等太阳一斜就会开始变色',
      '万里无云的日子，晚霞会直接铺满整个西边',
    ] : city.weatherDesc.includes('云') ? [
      '云是今天晚霞的主角——没有云，天空只是一张白纸',
      '云量刚好，不多不少，是晚霞最好的画布',
      '碎云像撕开的棉絮，落日会给它们镶上金边',
    ] : city.weatherDesc.includes('雨') ? [
      '雨水洗过的天空最干净，光线穿过湿漉漉的空气会折出更丰富的颜色',
      '雨刚停，空气里还挂着水珠，晚霞会把它们全染成橘色',
    ] : [city.weatherDesc]
    parts.push(opts[Math.abs((city.temp || 20) * 3) % opts.length])
  }
  if (city.humidity != null) {
    if (city.humidity >= 80) {
      const opts = ['空气是润的，颜色会在这样的湿度里被充分晕开', '水汽足，天空像一块浸了水的画布，颜色落上去会自己渲染']
      parts.push(opts[Math.abs(city.humidity * 13) % opts.length])
    } else if (city.humidity >= 50) {
      parts.push('不干不湿，水汽刚好够酿一场好看的晚霞')
    } else {
      parts.push('空气是干爽的，天会特别透——能一眼看到地平线的尽头')
    }
  }
  // 🔴 v3.1 — 科学加成：好条件的解释
  if (city.humidity >= 60 && city.humidity <= 85 && city.temp >= 25) {
    parts.push('湿度温度都在晚霞的舒适区——今天的天时地利都到位了')
  }
  return parts.join('。')
}

// ── v3.1 快速播报（一线城市一句话，适合多城汇总帖开头） ────────────────────
function quickLine(city, score) {
  const e = scoreEmoji(score)
  if (score >= 80) return `${e} ${city.name}${score}分 今天属于不用犹豫就出门的那种`
  if (score >= 65) return `${e} ${city.name}${score}分 有空就去，不亏`
  if (score >= 50) return `${e} ${city.name}${score}分 随缘，不强求`
  return `${e} ${city.name}${score}分 今天歇着吧，改天再追`
}

// ── 诗意感官片段（不依赖分数的自由联想） ──────────────────────────────────
function poeticSnippet(score, colorName, seed) {
  const highScore = [
    '今天的天空不是渐变——是一层层烧上去的，从淡金到橘红到深绯',
    '你知道那种站在路边仰头看了十分钟的感觉吗？今天就是',
    '云被点燃了。不是比喻，是真的看起来在燃烧',
    '如果晚霞有段位，今天属于不需要解释的那一档',
  ]
  const midScore = [
    '不算炸裂，但有种安静的好看——像打了柔光滤镜的傍晚',
    '淡淡的颜色铺在天上，不过分、不喧哗，但你会忍不住多看两眼',
    '温柔的一个晚上。天空在偷偷给自己上妆',
  ]
  const lowScore = [
    '天可能不够炸，但谁说只有火烧云才值得看呢',
    '有时候最意外的晚霞，就藏在最普通的天气里',
    '今晚别抱太高期待——但万一呢？天空的事谁说得准',
  ]
  const pool = score >= 80 ? highScore : score >= 65 ? midScore : lowScore
  return pool[Math.abs(seed) % pool.length]
}

// ── 诗意机位推荐 ──────────────────────────────────────────────────────────
function poeticSpots(spots, cityName, seed) {
  if (!spots.length) return ''
  const pref = [
    `如果想看得更尽兴，${spots.slice(0, 2).join('和')}都是${cityName}人私藏的追霞点`,
    `带上相机去${spots[0]}吧，那里的视野配得上今天的天空`,
    `${spots.slice(0, 2).join('、')}——${cityName}看晚霞最舒服的两个地方`,
  ]
  return pref[Math.abs(seed) % pref.length]
}

function formatSunset(isoStr) {
  try {
    const d = new Date(isoStr)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  } catch { return isoStr?.slice(11, 16) || '未知' }
}

// ── 倒计时感（v3.0 新增）─────────────────────────────────────────────────────────
function countdownHint(sunsetTime) {
  try {
    const now = new Date()
    const sunset = new Date(sunsetTime)
    if (isNaN(sunset.getTime())) return ''
    const diffMin = Math.floor((sunset - now) / 60000)
    if (diffMin < 0) return '已经日落了'
    if (diffMin < 30) return `还有不到半小时日落！`
    if (diffMin < 60) return `还有${diffMin}分钟日落，赶紧出门`
    if (diffMin < 180) return `还有${Math.floor(diffMin/60)}小时${diffMin%60}分钟日落`
    if (diffMin < 360) return `还有${Math.floor(diffMin/60)}小时日落`
    // 明天或更远
    if (diffMin < 1440) return `明天日落时间${formatSunset(sunsetTime)}`
    return `日落时间${formatSunset(sunsetTime)}`
  } catch { return '' }
}

// ── 感官描述词库（v3.0 新增）─────────────────────────────────────────────────────
function sensoryDescription(score, colorName) {
  const highScore = [
    '天空会从橙黄逐渐过渡到深紫，每一分钟都不一样',
    '先是金黄铺开，然后橘红一层一层叠上去，最后烧成深绯色',
    '颜色会从天顶的淡蓝、到中层的粉橘、再到地平线的浓烈赤红',
    '云会被染成多层颜色：上面还是白的，中间已经橘了，边缘在发金光',
  ]
  const midScore = [
    '天色从浅蓝过渡到粉橘，淡淡的，不会太浓烈',
    '云边被染了一层金边，整体氛围很温柔',
    '浅粉色和淡橘色交织，是那种手机也能拍出来的好看',
  ]
  const lowScore = [
    '天色可能偏灰，但运气好的话云缝里会漏出几缕暖光',
    '不保证能看到，但有时候这种天反而出人意料的好看',
    '别抱太大期待——但万一呢？',
  ]
  const arr = score >= 80 ? highScore : score >= 65 ? midScore : lowScore
  const seed = Math.abs((score * 7 + (colorName || '').length * 13) % arr.length)
  return arr[seed]
}

// ── 诗意互动（v3.3: 温情小故事 + 活泼语气） ───────────────────────────────────
function interactionHook(cityName) {
  const stories = [
    `上次有个${cityName}的朋友跟我说，她下班路上正好赶上火烧云，停在路边看了十分钟，回家还写了一首诗。你上次为晚霞停下来是什么时候？`,
    `记得有一年在${cityName}，看完晚霞后旁边不认识的阿姨跟我说"小姑娘，你今天运气真好"。有时候陌生人的一句话，让一整天的疲惫都散了。你遇到过这样的时刻吗？`,
    `朋友圈里有个${cityName}的姑娘，每个周末都去不同的公园追霞。她说这是她给自己充电的方式，比什么 spa 都管用。你有什么专属的充电方式呀？`,
    `昨天下班看到天边泛红，赶紧掏出手机拍了一张。虽然糊了，但那种手忙脚乱想要留住美好瞬间的感觉，可能比照片更珍贵。你手机里是不是也有一张舍不得删的晚霞照？`,
  ]
  const idx = Math.abs(cityName.length * 7 + new Date().getDate() * 3) % stories.length
  return stories[idx]
}

// ── 动态标签生成（v3.0: 1热门 + 4精准，不堆砌）─────────────────────────────────
function nationalHashtags(data) {
  const season = getSeason()
  const seasonTags = { summer: '夏日晚霞', autumn: '秋日晚霞', winter: '冬日暖霞', spring: '春日傍晚' }
  const great = (data.summary?.tierDistribution?.Great || 0)
  // 🔴 v3.1: 1 热门主标签 + 4 精准长尾标签，按热度动态切换
  const hotTag = great >= 10 ? '#今天晚霞绝了' : great >= 5 ? '#晚霞大爆发' : '#晚霞预报'
  const tags = [hotTag, `#${seasonTags[season] || '晚霞'}`, '#日落收集计划', '#一起看晚霞', '#今日晚霞']
  return tags.join(' ')
}

function cityHashtags(cityName, score) {
  const season = getSeason()
  const seasonTags = { summer: '夏日晚霞', autumn: '秋日晚霞', winter: '冬日暖霞', spring: '春日傍晚' }
  // 🔴 v3.1: 按分数动态调整标签 — 高分加#火烧云，低分用通用标签
  const base = [`#晚霞预报`, `#${seasonTags[season] || '晚霞'}`, `#${cityName}晚霞`, `#${cityName}拍照`]
  if (score >= 85) {
    base.push('#火烧云', '#年度晚霞')
  } else if (score >= 75) {
    base.push('#绝美晚霞', '#日落收集计划')
  } else if (score >= 65) {
    base.push('#今日晚霞', '#追光者')
  } else {
    base.push('#日落收集计划', '#一起看晚霞')
  }
  // 只保留 5 个标签（1热门 + 4精准）
  return base.slice(0, 5).join(' ')
}

// ── 全国播报（v3.0 标题优化）─────────────────────────────────────────────────
export function generateNationalCopy(data) {
  const { summary, cities } = data
  const top5 = (cities || [])
    .filter(c => c.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  const great = summary.tierDistribution?.Great || 0
  const good = summary.tierDistribution?.Good || 0
  const poor = summary.tierDistribution?.Poor || 0
  const season = getSeason()
  const mood = seasonMood(season)
  const dateStr = data.date?.slice(5) || ''

  // 🔴 v3.0 标题公式：数字 + 情绪 + 紧迫感
  let headline = ''
  if (great >= 15) {
    headline = `${great}城极佳·今晚全国大烧！如果只出门一次就是今天了`
  } else if (great >= 8) {
    headline = `${great}城极佳！${mood.feel.slice(0, 15)}，挑个地方出门吧`
  } else if (great >= 4) {
    headline = `${great}城极佳·${good}城好 | ${dateStr} 晚霞地图`
  } else if (good >= 30) {
    headline = `大部分城市有机会 | ${dateStr} 晚霞预报`
  } else {
    headline = `整体一般·但总有意外 | ${dateStr} 晚霞播报`
  }

  // Top cities with countdown feel
  let topLines = ''
  for (const c of top5) {
    const emoji = scoreEmoji(c.score)
    const time = formatSunset(c.sunsetTime)
    topLines += `${emoji} ${c.name} ${c.score}分·${c.tierCn || ''}·日落${time}\n`
  }

  // Regional notes
  const westernCities = top5.filter(c =>
    ['吐鲁番', '哈密', '银川', '兰州', '西宁', '乌鲁木齐', '拉萨', '西安'].includes(c.name)
  )
  let westernNote = ''
  if (westernCities.length >= 3) {
    westernNote = `\n西部今晚很稳——${westernCities.map(c => c.name).join('、')}全在85+。新疆日落9点半以后，下班慢慢走过去都够。`
  }

  const southBad = (cities || []).filter(c =>
    ['广州', '深圳', '南宁', '海口', '三亚', '福州', '厦门'].includes(c.name) && c.tier === 'Fair'
  )
  let southNote = ''
  if (southBad.length >= 2) {
    southNote = `\n华南云量偏多，${southBad.map(c => c.name).join('、')}今晚不建议特意跑。`
  }

  // 🔴 v3.0 互动钩子
  const hook = `\n今天你那边看到晚霞了吗？评论区晒图👇`

  const body = [
    headline,
    '',
    topLines.trim(),
    westernNote,
    southNote,
    '',
    `📊 全国${cities.length}城：极佳${great} · 好${good} · 翻车${poor}`,
    hook,
  ].filter(Boolean).join('\n')

  return {
    title: `${great >= 8 ? '🔥' : '📸'} 今日晚霞地图 · ${dateStr}`,
    body: body.trim(),
    hashtags: nationalHashtags(data),
  }
}

// ── 城市独立播报（v3.0 爆款标题+三层正文+互动钩子）─────────────────────────────
export function generateCityCopy(city, date, yesterdayCity, recentDays = null) {
  const score = city.score || 0
  const tier = city.tierCn || ''
  const color = city.dominantColor || {}
  const subs = city.subScores || {}
  const time = formatSunset(city.sunsetTime)
  const season = getSeason()
  const mood = seasonMood(season)
  const spots = getSpots(city.name, score)
  const comment = scoreComment(score)

  const seed = (date || '').length + (city.name || '').length + score
  const colorNarr = colorDescription(color.hex, color.name, seed, season)
  const trend = trendNarrative(city, yesterdayCity, recentDays)
  const subNarr = subScoreNarrative(subs)
  const weather = weatherBrief(city)
  const countdown = countdownHint(city.sunsetTime)
  const sensory = sensoryDescription(score, color.name)
  const hook = interactionHook(city.name)

  				// ── 🔴 v3.3 标题公式：≤17字（含 emoji）──
	let title
	if (score >= 85) {
	    title = `${city.name}今晚${score}分·火烧云预警🔥`
	} else if (score >= 75) {
	    title = `${city.name}今晚${score}分🌅 日落${time}`
	} else if (score >= 65) {
	    title = `${city.name}今晚${score}分·值得蹲🌇`
	} else {
	    title = `${city.name}今晚${score}分·随缘☁️`
	}

			// ── 🔴 v3.3 诗意正文：4种叙事 + 诗意感官 + 温情互动 ──
		const ctx = getDateContext()
		const dateHook = ctx[Math.abs(seed) % ctx.length]
		const weatherStory = weatherNarrative(city)
		const weatherLine = weatherStory ? `${weatherStory}。` : ''
		const poetic = poeticSnippet(score, color.name, seed)
		const spotLine = poeticSpots(spots, city.name, seed * 3)
		const timeInfo = countdown || `日落约${time}`
		const styleIdx = Math.abs(seed * 11 + score) % 4
		let body

		if (styleIdx === 0) {
		    // 叙事A：诗意片段开场 → 天气烘托 → 分数 → 机位诗意化
		    body = [poetic, '', `${weatherStory}。`, trend || '',
		        `${scoreEmoji(score)} ${score}分·${tier} | ${timeInfo}`,
		        spotLine || '', dateHook?.vibe || '', hook,
		    ].filter(Boolean).join('\n')
		} else if (styleIdx === 1) {
		    // 叙事B：日期语境开场 → 天气 → 颜色叙事 → 诗意收尾
		    body = [dateHook?.hook ? `${dateHook.hook}。` : poetic,
		        '', `${weatherStory}。`, trend || '',
		        `${scoreEmoji(score)} ${score}分·${tier} | ${color.name || '--'}`,
		        spotLine || '', dateHook?.vibe || '', hook,
		    ].filter(Boolean).join('\n')
		} else if (styleIdx === 2) {
		    // 叙事C：天气 → 颜色叙事 → 分数 → 诗意片段 → 温情互动
		    body = [`${weatherStory}。`, '', `${colorNarr}。`, trend || '',
		        `${scoreEmoji(score)} ${score}分·${tier} | ${timeInfo}`,
		        spotLine || '', poetic, hook,
		    ].filter(Boolean).join('\n')
		} else {
		    // 叙事D：简洁有力 → 分数前置 → 天气 → 诗意 → 温情故事
		    body = [`${scoreEmoji(score)} ${score}分·${tier} 🕐 ${timeInfo}`,
		        '', `${weatherStory}。`, poetic + ` ${colorNarr}。`,
		        spotLine || '', dateHook?.hook || '', hook,
		    ].filter(Boolean).join('\n')
		}

		// 日期特有标签注入
		let extraTags = ''
		if (dateHook?.tag) extraTags += ` ${dateHook.tag}`

const hashtags = cityHashtags(city.name, score) + extraTags

  return { title, body: body.trim(), hashtags }
}

// ── 一线城市列表 ─────────────────────────────────────────────────────────────────
export const TIER1_CITY_IDS = [
  'beijing', 'shanghai', 'guangzhou', 'shenzhen',
  'hangzhou', 'chengdu', 'chongqing', 'wuhan',
  'nanjing', 'xian', 'changsha', 'tianjin',
  'suzhou', 'qingdao', 'xiamen', 'dalian',
]

// 🔴 v3.1: 核心城市 — 每天必发，无晚霞时播报预测
export const CORE_CITY_IDS = ['hangzhou', 'guangzhou', 'xiamen', 'beijing', 'shanghai']

// ── 🔴 v3.1 短文案模式（≤100字，适合快速发帖 + 故事功能）──────────────────────────
export function generateShortCopy(city, color, score, seed = 0) {
  const tier = score >= 80 ? '高概率好晚霞' : score >= 65 ? '有机会' : '随缘看'
  const poetic = poeticSnippet(score, color.name, seed)
  const ctx = getDateContext()
  const dateCtx = ctx[0] || {}
  return {
    title: `${scoreEmoji(score)} ${city.name} ${score}分·${tier}`,
    body: `${poetic} ${dateCtx.hook || ''} 日落约${city.sunset || '--'}。${rotatingHook()}`,
  }
}

// ── 无晚霞时的预测文案 ──────────────────────────────────────────────────────────
function forecastCopy(city, recentDays, season) {
  const mood = seasonMood(season)
  const spots = getSpots(city.name, city.score || 0)
  const spotStr = spots.length ? `推荐机位：${spots.slice(0, 2).join('、')}` : ''

  // 分析近期趋势
  let prediction = ''
  if (recentDays && recentDays.length >= 3) {
    const scores = recentDays.map(d => d?.score || 0).filter(s => s > 0)
    if (scores.length >= 3) {
      const recent = scores.slice(-3)
      const ascending = recent[0] < recent[1] && recent[1] < recent[2]
      const descending = recent[0] > recent[1] && recent[1] > recent[2]

      if (ascending) {
        const avgImprove = Math.round((recent[2] - recent[0]) / 2)
        prediction = `最近3天分数在走高，明天有望达到${Math.min(99, (city.score || 0) + avgImprove + 5)}分左右`
      } else if (descending && recent[2] < 50) {
        prediction = `最近在降温，不过${mood.feel.slice(0, 8)}。再过2-3天可能回弹`
      } else if (recent.slice(-3).every(s => s < 50)) {
        prediction = '近期持续低迷，但夏天的天气变得快，随时可能翻盘'
      } else {
        prediction = '最近波动较大，说不定明天就有惊喜'
      }
    }
  }
  if (!prediction) {
    prediction = `${mood.feel}，好天气随时可能到来，保持关注`
  }

  const title = `${city.name}今天没晚霞🌤️ 别走`
  const body = [
    `${city.name}今天晚霞条件一般，天空可能不够透亮。`,
    `但这不代表你要取关——${prediction}。`,
    '',
    `📊 今天评分：${city.score || '--'}分`,
    spotStr || `日落时间约${formatSunset(city.sunsetTime)}`,
    '',
    `你更喜欢夏天的火烧云还是秋天的温柔晚霞？评论区聊聊👇`,
  ].filter(Boolean).join('\n')

  const hashtags = cityHashtags(city.name, 0).replace('#火烧云', '').replace('#绝美晚霞', '')
  return { title, body, hashtags, isForecast: true }
}

// ── 批量生成 ─────────────────────────────────────────────────────────────────────
export function generateAll(data, yesterdayData, recentDaysData = null) {
  const cities = data.cities || []
  const yesterdayCities = yesterdayData?.cities || []
  const national = generateNationalCopy(data)

  // 一线城市：只发 score >= 55 的
  const cityPosts = TIER1_CITY_IDS
    .map(id => {
      const c = cities.find(c => c.id === id)
      if (!c || c.score == null || c.score < 55) return null
      const yc = yesterdayCities.find(y => y.id === id)
      const recentDays = recentDaysData
        ? recentDaysData.map(d => (d.cities || []).find(c => c.id === id)).filter(Boolean)
        : null
      return generateCityCopy(c, data.date, yc, recentDays)
    })
    .filter(Boolean)

  // 🔴 v3.1: 核心城市每天必发（杭州/广州/厦门/北京/上海）
  // 无晚霞时用预测模式
  const existingIds = new Set(cityPosts.map(p => {
    const m = p.title.match(/^(\S+?)(?:今晚|晚霞|今天)/)
    return m ? cities.find(c => c.name === m[1])?.id : null
  }).filter(Boolean))

  for (const coreId of CORE_CITY_IDS) {
    if (existingIds.has(coreId)) continue  // 已有一线城市播报

    const c = cities.find(c => c.id === coreId)
    if (!c) continue

    if (c.score != null && c.score >= 55) {
      // 有晚霞但不在一线列表（不太可能，但做兜底）
      const yc = yesterdayCities.find(y => y.id === coreId)
      const recentDays = recentDaysData
        ? recentDaysData.map(d => (d.cities || []).find(c => c.id === coreId)).filter(Boolean)
        : null
      cityPosts.push(generateCityCopy(c, data.date, yc, recentDays))
    } else {
      // 无晚霞 → 预测模式
      const recentDays = recentDaysData
        ? recentDaysData.map(d => (d.cities || []).find(c => c.id === coreId)).filter(Boolean)
        : null
      const season = getSeason()
      cityPosts.push(forecastCopy(c, recentDays, season))
    }
  }

  return { national, cityPosts }
}
