#!/usr/bin/env python3
"""
📱 晚霞预报 → 小红书 Creator Platform 一键发帖
================================================
基于 Browser Use (browser-use, 75k+ stars) — Manus 底层引擎

流程：
  1. 读取 posts/posts.json（由 publish-xhs.js 生成）
  2. 从 .env 加载 Xiaohongshu Cookie → Playwright storage_state
  3. Browser Use Agent 自主操控浏览器完成发布

依赖：
  pip install browser-use python-dotenv

环境变量 (来自 .env)：
  XIAOHONGSHU_COOKIE — 小红书 cookie 字符串
  ANTHROPIC_API_KEY  — Claude API key

Usage:
  python scripts/post_xhs_browseruse.py                  # 发布所有帖子
  python scripts/post_xhs_browseruse.py --headless=false # 可视化调试
  python scripts/post_xhs_browseruse.py --limit 3        # 只发前 3 篇
  python scripts/post_xhs_browseruse.py --post-idx 0     # 只发第 N 篇（0-indexed）
"""

import argparse
import asyncio
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

# Windows 终端 UTF-8 支持（修复 GBK 编码 emoji 错误）
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ── ROOT ──────────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "posts"
POSTS_JSON = POSTS_DIR / "posts.json"
ENV_FILE = ROOT / ".env"
STORAGE_STATE = ROOT / "scripts" / ".xhs_storage_state.json"


# ═══════════════════════════════════════════════════════════════════════════════════
# §1 环境 & Cookie 加载
# ═══════════════════════════════════════════════════════════════════════════════════

def load_env() -> dict:
    """解析 .env 文件，返回 key-value 字典"""
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
    # 也加载系统环境变量（优先级低于 .env）
    for k, v in os.environ.items():
        env.setdefault(k, v)
    return env


def parse_cookie_string(cookie_str: str) -> list[dict]:
    """将 HTTP Cookie header 字符串解析为 Playwright cookie 列表

    格式: "name1=value1; name2=value2; ..."
    """
    cookies = []
    for item in cookie_str.split(";"):
        item = item.strip()
        if "=" not in item:
            continue
        name, _, value = item.partition("=")
        name = name.strip()
        value = value.strip()
        if not name:
            continue
        cookies.append({
            "name": name,
            "value": value,
            "domain": ".xiaohongshu.com",
            "path": "/",
            "httpOnly": "token" in name.lower() or "session" in name.lower(),
            "secure": True,
            "sameSite": "Lax",
        })
    return cookies


async def setup_xhs_auth() -> None:
    """🔧 交互式 Cookie 导出模式

    打开可视化浏览器，用户手动登录小红书创作者平台后，
    Browser Use 自动导出 storage_state。
    同时也会打印 cookie 字符串供 .env 使用。
    """
    from browser_use import Browser

    print("╔══════════════════════════════════════════════╗")
    print("║  🔧 小红书 Cookie 导出工具                  ║")
    print("║     基于 Browser Use (Manus 底层引擎)       ║")
    print("╚══════════════════════════════════════════════╝")
    print()
    print("即将打开浏览器，请按以下步骤操作：")
    print("  1. 在打开的浏览器中访问 https://creator.xiaohongshu.com")
    print("  2. 扫码登录（登录后保持浏览器开着）")
    print("  3. 确认已登录后，回到终端按 Enter")
    print("  4. 脚本会自动导出 cookie")
    print()

    input("按 Enter 开始...")

    browser = Browser(
        headless=False,
        keep_alive=True,
        window_size={"width": 1440, "height": 900},
    )

    # Open the browser and let user log in
    await browser.start()
    page = await browser.get_current_page()
    await page.goto("https://creator.xiaohongshu.com")
    print("\n✅ 浏览器已打开 → 请登录小红书创作者平台")
    print("   登录后回到终端按 Enter 继续...")

    # Wait for user
    await asyncio.get_event_loop().run_in_executor(None, lambda: input("\n按 Enter 导出 cookie..."))

    # Export storage state
    await browser.export_storage_state(str(STORAGE_STATE))
    print(f"\n✅ storage_state 已导出: {STORAGE_STATE}")

    # Also extract cookie string for .env
    cookies = await page.context.cookies()
    cookie_parts = [f"{c['name']}={c['value']}" for c in cookies if c.get("name")]
    cookie_str = "; ".join(cookie_parts)
    print(f"\n📋 请将以下 cookie 更新到 .env 的 XIAOHONGSHU_COOKIE：")
    print(f"   XIAOHONGSHU_COOKIE={cookie_str}")

    await browser.close()
    print("\n🔧 Setup 完成！现在可以运行:")
    print("   python scripts/post_xhs_browseruse.py --dry-run")
    print("   python scripts/post_xhs_browseruse.py --limit 1")


def build_storage_state(cookie_str: str) -> dict:
    """构建 Playwright-compatible storage state JSON"""
    cookies = parse_cookie_string(cookie_str)
    return {"cookies": cookies, "origins": []}


def save_storage_state(cookie_str: str) -> Path:
    """保存 storage state 到文件，供 Browser Use 加载"""
    state = build_storage_state(cookie_str)
    STORAGE_STATE.parent.mkdir(parents=True, exist_ok=True)
    with open(STORAGE_STATE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
    print(f"   ✅ 已解析 {len(state['cookies'])} 个 cookie → {STORAGE_STATE}")
    return STORAGE_STATE


# ═══════════════════════════════════════════════════════════════════════════════════
# §2 帖子数据加载
# ═══════════════════════════════════════════════════════════════════════════════════

def load_posts(limit: int | None = None, post_idx: int | None = None) -> list[dict]:
    """从 posts.json 加载发帖列表"""
    if not POSTS_JSON.exists():
        print(f"❌ posts.json 不存在: {POSTS_JSON}")
        print("   请先运行: node scripts/publish-xhs.js")
        sys.exit(1)

    with open(POSTS_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    posts = data.get("posts", [])
    if not posts:
        print("❌ posts.json 中没有帖子")
        sys.exit(1)

    if post_idx is not None:
        if 0 <= post_idx < len(posts):
            posts = [posts[post_idx]]
            print(f"\n📍 指定发布第 {post_idx} 篇 (共 {len(data.get('posts', []))} 篇)")
        else:
            print(f"❌ post_idx={post_idx} 超出范围 (0-{len(posts) - 1})")
            sys.exit(1)
    elif limit and limit < len(posts):
        posts = posts[:limit]
        print(f"\n📍 只发布前 {limit} 篇 (共 {len(data.get('posts', []))} 篇)")
    else:
        print(f"\n📍 发布全部 {len(posts)} 篇")

    # 为每个 post 读取完整文案
    for p in posts:
        copy_file = POSTS_DIR / (p.get("copyFile") or "")
        if copy_file.exists():
            p["full_copy"] = copy_file.read_text(encoding="utf-8").strip()
        else:
            p["full_copy"] = f"{p.get('title', '')}\n\n{p.get('body', '')}\n\n{p.get('hashtags', '')}"

        # 图片绝对路径
        img_file = POSTS_DIR / (p.get("file") or "")
        if img_file.exists():
            p["img_abs"] = str(img_file.resolve())
        else:
            p["img_abs"] = None

    return posts


# ═══════════════════════════════════════════════════════════════════════════════════
# §3 Browser Use Agent 发帖
# ═══════════════════════════════════════════════════════════════════════════════════

def build_task(post: dict, idx: int, total: int) -> str:
    """为单篇帖子构建 Browser Use Agent 的任务描述（中文）"""
    title = post.get("title", "")
    copy_text = post.get("full_copy", "")
    img_path = post.get("img_abs", "")
    city = post.get("cityId", "")

    # 文案分离：第一行=标题 → 第二段开始=正文 → 最后=话题标签
    lines = copy_text.split("\n")
    post_title = lines[0].strip() if lines else title

    # 找出正文和标签
    body_lines = []
    hashtags = post.get("hashtags", "")
    for line in lines[1:]:
        stripped = line.strip()
        if stripped.startswith("#"):
            hashtags = stripped if not hashtags else hashtags
        elif stripped or not body_lines:  # 跳过连续空行
            body_lines.append(line)

    body = "\n".join(body_lines).strip()

    task = f"""你是一个小红书内容发布助手。请完成以下操作来发布一篇晚霞预报笔记：

【目标网站】
小红书创作者平台: https://creator.xiaohongshu.com

【发布内容】
- 标题: {post_title}
- 正文:
{body}
- 话题标签: {hashtags}
- 图片文件: {img_path}

【操作步骤】
1. 首先检查是否已登录 —— 如果页面直接显示创作者中心（不是登录页），说明已登录，直接继续。
2. 点击「发布笔记」或「+」按钮进入发帖页面。
3. 上传图片 —— 点击图片上传区域，选择文件 "{img_path}"。如果无法直接选择文件，尝试拖拽或其他上传方式。
4. 在标题输入框中填入标题: {post_title}
5. 在正文/内容编辑区填入正文内容（包含话题标签: {hashtags}）
6. 检查预览无误后，点击「发布」按钮
7. 确认发布成功后，报告结果

【注意事项】
- 如果弹出手机扫码验证，说明 cookie 已过期，报告需要重新获取
- 如果发布按钮灰掉不可点击，检查是否漏填了必填字段（标题、图片）
- 发布完成后请确认页面出现「发布成功」或笔记出现在列表页
- 正文中的 emoji 保留（🔥🌅🌇☁️📊📈📍💡🎨🕐⚠️📸）
"""
    return task


async def post_one(
    post: dict,
    idx: int,
    total: int,
    headless: bool = True,
    max_steps: int = 25,
) -> dict:
    """使用 Browser Use Agent 发布单篇小红书笔记"""
    from browser_use import Agent, Browser, ChatAnthropic

    task_desc = build_task(post, idx, total)
    img_path = post.get("img_abs", "")

    print(f"\n{'─' * 60}")
    print(f"[{idx + 1}/{total}] 📱 {post.get('title', '')[:30]}")
    print(f"   图片: {post.get('file', '')}")

    # ── Browser 配置 ──
    browser = Browser(
        headless=headless,
        storage_state=str(STORAGE_STATE) if STORAGE_STATE.exists() else None,
        window_size={"width": 1440, "height": 900},
        keep_alive=False,  # 每篇独立 session
        disable_security=False,  # 保持安全特性，减少风控触发
    )

    # ── LLM 配置 ──
    # 🔴 claude-sonnet-4-0 默认启用扩展思考，但扩展思考不支持强制 tool_choice
    # 必须显式传递 thinking={"type": "disabled"} 关闭
    llm = ChatAnthropic(
        model="claude-sonnet-4-0",
        temperature=0.0,
        thinking={"type": "disabled"},  # 🔴 关键：关闭扩展思考以支持 tool_choice
    )

    # ── Agent ──
    agent = Agent(
        task=task_desc,
        llm=llm,
        browser=browser,
        use_vision=True,  # 小红书 UI 复杂，需要视觉理解
        use_thinking=False,  # 🔴 修复：Claude 扩展思考模式不支持 tool_choice，必须关闭
        available_file_paths=[img_path] if img_path and Path(img_path).exists() else [],
        max_failures=3,
        max_actions_per_step=3,
        max_steps=max_steps,
        step_timeout=120,
        include_attributes=["title", "url", "text", "aria-label", "placeholder"],
    )

    try:
        result = await agent.run()
        final = ""
        if result:
            try:
                final = result.final_result() or ""
            except Exception:
                try:
                    final = str(result)
                except Exception:
                    final = "Agent 完成但无法解析结果"
        print(f"   ✅ Agent 完成: {final[:100] if final else '无输出'}...")
        return {"success": True, "post": post, "result": final}
    except Exception as e:
        print(f"   ❌ Agent 异常: {e}")
        return {"success": False, "post": post, "error": str(e)}


async def post_all(
    posts: list[dict],
    headless: bool = True,
    max_steps: int = 25,
    delay_between: int = 30,
) -> list[dict]:
    """逐篇发布所有帖子"""
    results = []
    total = len(posts)

    for i, post in enumerate(posts):
        result = await post_one(post, i, total, headless=headless, max_steps=max_steps)
        results.append(result)

        # 非最后一篇时等待（小红书限流保护）
        if i < total - 1 and delay_between > 0:
            print(f"\n   ⏳ 等待 {delay_between}s 防止限流...")
            await asyncio.sleep(delay_between)

    return results


# ═══════════════════════════════════════════════════════════════════════════════════
# §4 Main
# ═══════════════════════════════════════════════════════════════════════════════════

async def main():
    parser = argparse.ArgumentParser(
        description="📱 晚霞预报 → 小红书一键发帖 (Browser Use)",
    )
    parser.add_argument("--headless", type=str, default="true", choices=["true", "false"],
                        help="无头模式 (默认 true)")
    parser.add_argument("--limit", type=int, default=None,
                        help="最多发布 N 篇 (默认全部)")
    parser.add_argument("--post-idx", type=int, default=None,
                        help="只发布第 N 篇 (0-indexed)")
    parser.add_argument("--max-steps", type=int, default=25,
                        help="Agent 每篇最大步数 (默认 25)")
    parser.add_argument("--delay-between", type=int, default=30,
                        help="篇间延迟秒数 (默认 30s，防限流)")
    parser.add_argument("--dry-run", action="store_true",
                        help="只打印不执行")
    parser.add_argument("--setup", action="store_true",
                        help="交互式 Cookie 导出模式（手动登录）")
    args = parser.parse_args()

    # ── Setup mode ──
    if args.setup:
        await setup_xhs_auth()
        return

    headless = args.headless == "true"

    print("╔══════════════════════════════════════════════╗")
    print("║  📱 晚霞预报 · 小红书 Browser Use 发帖      ║")
    print("╚══════════════════════════════════════════════╝")

    # ── Step 1: 加载环境 ──
    env = load_env()
    anthropic_key = env.get("ANTHROPIC_API_KEY", "")
    if not anthropic_key:
        print("❌ 未找到 ANTHROPIC_API_KEY，Browser Use 需要 Claude API")
        sys.exit(1)

    # Cookie：优先用 setup 导出的 storage_state，否则从 .env 转换（作为回退）
    if STORAGE_STATE.exists():
        mtime = STORAGE_STATE.stat().st_mtime
        age_h = (datetime.now().timestamp() - mtime) / 3600
        if age_h < 24:
            print(f"   ✅ 使用已导出的 storage_state ({age_h:.1f}h 前)")
        else:
            print(f"   ⚠️  storage_state 已过期 ({age_h:.1f}h 前)，从 .env 重新生成...")
            cookie_str = env.get("XIAOHONGSHU_COOKIE", "")
            if cookie_str:
                save_storage_state(cookie_str)
    else:
        cookie_str = env.get("XIAOHONGSHU_COOKIE", "")
        if cookie_str:
            save_storage_state(cookie_str)
        else:
            print("❌ 未找到 XIAOHONGSHU_COOKIE 且无 storage_state")
            print("   请先运行: python scripts/post_xhs_browseruse.py --setup")
            sys.exit(1)

    # ── Step 2: 加载帖子 ──
    posts = load_posts(limit=args.limit, post_idx=args.post_idx)
    print(f"\n📋 加载了 {len(posts)} 篇帖子:")
    for i, p in enumerate(posts):
        print(f"   [{i}] {p.get('file', '?')} — {p.get('title', '?')[:40]}")

    if args.dry_run:
        print("\n🔍 Dry-run 模式，不实际发帖。退出。")
        return

    # ── Step 3: 开始发帖 ──
    print(f"\n🚀 开始发布 (headless={headless}, max_steps={args.max_steps})...")
    t_start = datetime.now()

    results = await post_all(
        posts,
        headless=headless,
        max_steps=args.max_steps,
        delay_between=args.delay_between,
    )

    t_end = datetime.now()

    # ── Step 4: 汇总 ──
    ok = sum(1 for r in results if r.get("success"))
    fail = len(results) - ok

    print(f"\n{'═' * 60}")
    print(f"📊 发帖完成: {ok} 成功, {fail} 失败")
    print(f"⏱️  耗时: {(t_end - t_start).total_seconds():.0f}s")

    # 失败列表
    if fail > 0:
        print(f"\n❌ 失败帖子:")
        for r in results:
            if not r.get("success"):
                print(f"   - {r['post'].get('title', '?')[:30]}: {r.get('error', '未知')}")

    # 保存发帖记录
    record = {
        "published_at": datetime.now().isoformat(),
        "total": len(results),
        "ok": ok,
        "fail": fail,
        "posts": [
            {
                "file": r["post"].get("file", ""),
                "title": r["post"].get("title", ""),
                "success": r.get("success", False),
                "error": r.get("error", ""),
            }
            for r in results
        ],
    }
    record_file = POSTS_DIR / f"publish-record-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    with open(record_file, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2, ensure_ascii=False)
    print(f"\n📝 发帖记录已保存: {record_file}")


if __name__ == "__main__":
    asyncio.run(main())
