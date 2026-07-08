#!/usr/bin/env python3
"""预置 cookie 到持久化目录 → Browser Use 直接用，避免 storage_state 冲突"""
import asyncio, json, re, shutil, sys
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"
STORAGE_STATE = ROOT / "scripts" / ".xhs_storage_state.json"
# 持久化 user_data_dir（预置 cookie 后 Browser Use 只传这个）
USER_DATA = ROOT / "scripts" / ".xhs_browser_profile"

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def get_cookies_from_env():
    """从 .env 解析 cookie 列表"""
    content = ENV_FILE.read_text("utf-8")
    m = re.search(r"^XIAOHONGSHU_COOKIE=(.+)$", content, re.MULTILINE)
    if not m:
        return []
    cookies = []
    for item in m.group(1).split(";"):
        item = item.strip()
        if "=" not in item:
            continue
        name, _, value = item.partition("=")
        cookies.append({
            "name": name.strip(), "value": value.strip(),
            "domain": ".xiaohongshu.com", "path": "/",
            "httpOnly": "token" in name.lower() or "session" in name.lower(),
            "secure": True, "sameSite": "Lax",
        })
    return cookies

async def setup():
    cookies = get_cookies_from_env()
    if not cookies:
        print("❌ .env 中无 XIAOHONGSHU_COOKIE")
        return False

    print(f"🍪 {len(cookies)} 个 cookie")

    # 清除旧目录（避免冲突）
    if USER_DATA.exists():
        shutil.rmtree(str(USER_DATA), ignore_errors=True)

    # 用 Playwright persistent context 启动 → 关闭即保存
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            str(USER_DATA),
            headless=True,
            viewport={"width": 1440, "height": 900},
            locale="zh-CN",
        )
        # 注入所有 cookie
        await ctx.add_cookies(cookies)
        page = await ctx.new_page()

        # 验证登录
        await page.goto("https://creator.xiaohongshu.com/new/home", timeout=30000)
        await page.wait_for_timeout(5000)
        url = page.url
        if "/login" in url:
            print(f"❌ Cookie 无效 ({url[:80]})")
            await ctx.close()
            shutil.rmtree(str(USER_DATA), ignore_errors=True)
            return False

        print(f"✅ 登录验证通过: {url[:60]}")
        await ctx.close()

    # 验证目录大小
    size = sum(f.stat().st_size for f in USER_DATA.rglob("*") if f.is_file())
    print(f"✅ user_data_dir 就绪: {USER_DATA} ({size/1024:.0f}KB)")
    return True

asyncio.run(setup())
