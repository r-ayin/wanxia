const cities = [
  // === 直辖市 ===
  { id: 'beijing', name: '北京', nameEn: 'Beijing', lat: 39.90, lon: 116.40, province: '北京', region: 'north', elevation: 49 },
  { id: 'tianjin', name: '天津', nameEn: 'Tianjin', lat: 39.13, lon: 117.20, province: '天津', region: 'north', elevation: 5 },
  { id: 'shanghai', name: '上海', nameEn: 'Shanghai', lat: 31.23, lon: 121.47, province: '上海', region: 'east', elevation: 4 },
  { id: 'chongqing', name: '重庆', nameEn: 'Chongqing', lat: 29.56, lon: 106.55, province: '重庆', region: 'southwest', elevation: 244 },

  // === 华北 ===
  { id: 'shijiazhuang', name: '石家庄', nameEn: 'Shijiazhuang', lat: 38.04, lon: 114.51, province: '河北', region: 'north', elevation: 81 },
  { id: 'taiyuan', name: '太原', nameEn: 'Taiyuan', lat: 37.87, lon: 112.55, province: '山西', region: 'north', elevation: 778 },
  { id: 'hohhot', name: '呼和浩特', nameEn: 'Hohhot', lat: 40.84, lon: 111.75, province: '内蒙古', region: 'northwest', elevation: 1065 },
  { id: 'jinan', name: '济南', nameEn: 'Jinan', lat: 36.65, lon: 116.98, province: '山东', region: 'north', elevation: 52 },
  { id: 'zhengzhou', name: '郑州', nameEn: 'Zhengzhou', lat: 34.75, lon: 113.65, province: '河南', region: 'north', elevation: 108 },
  { id: 'qingdao', name: '青岛', nameEn: 'Qingdao', lat: 36.07, lon: 120.38, province: '山东', region: 'north', elevation: 25 },

  // === 东北 ===
  { id: 'shenyang', name: '沈阳', nameEn: 'Shenyang', lat: 41.80, lon: 123.43, province: '辽宁', region: 'northeast', elevation: 50 },
  { id: 'changchun', name: '长春', nameEn: 'Changchun', lat: 43.88, lon: 125.32, province: '吉林', region: 'northeast', elevation: 215 },
  { id: 'harbin', name: '哈尔滨', nameEn: 'Harbin', lat: 45.75, lon: 126.65, province: '黑龙江', region: 'northeast', elevation: 126 },
  { id: 'dalian', name: '大连', nameEn: 'Dalian', lat: 38.91, lon: 121.60, province: '辽宁', region: 'northeast', elevation: 29 },

  // === 华东 ===
  { id: 'nanjing', name: '南京', nameEn: 'Nanjing', lat: 32.06, lon: 118.80, province: '江苏', region: 'east', elevation: 15 },
  { id: 'hangzhou', name: '杭州', nameEn: 'Hangzhou', lat: 30.27, lon: 120.15, province: '浙江', region: 'east', elevation: 19 },
  { id: 'hefei', name: '合肥', nameEn: 'Hefei', lat: 31.82, lon: 117.23, province: '安徽', region: 'east', elevation: 30 },
  { id: 'fuzhou', name: '福州', nameEn: 'Fuzhou', lat: 26.07, lon: 119.30, province: '福建', region: 'east', elevation: 84 },
  { id: 'suzhou', name: '苏州', nameEn: 'Suzhou', lat: 31.30, lon: 120.62, province: '江苏', region: 'east', elevation: 5 },
  { id: 'xiamen', name: '厦门', nameEn: 'Xiamen', lat: 24.48, lon: 118.09, province: '福建', region: 'east', elevation: 63 },
  { id: 'wenzhou', name: '温州', nameEn: 'Wenzhou', lat: 28.00, lon: 120.67, province: '浙江', region: 'east', elevation: 14 },
  { id: 'nanchang', name: '南昌', nameEn: 'Nanchang', lat: 28.68, lon: 115.86, province: '江西', region: 'central', elevation: 25 },

  // === 华中 ===
  { id: 'wuhan', name: '武汉', nameEn: 'Wuhan', lat: 30.59, lon: 114.31, province: '湖北', region: 'central', elevation: 23 },
  { id: 'changsha', name: '长沙', nameEn: 'Changsha', lat: 28.23, lon: 112.94, province: '湖南', region: 'central', elevation: 44 },

  // === 华南 ===
  { id: 'guangzhou', name: '广州', nameEn: 'Guangzhou', lat: 23.13, lon: 113.26, province: '广东', region: 'south', elevation: 11 },
  { id: 'shenzhen', name: '深圳', nameEn: 'Shenzhen', lat: 22.54, lon: 114.06, province: '广东', region: 'south', elevation: 1 },
  { id: 'nanning', name: '南宁', nameEn: 'Nanning', lat: 22.82, lon: 108.32, province: '广西', region: 'south', elevation: 73 },
  { id: 'haikou', name: '海口', nameEn: 'Haikou', lat: 20.04, lon: 110.35, province: '海南', region: 'south', elevation: 14 },
  { id: 'sanya', name: '三亚', nameEn: 'Sanya', lat: 18.25, lon: 109.50, province: '海南', region: 'south', elevation: 7 },
  { id: 'zhuhai', name: '珠海', nameEn: 'Zhuhai', lat: 22.27, lon: 113.58, province: '广东', region: 'south', elevation: 4 },

  // === 西南 ===
  { id: 'chengdu', name: '成都', nameEn: 'Chengdu', lat: 30.57, lon: 104.07, province: '四川', region: 'southwest', elevation: 500 },
  { id: 'kunming', name: '昆明', nameEn: 'Kunming', lat: 25.04, lon: 102.68, province: '云南', region: 'southwest', elevation: 1891 },
  { id: 'guiyang', name: '贵阳', nameEn: 'Guiyang', lat: 26.65, lon: 106.63, province: '贵州', region: 'southwest', elevation: 1071 },
  { id: 'lijiang', name: '丽江', nameEn: 'Lijiang', lat: 26.87, lon: 100.23, province: '云南', region: 'southwest', elevation: 2400 },
  { id: 'dali', name: '大理', nameEn: 'Dali', lat: 25.59, lon: 100.23, province: '云南', region: 'southwest', elevation: 1976 },

  // === 西北 ===
  { id: 'xian', name: '西安', nameEn: "Xi'an", lat: 34.26, lon: 108.94, province: '陕西', region: 'northwest', elevation: 405 },
  { id: 'lanzhou', name: '兰州', nameEn: 'Lanzhou', lat: 36.06, lon: 103.83, province: '甘肃', region: 'northwest', elevation: 1520 },
  { id: 'xining', name: '西宁', nameEn: 'Xining', lat: 36.62, lon: 101.78, province: '青海', region: 'plateau', elevation: 2261 },
  { id: 'yinchuan', name: '银川', nameEn: 'Yinchuan', lat: 38.49, lon: 106.23, province: '宁夏', region: 'northwest', elevation: 1112 },
  { id: 'urumqi', name: '乌鲁木齐', nameEn: 'Urumqi', lat: 43.80, lon: 87.60, province: '新疆', region: 'northwest', elevation: 800 },
  { id: 'kashgar', name: '喀什', nameEn: 'Kashgar', lat: 39.47, lon: 75.99, province: '新疆', region: 'northwest', elevation: 1289 },
  { id: 'dunhuang', name: '敦煌', nameEn: 'Dunhuang', lat: 40.14, lon: 94.66, province: '甘肃', region: 'northwest', elevation: 1139 },

  // === 青藏高原 ===
  { id: 'lhasa', name: '拉萨', nameEn: 'Lhasa', lat: 29.65, lon: 91.10, province: '西藏', region: 'plateau', elevation: 3650 },
  { id: 'shigatse', name: '日喀则', nameEn: 'Shigatse', lat: 29.27, lon: 88.88, province: '西藏', region: 'plateau', elevation: 3840 },
  { id: 'golmud', name: '格尔木', nameEn: 'Golmud', lat: 36.42, lon: 94.90, province: '青海', region: 'plateau', elevation: 2808 },
  { id: 'nagqu', name: '那曲', nameEn: 'Nagqu', lat: 31.48, lon: 92.07, province: '西藏', region: 'plateau', elevation: 4507 },

  // === 地理极点和补充城市 ===
  { id: 'mohe', name: '漠河', nameEn: 'Mohe', lat: 53.47, lon: 122.37, province: '黑龙江', region: 'northeast', elevation: 433 },
  { id: 'hailar', name: '海拉尔', nameEn: 'Hailar', lat: 49.21, lon: 119.74, province: '内蒙古', region: 'northeast', elevation: 650 },
  { id: 'yantai', name: '烟台', nameEn: 'Yantai', lat: 37.46, lon: 121.45, province: '山东', region: 'north', elevation: 47 },
  { id: 'luoyang', name: '洛阳', nameEn: 'Luoyang', lat: 34.62, lon: 112.45, province: '河南', region: 'north', elevation: 144 },
  { id: 'tangshan', name: '唐山', nameEn: 'Tangshan', lat: 39.63, lon: 118.18, province: '河北', region: 'north', elevation: 28 },
  { id: 'baotou', name: '包头', nameEn: 'Baotou', lat: 40.66, lon: 109.84, province: '内蒙古', region: 'northwest', elevation: 1067 },
  { id: 'wulumuqi', name: '吐鲁番', nameEn: 'Turpan', lat: 42.95, lon: 89.19, province: '新疆', region: 'northwest', elevation: -80 },
  { id: 'yili', name: '伊宁', nameEn: 'Yining', lat: 43.91, lon: 81.33, province: '新疆', region: 'northwest', elevation: 662 },
  { id: 'jiuquan', name: '酒泉', nameEn: 'Jiuquan', lat: 39.74, lon: 98.51, province: '甘肃', region: 'northwest', elevation: 1477 },
  { id: 'zhangye', name: '张掖', nameEn: 'Zhangye', lat: 38.93, lon: 100.45, province: '甘肃', region: 'northwest', elevation: 1483 },
  { id: 'yichang', name: '宜昌', nameEn: 'Yichang', lat: 30.69, lon: 111.29, province: '湖北', region: 'central', elevation: 133 },
  { id: 'guilin', name: '桂林', nameEn: 'Guilin', lat: 25.27, lon: 110.29, province: '广西', region: 'south', elevation: 150 },
  { id: 'beihai', name: '北海', nameEn: 'Beihai', lat: 21.48, lon: 109.12, province: '广西', region: 'south', elevation: 13 },
  { id: 'zunyi', name: '遵义', nameEn: 'Zunyi', lat: 27.73, lon: 106.93, province: '贵州', region: 'southwest', elevation: 844 },
  { id: 'panzhihua', name: '攀枝花', nameEn: 'Panzhihua', lat: 26.58, lon: 101.72, province: '四川', region: 'southwest', elevation: 1014 },
  { id: 'jilin', name: '吉林', nameEn: 'Jilin City', lat: 43.84, lon: 126.55, province: '吉林', region: 'northeast', elevation: 190 },
  { id: 'mudanjiang', name: '牡丹江', nameEn: 'Mudanjiang', lat: 44.55, lon: 129.63, province: '黑龙江', region: 'northeast', elevation: 230 },
  { id: 'ganzhou', name: '赣州', nameEn: 'Ganzhou', lat: 25.83, lon: 114.93, province: '江西', region: 'central', elevation: 124 },
  { id: 'quanzhou', name: '泉州', nameEn: 'Quanzhou', lat: 24.87, lon: 118.68, province: '福建', region: 'east', elevation: 30 },
  { id: 'ningbo', name: '宁波', nameEn: 'Ningbo', lat: 29.87, lon: 121.55, province: '浙江', region: 'east', elevation: 4 },
  { id: 'xuzhou', name: '徐州', nameEn: 'Xuzhou', lat: 34.26, lon: 117.19, province: '江苏', region: 'east', elevation: 37 },
  { id: 'ali', name: '阿里', nameEn: 'Ngari', lat: 32.50, lon: 80.10, province: '西藏', region: 'plateau', elevation: 4280 },
  { id: 'linzhi', name: '林芝', nameEn: 'Nyingchi', lat: 29.65, lon: 94.36, province: '西藏', region: 'plateau', elevation: 2930 },
  { id: 'aba', name: '阿坝', nameEn: 'Aba', lat: 32.90, lon: 101.70, province: '四川', region: 'plateau', elevation: 3290 },
  { id: 'hulunbuir', name: '满洲里', nameEn: 'Manzhouli', lat: 49.60, lon: 117.45, province: '内蒙古', region: 'northeast', elevation: 661 },
  { id: 'altay', name: '阿勒泰', nameEn: 'Altay', lat: 47.85, lon: 88.14, province: '新疆', region: 'northwest', elevation: 737 },
  { id: 'hami', name: '哈密', nameEn: 'Hami', lat: 42.83, lon: 93.51, province: '新疆', region: 'northwest', elevation: 738 },
  { id: 'xishuangbanna', name: '景洪', nameEn: 'Jinghong', lat: 22.01, lon: 100.80, province: '云南', region: 'southwest', elevation: 552 },
  { id: 'shangri-la', name: '香格里拉', nameEn: 'Shangri-La', lat: 27.83, lon: 99.71, province: '云南', region: 'plateau', elevation: 3280 },
  { id: 'yushu', name: '玉树', nameEn: 'Yushu', lat: 33.00, lon: 97.01, province: '青海', region: 'plateau', elevation: 3681 },
  { id: 'korla', name: '库尔勒', nameEn: 'Korla', lat: 41.76, lon: 86.15, province: '新疆', region: 'northwest', elevation: 932 },
  { id: 'hotan', name: '和田', nameEn: 'Hotan', lat: 37.11, lon: 79.93, province: '新疆', region: 'northwest', elevation: 1375 },
  { id: 'datong', name: '大同', nameEn: 'Datong', lat: 40.08, lon: 113.30, province: '山西', region: 'north', elevation: 1040 },
  { id: 'erdos', name: '鄂尔多斯', nameEn: 'Ordos', lat: 39.61, lon: 109.78, province: '内蒙古', region: 'northwest', elevation: 1360 },
]

export function getLatitudes() {
  return cities.map(c => c.lat).join(',')
}

export function getLongitudes() {
  return cities.map(c => c.lon).join(',')
}

export function getCityByIndex(i) {
  return cities[i]
}

export { cities }
export default cities
