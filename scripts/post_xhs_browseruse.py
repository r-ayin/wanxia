#!/usr/bin/env python3
"""小红书 Browser Use 发帖 v5 — 防覆写 + 自动登录检测"""
import argparse, asyncio, json, os, re, shutil, sys
from datetime import datetime
from pathlib import Path
from browser_use import Agent, Browser, ChatAnthropic

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
BASE_POSTS_DIR = ROOT / "posts"
POSTS_DIR = BASE_POSTS_DIR  # 可被 --date 覆盖
POSTS_JSON = POSTS_DIR / "posts.json"
ENV_FILE = ROOT / ".env"
STORAGE_STATE = ROOT / "scripts" / ".xhs_storage_state.json"
STORAGE_BAK = ROOT / "scripts" / ".xhs_storage_state.json.bak"


def load_env():
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text("utf-8").split("\n"):
            line = line.strip()
            if not line or line.startswith("#"): continue
            if "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
    for k, v in os.environ.items():
        env.setdefault(k, v)
    return env


# ═══════════════════════════════════════
# §1 登录（Playwright 自动检测）
# ═══════════════════════════════════════

async def setup_xhs_auth():
    """Playwright 登录 → 自动检测 → 导出 storage_state + .bak"""
    from playwright.async_api import async_playwright

    print("🚀 打开浏览器 → 请扫码登录小红书创作者平台")
    print("⏳ 自动检测登录完成...\n")

    for f in (STORAGE_STATE, STORAGE_BAK):
        try:
            if sys.platform == "win32" and f.exists():
                import os as _os; _os.chmod(str(f), 0o666)
            f.unlink(missing_ok=True)
        except: pass

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            str(ROOT / "scripts" / ".xhs_chrome_profile"),
            headless=False, viewport={"width": 1440, "height": 900}, locale="zh-CN")
        page = await ctx.new_page()
        await page.goto("https://creator.xiaohongshu.com", timeout=30000)

        for i in range(120):
            await asyncio.sleep(3)
            if "/login" not in page.url:
                print(f"✅ 登录成功 ({page.url[:60]})")
                break
            if i % 15 == 0: print(f"   ⏳ {page.url[:50]}")

        await asyncio.sleep(3)

        # 导出 Playwright storage_state
        await ctx.storage_state(path=str(STORAGE_STATE))
        # 导出 .env cookie
        cookies = await ctx.cookies()
        cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies if c.get("name"))
        content = ENV_FILE.read_text("utf-8")
        nc = re.sub(r"^XIAOHONGSHU_COOKIE=.*$", f"XIAOHONGSHU_COOKIE={cookie_str}", content, flags=re.MULTILINE)
        if nc != content: ENV_FILE.write_text(nc, "utf-8")

        # 🔴 备份（只读，永不传给 Browser Use）
        shutil.copy(STORAGE_STATE, STORAGE_BAK)
        import os as _os; _os.chmod(str(STORAGE_BAK), 0o444)

        await ctx.close()

    print(f"✅ storage_state: {STORAGE_STATE.stat().st_size} bytes")
    print(f"✅ 备份(只读): {STORAGE_BAK.stat().st_size} bytes")
    print(f"✅ .env 已更新 ({len(cookies)} cookie)")
    print("✅ Setup 完成！")


# ═══════════════════════════════════════
# §2 加载帖子
# ═══════════════════════════════════════

def load_posts(limit=None, post_idx=None):
    if not POSTS_JSON.exists():
        print(f"❌ posts.json 不存在"); sys.exit(1)
    with open(POSTS_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)
    posts = data.get("posts", [])
    if post_idx is not None and 0 <= post_idx < len(posts):
        posts = [posts[post_idx]]
    elif limit:
        posts = posts[:limit]
    for p in posts:
        cf = POSTS_DIR / (p.get("copyFile") or "")
        p["full_copy"] = cf.read_text("utf-8").strip() if cf.exists() else p.get("title", "")
        cover = p.get("cover") or ""
        cp = POSTS_DIR / "covers" / cover if cover else None
        p["cover_abs"] = str(cp.resolve()) if cp and cp.exists() else None
        img = POSTS_DIR / (p.get("file") or "")
        p["img_abs"] = str(img.resolve()) if img.exists() else None
    return posts


# ═══════════════════════════════════════
# §3 发帖
# ═══════════════════════════════════════

def build_task(post, idx, total):
    lines = post.get("full_copy", "").split("\n")
    ptitle = lines[0].strip()
    body_lines, hashtags = [], ""
    for l in lines[1:]:
        s = l.strip()
        if s.startswith("#"): hashtags = s
        elif s: body_lines.append(l)
    full_body = "\n".join(body_lines) + "\n\n" + hashtags if hashtags else "\n".join(body_lines)

    imgs = []
    if post.get("cover_abs"): imgs.append(Path(post["cover_abs"]).name)
    if post.get("img_abs"): imgs.append(Path(post["img_abs"]).name)
    img_list = ", ".join(imgs)
    cover_note = "\n（先上传封面图，再上传截图）" if post.get("cover_abs") else ""

    return f"""在已登录的小红书创作者平台发布一篇晚霞笔记。

1. 导航到 https://creator.xiaohongshu.com/new/home（已登录，看到仪表盘）
2. 点击「发布图文笔记」
3. 上传图片: {img_list}{cover_note}
4. 标题: {ptitle}
5. 正文: {full_body[:500]}
6. 点击「发布」按钮
7. 确认发布成功

emoji保留。如果看到登录页说明cookie过期。"""


async def post_one(post, idx, total, headless):
    cover = post.get("cover_abs", "")
    img = post.get("img_abs", "")
    available = [p for p in [cover, img] if p]

    print(f"\n{'─'*50}")
    print(f"[{idx+1}/{total}] {post.get('title','')[:35]}")

    # 🔴 核心：从 .bak 复制临时文件给 Browser Use
    if not STORAGE_BAK.exists():
        print("   ❌ .bak 不存在，请先 --setup")
        return {"success": False, "error": "no bak"}
    tmp = STORAGE_STATE.with_suffix(".tmp.json")
    tmp.unlink(missing_ok=True)
    shutil.copy(STORAGE_BAK, tmp)
    import os as _os; _os.chmod(str(tmp), 0o666)

    try:
        browser = Browser(headless=headless, storage_state=str(tmp),
                          window_size={"width": 1440, "height": 900},
                          keep_alive=False, disable_security=True)
        llm = ChatAnthropic(model="claude-sonnet-4-0", temperature=0.0, thinking={"type": "disabled"})
        agent = Agent(task=build_task(post, idx, total), llm=llm, browser=browser,
                      use_vision=True, use_thinking=False,
                      available_file_paths=available,
                      max_failures=2, max_actions_per_step=3)

        result = await agent.run()
        final = ""
        try: final = result.final_result() or ""
        except: pass
        print(f"   {final[:200]}")

        # 智能判断成功/失败（基于 Agent 最终回复的关键词）
        fail_kw = ["无法完成", "登录已过期", "登录页", "cookie", "失败",
                   "登录页面", "登录过期", "cannot complete", "login page"]
        ok_kw = ["发布成功", "已发布", "publish", "success", "完成发布"]
        lower = final.lower()
        is_success = any(k in lower for k in ok_kw) and not any(k in lower for k in fail_kw)
        return {"success": is_success, "title": post.get("title", ""), "result": final[:300]}
    except Exception as e:
        print(f"   ❌ {e}")
        return {"success": False, "title": post.get("title", ""), "error": str(e)}
    finally:
        tmp.unlink(missing_ok=True)  # 用完就删，不管被覆写成什么样


# ═══════════════════════════════════════
# §4 Main
# ═══════════════════════════════════════

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--headless", type=str, default="true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--post-idx", type=int, default=None)
    parser.add_argument("--delay-between", type=int, default=30)
    parser.add_argument("--setup", action="store_true")
    parser.add_argument("--date", type=str, default="", help="日期 YYYY-MM-DD，读取 posts/YYYY-MM-DD/ 下的素材")
    args = parser.parse_args()

    # 🔴 v3.1: 按日期读取素材
    global POSTS_DIR, POSTS_JSON
    if args.date:
        POSTS_DIR = BASE_POSTS_DIR / args.date
        POSTS_JSON = POSTS_DIR / "posts.json"
    else:
        # 自动找最新的日期目录
        subdirs = sorted([d for d in BASE_POSTS_DIR.iterdir() if d.is_dir()], reverse=True)
        if subdirs:
            POSTS_DIR = subdirs[0]
            POSTS_JSON = POSTS_DIR / "posts.json"

    if args.setup:
        await setup_xhs_auth()
        return

    headless = args.headless == "true"
    env = load_env()
    if not env.get("ANTHROPIC_API_KEY"):
        print("❌ 未找到 ANTHROPIC_API_KEY"); sys.exit(1)

    if not STORAGE_BAK.exists():
        print("❌ .bak 不存在，请先 --setup"); sys.exit(1)

    age_h = (datetime.now().timestamp() - STORAGE_BAK.stat().st_mtime) / 3600
    print(f"✅ .bak ({age_h:.1f}h 前, {STORAGE_BAK.stat().st_size} bytes)")

    posts = load_posts(limit=args.limit, post_idx=args.post_idx)
    print(f"📋 {len(posts)} 篇")

    t0 = datetime.now()
    results = []
    for i, p in enumerate(posts):
        results.append(await post_one(p, i, len(posts), headless))
        if i < len(posts) - 1: await asyncio.sleep(args.delay_between)

    ok = sum(1 for r in results if r["success"])
    print(f"\n{'═'*50}\n📊 {ok}/{len(results)} ({ (datetime.now()-t0).total_seconds():.0f}s)")

    record = POSTS_DIR / f"publish-record-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    record.write_text(json.dumps({"published_at": datetime.now().isoformat(), "total": len(results), "ok": ok, "posts": results}, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
