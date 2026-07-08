#!/usr/bin/env python3
"""
🎨 晚霞预报 → GPT-Image-2 封面图生成器 v3.2

调用深度智算 GPT-Image-2 API，为每个城市晚霞预报生成小红书风格封面图。
尺寸：1024×1536 (2:3 ≈ 小红书 3:4 标准 1242×1660)。

v3.3 带中文标题渲染:
  - 5套模板均包含中文标题(城市+分数+等级)直接渲染在封面上
  - 明确标识"Xiaohongshu (小红书) cover photo"
  - "Exact Chinese text only. No Japanese characters"防乱码
  - 标题位置: 上部25-30%, 白色粗体+暗色阴影, 居中

流程：
  1. 读取城市数据（名称/分数/等级/主色调/日落时间）
  2. 构建摄影级 prompt（匹配分数和色调）
  3. POST /v1/media/generate → 轮询 /v1/media/status → 下载

依赖：
  pip install requests python-dotenv

环境变量 (来自 .env)：
  GPT_IMAGE_API_KEY — 深度智算 API 密钥

Usage:
  python scripts/generate-cover-image.py                              # 为 posts.json 全部城市生成
  python scripts/generate-cover-image.py --city "杭州" --score 77     # 单城市
  python scripts/generate-cover-image.py --limit 3                    # 只为前 N 篇生成
"""

import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

# Windows 终端 UTF-8 支持
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ── 路径 ─────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "posts"  # 默认，可被 --posts-dir 覆盖
POSTS_JSON = POSTS_DIR / "posts.json"
ENV_FILE = ROOT / ".env"
COVER_DIR = POSTS_DIR / "covers"

# ── API 配置（可从 .env 覆盖）─────────────────────────────────────────────
# GPT_IMAGE_API_BASE — API 端点（默认 深度智算）
# GPT_IMAGE_MODEL    — 模型名（默认 gpt-image-2；可选 gpt-image-1）
def _api_base():
    return os.environ.get("GPT_IMAGE_API_BASE", "https://api.lk888.ai")
def _api_model():
    return os.environ.get("GPT_IMAGE_MODEL", "gpt-image-2")

GENERATE_URL = f"{_api_base()}/v1/media/generate"
STATUS_URL = f"{_api_base()}/v1/media/status"

# 小红书封面尺寸：1024×1536 (2:3)，最接近 3:4 标准
COVER_SIZE = "1024x1536"
COVER_QUALITY = "high"
POLL_INTERVAL = 4  # 秒
MAX_POLL_TIME = 180  # 秒（3 分钟超时）


# ═════════════════════════════════════════════════════════════════════════
# §1 环境加载
# ═════════════════════════════════════════════════════════════════════════

def load_env() -> dict:
    """解析 .env 文件"""
    env = {}
    if ENV_FILE.exists():
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, _, value = line.partition("=")
                    env[key.strip()] = value.strip()
    for k, v in os.environ.items():
        env.setdefault(k, v)
    return env


# ═════════════════════════════════════════════════════════════════════════
# §2 Prompt 构建 — 按分数分档 + 城市特色
# ═════════════════════════════════════════════════════════════════════════

# 城市地标特征（增强 prompt 辨识度）
CITY_LANDMARKS = {
    # 直辖市
    "北京": "the Forbidden City turret and Jingshan Wanchun Pavilion, golden roof curves against sunset",
    "上海": "Lujiazui skyline with Oriental Pearl Tower, Huangpu River reflecting sunset gold",
    "天津": "Tianjin Eye Ferris wheel over Haihe River, colonial architecture in warm light",
    "重庆": "Hongyadong stilt houses clinging to cliffs, Jialing River, mountain city layers",
    # 一线/新一线
    "广州": "Canton Tower slim silhouette, Pearl River新城 CBD skyline at dusk",
    "深圳": "Shenzhen Bay coastline with mangrove trees, modern skyline, Qianhai bridge",
    "杭州": "West Lake Broken Bridge with Leifeng Pagoda, Jiangnan water town poetic mood",
    "成都": "Longquan Mountain ridges with distant snow peaks, Anshun Bridge over Jin River",
    "武汉": "Yellow Crane Tower over Yangtze River, East Lake Lingbo Gate",
    "南京": "Xuanwu Lake with Ming city wall and Zifeng Tower, Wutong tree-lined shores",
    "西安": "ancient city wall South Gate, Bell Tower and Giant Wild Goose Pagoda in Tang Dynasty splendor",
    "长沙": "Orange Isle with Yuelu Mountain, Xiang River, city skyline reflection",
    "苏州": "Jinji Lake with Gate of the Orient, classical garden pagoda silhouettes",
    "青岛": "red-tiled roofs on Signal Hill, German architecture, sea view from Xiaoyu Mountain",
    "厦门": "Gulangyu Island colonial buildings, Yanwu Bridge curving over the sea",
    "大连": "Xinghai Bay cross-sea bridge, coastal cliffs, European-style square",
    "昆明": "Dianchi Lake with Western Hills Sleeping Beauty silhouette, spring city flowers",
    "贵阳": "Qianling Mountain layered green hills, Jiaxiu Pavilion on Nanming River",
    "哈尔滨": "Songhua River, St. Sophia Cathedral onion domes, ice and snow atmosphere",
    "沈阳": "Hunhe River sunset, Mukden Palace golden roof, industrial heritage silhouette",
    "济南": "Daming Lake with Thousand Buddha Mountain, Baotu Spring pavilions",
    "郑州": "Longzi Lake with Zhongyuan Big Corn Tower, modern Henan skyline",
    "福州": "Min River with Gushan Mountain, ancient banyan trees, Three Lanes and Seven Alleys",
    "南宁": "Qingxiu Mountain pagoda, Yong River, tropical greenery skyline",
    "南昌": "Tengwang Pavilion by Gan River, ancient poetry tower silhouette",
    "合肥": "Swan Lake with modern skyline, Dashu Mountain silhouette",
    "兰州": "Yellow River with Zhongshan Iron Bridge, White Pagoda Mountain, western city feel",
    "拉萨": "Potala Palace silhouette against golden plateau sky, prayer flags, snow mountains behind",
    "乌鲁木齐": "Tianshan Mountains snow peaks, Red Hill pagoda, central Asian cityscape",
    "呼和浩特": "Dazhao Temple golden roof, grasslands horizon, modern inner Mongolia skyline",
    "海口": "tropical coconut tree coastline, Century Bridge over Qiongzhou Strait",
    "三亚": "coconut dream corridor, Sanya Bay, Phoenix Island, tropical ocean sunset",
    "西宁": "Nanshan Park overlooking city, highland plateau sunset, Tibetan prayer flags",
    "银川": "Lanshan Park Roman columns silhouette, Helan Mountains, Yellow River plains",
    # 其他热门
    "桂林": "karst mountain peaks in Li River, Elephant Trunk Hill silhouette",
    "洛阳": "Longmen Grottoes by Yi River, White Horse Temple pagoda, ancient capital",
    "敦煌": "Mogao Caves, Mingsha Sand Dunes crescent moon spring, Silk Road desert",
}

# 分数分档 → 描述风格
SCORE_MOODS = {
    (85, 101): "史诗级火烧云，浓烈的绯红和金色云层铺满天空，杂志封面级震撼画面",
    (75, 85):  "壮观的暖色调日落，鲜艳的橙粉云层交叠，黄金时刻光芒洒在城市上空",
    (65, 75):  "舒服的日落天色，柔和桃色和淡紫渐变，薄云轻染，温暖但不浓烈",
    (0, 65):   "氛围感黄昏，柔和蓝紫渐变，云层偏厚但有诗意，天边残留一抹暖光",
}


def get_mood(score: int) -> str:
    for (lo, hi), mood in SCORE_MOODS.items():
        if lo <= score < hi:
            return mood
    return SCORE_MOODS[(65, 75)][1]  # default: pleasant


def get_landmark(name: str) -> str:
    """精确匹配城市名返回地标描述"""
    for city, desc in CITY_LANDMARKS.items():
        if city in name:
            return desc
    return f"{name}城市天际线"


# 颜色名称 → 中文视觉描述
COLOR_VISUALS = {
    "赤红": "浓烈的绯红色", "橙红": "鲜艳的橙红色", "金黄": "温暖的黄金色",
    "粉紫": "柔和的粉紫色渐变", "淡粉": "清透的淡粉色", "粉橙": "蜜桃橘粉色",
    "紫红": "魅惑的紫红色", "暖黄": "温柔的琥珀暖黄", "灰蓝": "低饱和灰蓝色",
    "深紫": "深邃的紫罗兰色", "绯红": "浓烈的绯红色",
    "火焰橙红": "火焰般的橙红色", "灰白": "柔和的灰白色", "橙金": "落日熔金色",
}


# ── Prompt 模板库（v3.3 带中文标题 + 小红书封面标识）───────────────────────────
# 关键变化: 直接在图上渲染中文标题(城市+分数)，不再留白给后期加字
# GPT-Image-2 中文渲染准确率 97-99%，约束"Exact Chinese text only"防乱码

COVER_TEMPLATES_RAW = [
    # A：国家地理大片风 极佳>=85
    """一张小红书风格的封面图，竖屏3:4比例，1242x1660像素。
画面背景是国家地理级别的风光摄影作品——{city}在日落最美的一刻。
画面中{landmark}。
{time}{mood}。
画面中有小红书爆款标题：
第一行大字 [{t1}]，第二行稍小一点的字 [{t2}]。
画面下方背景是{landmark}，暖光倒映在水面或建筑上。
风格：小红书风格，爆红网络标题，风光摄影大片，高动态范围，暖金色调，轻微胶片颗粒感，8K细节，电影级调色。""",

    # B：小红书爆款封面风 好>=65
    """一张小红书风格的封面图，竖屏3:4比例，1242x1660像素。
画面背景是{city}的日落时分，{landmark}。
{time}天空铺满了{color}的晚霞——{mood}。
画面中有小红书爆款标题：
第一行大字 [{t1}]，第二行稍小一点的字 [{t2}]。
画面下方背景是{landmark}，暖色调的落日光芒洒在建筑和水面上，
让人看了就想立刻出门去看。
风格：小红书风格，爆红网络标题，温暖治愈有旅行冲动，高饱和度暖色系，柔和自然光，8K画质。""",

    # C：氛围感情绪风 一般<65
    """一张小红书风格的封面图，竖屏3:4比例，1242x1660像素。
画面背景是{city}的安静黄昏，{landmark}在暮霭中若隐若现。
{time}天边是淡淡的{color}——{mood}。
画面中有小红书爆款标题：
第一行大字 [{t1}]，第二行稍小一点的字 [{t2}]。
画面下方背景是{landmark}的剪影，远处城市灯火初上，薄雾般的空气透视感。
风格：小红书风格，爆红网络标题，诗意安静，胶片摄影质感，柔和颗粒，低饱和温暖色调，梦幻散景。""",

    # D：城市明信片风
    """一张小红书风格的封面图，竖屏3:4比例，1242x1660像素。
画面背景是{city}的经典视角——{landmark}，背景是{color}的晚霞天空。
{time}黄金时刻的光线洒满城市。{mood}。
画面中有小红书爆款标题：
第一行大字 [{t1}]，第二行稍小一点的字 [{t2}]。
画面下方背景是{landmark}的倒影和城市天际线，
像是旅行中最想寄出的那张明信片。
风格：小红书风格，爆红网络标题，旅行摄影师作品集，干净构图，暖色饱和，自然色彩，8K。""",

    # E：极简大片风 高分专用
    """一张小红书风格的封面图，竖屏3:4比例，1242x1660像素。
画面背景只有一个核心元素：{landmark}的完美剪影，
映衬在{color}的晚霞天空中。
{time}云层的形态是这张照片的主角——{mood}。
画面中有小红书爆款标题：
第一行大字 [{t1}]，第二行稍小一点的字 [{t2}]。
画面下方背景是{landmark}的清晰暗色剪影，没有任何干扰元素。
风格：小红书风格，爆红网络标题，高端建筑摄影，强烈对比，极简震撼，电影画幅，8K。""",
]

# 包装为 lambda，保持接口不变
def _make_template(raw):
    return lambda city, landmark, mood, color, time, score, tier, t1, t2: raw.format(
        city=city, landmark=landmark, mood=mood, color=color,
        time=time, score=score, tier=tier, t1=t1, t2=t2)

COVER_TEMPLATES = [_make_template(t) for t in COVER_TEMPLATES_RAW]

def build_cover_title(city_name: str, score: int, tier_cn: str) -> str:
    """生成封面上的中文标题（与 v3.0 文案引擎一致的爆款公式）"""
    if score >= 85:
        return f"{city_name}今晚{score}分！\n年度级火烧云预警"
    elif score >= 75:
        return f"{city_name}晚霞{score}分\n大概率看到"
    elif score >= 65:
        return f"{city_name}晚霞{score}分\n值得出门蹲"
    else:
        return f"{city_name}晚霞{score}分\n随缘出门"

def build_prompt(city_name: str, score: int, tier_cn: str, color_name: str, sunset_time: str = "") -> str:
    """为指定城市构建 GPT-Image-2 cover prompt"""
    mood = get_mood(score)
    landmark = get_landmark(city_name)
    color_visual = COLOR_VISUALS.get(color_name, "warm sunset colors")

    time_hint = ""
    try:
        if sunset_time:
            h = int(sunset_time.split(":")[0])
            if h < 18:
                time_hint = "午后光线正在转为黄金时刻。"
            elif h < 20:
                time_hint = "太阳正贴近地平线，黄金时刻的魔法光线。"
            else:
                time_hint = "太阳刚刚落下，天空还残留着最后的暖光。"
    except (ValueError, IndexError):
        pass

    cover_title = build_cover_title(city_name, score, tier_cn)
    title_line1 = cover_title.split("\n")[0] if "\n" in cover_title else cover_title
    title_line2 = cover_title.split("\n")[1] if "\n" in cover_title else tier_cn

    if score >= 85:
        t_idx = (score * 7 + len(city_name) * 3) % 2
        templates = [COVER_TEMPLATES[0], COVER_TEMPLATES[4]]
    elif score >= 65:
        t_idx = (score * 11 + len(city_name) * 5) % 2
        templates = [COVER_TEMPLATES[1], COVER_TEMPLATES[3]]
    else:
        t_idx = 0
        templates = [COVER_TEMPLATES[2]]

    template_fn = templates[t_idx]
    return template_fn(city_name, landmark, mood, color_visual, time_hint, score, tier_cn, title_line1, title_line2)


def build_national_prompt(data: dict) -> str:
    """为全国播报构建封面 prompt"""
    summary = data.get("summary", {})
    posts = data.get("posts", [])

    # 找到最佳城市
    best_city = None
    for p in posts:
        if p.get("score") and (not best_city or p["score"] > best_city.get("score", 0)):
            best_city = p

    best_name = best_city.get("cityName", "中国") if best_city else "中国"
    best_score = best_city.get("score", 70) if best_city else 70
    best_color_name = best_city.get("dominantColor", {}).get("name", "暖色调") if best_city and isinstance(best_city.get("dominantColor"), dict) else "暖色调"

    tier_dist = summary.get("tierDistribution", {})
    great = tier_dist.get("Great", 0)
    good = tier_dist.get("Good", 0)

    # 构建全国概览描述
    if great >= 15:
        mood_desc = "全国大范围火烧云爆发，多个城市同时出现壮丽晚霞"
    elif great >= 5:
        mood_desc = f"{great}个城市可能看到极佳晚霞，多地同时上演天空秀"
    elif good >= 30:
        mood_desc = "大部分城市有机会看到不错的晚霞，温暖金色铺满全国"
    else:
        mood_desc = "部分地区晚霞条件尚可，云层缝隙中偶有惊喜"

    landmark = get_landmark(best_name)

    t1 = f"今日晚霞地图"
    t2 = f"{best_name}{best_score}分·{great}城极佳" if great >= 5 else f"{best_name}领衔·{good}城好"

    score = best_score
    return COVER_TEMPLATES[3](best_name, landmark, mood_desc,
                              COLOR_VISUALS.get(best_color_name, "warm sunset colors"),
                              "", score, "全国", t1, t2)


# ═════════════════════════════════════════════════════════════════════════
# §3 API 客户端
# ═════════════════════════════════════════════════════════════════════════

class GPTImageClient:
    """GPT-Image-2 API 客户端"""

    def __init__(self, api_key: str):
        self.api_key = api_key

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def create_task(self, prompt: str, size: str = COVER_SIZE, quality: str = COVER_QUALITY) -> dict:
        """创建图片生成任务，返回 {task_id, ...}"""
        data = json.dumps({
            "model": _api_model(),
            "params": {
                "size": size,
                "quality": quality,
                "n": 1,
            },
            "prompt": prompt,
        }).encode("utf-8")

        req = urllib.request.Request(GENERATE_URL, data=data, headers=self._headers(), method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                result = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"API HTTP {e.code}: {body}") from e
        except urllib.error.URLError as e:
            raise RuntimeError(f"API 连接失败: {e.reason}") from e

        if result.get("code") != 200:
            raise RuntimeError(f"API 错误: {result}")

        data_block = result.get("data", {})
        return {
            "task_id": data_block.get("task_id"),
            "raw": result,
        }

    def poll_task(self, task_id: int, max_retries: int = 5) -> dict:
        """轮询任务状态，返回完整 status JSON（带重试）"""
        url = f"{STATUS_URL}?task_id={task_id}"
        for attempt in range(max_retries):
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.api_key}"})
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", errors="replace")
                if e.code == 401 and attempt < max_retries - 1:
                    time.sleep(3 * (attempt + 1))
                    continue
                if e.code >= 500 and attempt < max_retries - 1:
                    time.sleep(5 * (attempt + 1))
                    continue
                raise RuntimeError(f"Status API HTTP {e.code}: {body}") from e
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                if attempt < max_retries - 1:
                    print(f"⏳", end=" ", flush=True)
                    time.sleep(5 * (attempt + 1))
                    continue
                raise RuntimeError(f"Status API 连接失败(重试{max_retries}次): {e}") from e
        raise RuntimeError(f"Status API 重试耗尽")

    def download_image(self, url: str, save_path: Path, max_retries: int = 5) -> bool:
        """下载图片到指定路径（带重试）"""
        for attempt in range(max_retries):
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://api.lk888.ai/",
            })
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    save_path.parent.mkdir(parents=True, exist_ok=True)
                    save_path.write_bytes(resp.read())
                return True
            except Exception as e:
                if attempt < max_retries - 1:
                    print(f"⏳", end=" ", flush=True)
                    time.sleep(5 * (attempt + 1))
                    continue
                print(f"   ⚠️  下载失败(重试{max_retries}次): {e}")
                return False
        return False

    def generate_and_wait(self, prompt: str, save_path: Path, label: str = "", max_retries: int = 1) -> dict | None:
        """完整流程: 创建任务 → 轮询 → 下载（支持失败重试）

        Returns:
            {"path": str, "url": str, "cost": float} | None
        """
        last_error = None
        for attempt in range(max_retries + 1):
            if attempt > 0:
                wait_s = 10 * attempt
                print(f"\n   🔄 [{label}] 重试 {attempt}/{max_retries}（{wait_s}s后）...", end=" ", flush=True)
                time.sleep(wait_s)

            # 1) 创建
            if attempt == 0:
                print(f"   🎨 [{label}] 创建任务...", end=" ", flush=True)
            try:
                task = self.create_task(prompt)
            except RuntimeError as e:
                last_error = f"创建失败: {e}"
                print(f"\n   ❌ {last_error}")
                continue

            task_id = task["task_id"]
            if attempt == 0:
                print(f"task_id={task_id}", end=" ", flush=True)

            # 2) 轮询
            start_time = time.time()
            poll_failures = 0
            while True:
                elapsed = time.time() - start_time
                if elapsed > MAX_POLL_TIME:
                    last_error = f"轮询超时({MAX_POLL_TIME}s)"
                    print(f"\n   ⏰ {last_error}")
                    break  # 跳出轮询循环，触发重试

                time.sleep(POLL_INTERVAL)
                try:
                    status = self.poll_task(task_id)
                except RuntimeError as e:
                    poll_failures += 1
                    if poll_failures >= 3:
                        last_error = f"连续{poll_failures}次轮询异常: {e}"
                        print(f"\n   ⚠️  {last_error}")
                        break  # 跳出轮询循环，触发重试
                    print(f"\n   ⚠️  轮询异常({poll_failures}/3): {e}", end=" ", flush=True)
                    continue

                poll_failures = 0  # 成功一次就重置
                if status.get("is_final"):
                    state = status.get("state", "")
                    if state == "success":
                        result_url = status.get("result_url", "")
                        cost = status.get("cost", 0)
                        print(f"✅ (cost={cost})")

                        # 3) 下载
                        if result_url:
                            print(f"   📥 下载中...", end=" ", flush=True)
                            ok = self.download_image(result_url, save_path)
                            if ok:
                                file_size = save_path.stat().st_size / 1024
                                print(f"✅ {file_size:.0f}KB → {save_path.name}")
                                return {"path": str(save_path), "url": result_url, "cost": cost}
                            else:
                                last_error = "下载失败"
                                break  # 触发重试
                        else:
                            last_error = "无 result_url"
                            print(f"   ⚠️  {last_error}")
                            return None  # 无URL则重试无意义

                    elif state == "failed":
                        last_error = f"任务失败: {status.get('error', status)}"
                        print(f"\n   ❌ {last_error}")
                        break  # 触发重试
                    else:
                        last_error = f"未知终态: {state}"
                        print(f"\n   ❌ {last_error}")
                        return None
                # else: 继续轮询

        # 所有重试耗尽
        print(f"   💀 [{label}] 所有重试耗尽: {last_error}")
        return None


# ═════════════════════════════════════════════════════════════════════════
# §4 批量生成
# ═════════════════════════════════════════════════════════════════════════

def generate_covers_from_posts(client: GPTImageClient, posts_json: Path, limit: int = 0) -> list[dict]:
    """从 posts.json 读取城市数据，批量生成封面图

    Args:
        client: API 客户端
        posts_json: posts.json 路径
        limit: 最大生成数量（0=全部）

    Returns:
        [{"city": str, "cover": str, "url": str, "cost": float}, ...]
    """
    if not posts_json.exists():
        print(f"❌ posts.json 不存在: {posts_json}")
        return []

    with open(posts_json, "r", encoding="utf-8") as f:
        package = json.load(f)

    posts = package.get("posts", [])
    # 跳过全国播报（第一个），只处理城市独立帖
    # ── 识别全国帖 vs 城市帖 ──
    national_post = posts[0] if not (posts[0].get("cityName") or posts[0].get("score")) else None
    city_posts = [p for p in posts if p.get("cityName") or p.get("score")]

    results = []
    failed = []
    COVER_DIR.mkdir(parents=True, exist_ok=True)

    # 🔴 v3.1: 全国播报也生成封面
    if national_post:
        print(f"   🗺️  全国播报封面...")
        try:
            prompt = build_national_prompt(package)
            save_path = COVER_DIR / "00-national-cover.png"
            result = client.generate_and_wait(prompt, save_path, label="全国播报")
            if result:
                results.append({
                    "city": "全国",
                    "cover": result["path"],
                    "cover_file": "00-national-cover.png",
                    "url": result["url"],
                    "cost": result["cost"],
                    "score": 0, "tier": "",
                })
                print(f"   ✅ 全国播报封面已生成")
            else:
                print(f"   ⚠️ 全国播报封面生成失败")
        except Exception as e:
            print(f"   ⚠️ 全国封面异常: {e}")

    # ── 城市独立帖 ──
    total = len(city_posts)
    for i, post in enumerate(city_posts):
        city_name = post.get("cityName") or ""
        # 从 title 提取城市名
        if not city_name:
            title = post.get("title", "")
            if "晚霞" in title:
                parts = title.split("晚霞")
                pre = parts[0].strip()
                for ch in ["🔥", "🌅", "🌇", "☁️", "✨", " "]:
                    pre = pre.replace(ch, "")
                city_name = pre.strip()

        if not city_name:
            print(f"   ⚠️  跳过: 无法识别城市名 ({post.get('title', '?')[:20]})")
            failed.append({"city": "?", "reason": "无法识别城市名"})
            continue

        score = post.get("score") or 0
        tier_cn = post.get("tierCn") or post.get("tier_cn") or ""
        color_name = post.get("dominantColor", {}).get("name") if isinstance(post.get("dominantColor"), dict) else ""
        sunset_time = post.get("sunsetTime") or ""

        # 构建 prompt
        prompt = build_prompt(city_name, score, tier_cn, color_name, sunset_time)

        # 输出路径
        fname = post.get("file", f"{i+1:02d}-{city_name}.png")
        stem = Path(fname).stem
        save_path = COVER_DIR / f"{stem}-cover.png"

        label = f"{city_name} {score}分"
        result = client.generate_and_wait(prompt, save_path, label=label)

        if result:
            results.append({
                "city": city_name,
                "cover": result["path"],
                "cover_file": save_path.name,
                "url": result["url"],
                "cost": result["cost"],
                "score": score,
                "tier": tier_cn,
            })
        else:
            failed.append({"city": city_name, "score": score, "reason": "API 生成失败（已重试）"})

        # 限流间隔
        if i < len(city_posts) - 1:
            time.sleep(2)

    # ── 汇总 ──
    if failed:
        print(f"\n   ⚠️  {len(failed)} 个城市封面生成失败:")
        for f in failed:
            print(f"      - {f['city']} ({f.get('score','?')}分): {f['reason']}")

    return results


# ═════════════════════════════════════════════════════════════════════════
# §5 CLI
# ═════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="GPT-Image-2 小红书封面图生成器")
    parser.add_argument("--city", type=str, help="单城市模式：城市名")
    parser.add_argument("--score", type=int, default=75, help="单城市模式：晚霞评分")
    parser.add_argument("--tier", type=str, default="好", help="单城市模式：等级（极佳/好/一般）")
    parser.add_argument("--color", type=str, default="金黄", help="单城市模式：主色调")
    parser.add_argument("--time", type=str, default="", help="单城市模式：日落时间 HH:MM")
    parser.add_argument("--limit", type=int, default=0, help="批量模式：最大生成数量")
    parser.add_argument("--output", type=str, default="", help="单城市模式：输出路径")
    parser.add_argument("--posts-dir", type=str, default="", help="批量模式：posts.json 所在目录（按日期归档用）")
    args = parser.parse_args()

    # 🔴 v3.1: 支持 --posts-dir 指定日期子目录
    global POSTS_DIR, POSTS_JSON, COVER_DIR
    if args.posts_dir:
        POSTS_DIR = Path(args.posts_dir)
        POSTS_JSON = POSTS_DIR / "posts.json"
        COVER_DIR = POSTS_DIR / "covers"

    # 加载密钥
    env = load_env()
    api_key = env.get("GPT_IMAGE_API_KEY", "")
    if not api_key:
        print("❌ 未配置 GPT_IMAGE_API_KEY")
        print("   请在 .env 中添加: GPT_IMAGE_API_KEY=sk-xxx")
        sys.exit(1)

    client = GPTImageClient(api_key)

    # ── 单城市模式
    if args.city:
        prompt = build_prompt(args.city, args.score, args.tier, args.color, args.time)
        print(f"🎨 生成封面: {args.city} ({args.score}分 {args.tier})")
        print(f"   Prompt: {prompt[:120]}...")

        out_path = Path(args.output) if args.output else COVER_DIR / f"{args.city}-cover.png"
        result = client.generate_and_wait(prompt, out_path, label=args.city)
        if result:
            print(f"\n✅ 完成! {result['path']}")
        else:
            print("\n❌ 生成失败")
            sys.exit(1)
        return

    # ── 批量模式: 从 posts.json 读取
    if not POSTS_JSON.exists():
        print(f"❌ posts.json 不存在: {POSTS_JSON}")
        print("   请先运行: node scripts/publish-xhs.js")
        sys.exit(1)

    print("╔════════════════════════════════════════╗")
    print("║  🎨 GPT-Image-2 封面图生成器 v1.0    ║")
    print("╚════════════════════════════════════════╝")
    print(f"   尺寸: {COVER_SIZE} (2:3)")
    print(f"   质量: {COVER_QUALITY}")
    print(f"   输出: {COVER_DIR}/\n")

    results = generate_covers_from_posts(client, POSTS_JSON, limit=args.limit)

    # ── 更新 posts.json 添加封面路径
    if results:
        with open(POSTS_JSON, "r", encoding="utf-8") as f:
            package = json.load(f)

        # 建立城市名→封面映射
        cover_map = {r["city"]: r for r in results}

        for post in package.get("posts", []):
            title = post.get("title", "")
            for city_name, cover_info in cover_map.items():
                if city_name in title:
                    post["cover"] = cover_info["cover_file"]
                    post["coverCost"] = cover_info["cost"]
                    break

        package["covers"] = {
            "generatedAt": datetime.now().isoformat(),
            "model": _api_model(),
            "size": COVER_SIZE,
            "count": len(results),
            "totalCost": sum(r["cost"] for r in results),
            "items": [
                {
                    "city": r["city"],
                    "file": r["cover_file"],
                    "score": r.get("score", 0),
                    "tier": r.get("tier", ""),
                }
                for r in results
            ],
        }

        with open(POSTS_JSON, "w", encoding="utf-8") as f:
            json.dump(package, f, ensure_ascii=False, indent=2)

        print(f"\n{'═' * 50}")
        print(f"✅ 全部完成！{len(results)} 张封面图已生成")
        print(f"   总费用: {sum(r['cost'] for r in results):.4f}")
        print(f"   已更新: {POSTS_JSON}")
        for r in results:
            print(f"   📸 {r['city']} ({r.get('score', '?')}分) → {r['cover_file']}")
    else:
        print("\n⚠️  无封面图生成")
        sys.exit(1)


if __name__ == "__main__":
    main()
