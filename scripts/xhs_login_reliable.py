#!/usr/bin/env python3
"""可靠的小红书登录 → 检测到仪表盘才导出 cookie"""
import asyncio, json, sys
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
STORAGE_STATE = ROOT / "scripts" / ".xhs_storage_state.json"
ENV_FILE = ROOT / ".env"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        ctx = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            locale="zh-CN",
        )
        page = await ctx.new_page()
        await page.goto("https://creator.xiaohongshu.com", wait_until="domcontentloaded")

        print("✅ 浏览器已打开 → 请扫码登录")
        print("   等待登录完成（自动检测）...")

        # 等待 URL 从 /login 变成仪表盘
        for i in range(300):  # 最多等 10 分钟
            await asyncio.sleep(2)
            url = page.url
            if "/login" not in url and "creator" in url:
                print(f"✅ 登录成功！当前页: {url[:80]}")
                break
            if i % 15 == 0:
                print(f"   ⏳ 等待中... ({url[:60]})")
        else:
            print("❌ 超时 — 10 分钟内未检测到登录成功")
            await browser.close()
            return

        # 登录成功 → 导出
        await page.wait_for_timeout(2000)
        await ctx.storage_state(path=str(STORAGE_STATE))
        print(f"✅ storage_state 已导出 ({STORAGE_STATE.stat().st_size} bytes)")

        # 导出 cookie 字符串
        cookies = await ctx.cookies()
        cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies if c.get("name"))
        print(f"📋 {len(cookies)} 个 cookie")

        # 更新 .env
        import re
        content = ENV_FILE.read_text(encoding="utf-8")
        new_content = re.sub(
            r"^XIAOHONGSHU_COOKIE=.*$",
            f"XIAOHONGSHU_COOKIE={cookie_str}",
            content, flags=re.MULTILINE,
        )
        if new_content != content:
            ENV_FILE.write_text(new_content, encoding="utf-8")
            print("✅ .env 已更新")

        print("✅ 完成！关闭浏览器...")
        await browser.close()

asyncio.run(main())
