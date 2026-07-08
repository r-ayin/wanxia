#!/usr/bin/env python3
"""Playwright 直连发帖 v2 — 先探路截图，再精准填写"""
import asyncio, json, sys
from pathlib import Path
from datetime import datetime
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "posts"
POSTS_JSON = POSTS_DIR / "posts.json"
STORAGE_STATE = ROOT / "scripts" / ".xhs_storage_state.json"
COVER_DIR = POSTS_DIR / "covers"
DEBUG_DIR = POSTS_DIR / "debug"

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

async def main():
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)

    with open(POSTS_JSON, "r", encoding="utf-8") as f:
        package = json.load(f)
    posts = [p for p in package.get("posts", []) if p.get("score")]

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            storage_state=str(STORAGE_STATE),
            viewport={"width": 1440, "height": 900},
            locale="zh-CN",
        )
        page = await ctx.new_page()

        # 1) 导航到首页
        await page.goto("https://creator.xiaohongshu.com", timeout=30000)
        await page.wait_for_timeout(3000)
        await page.screenshot(path=str(DEBUG_DIR / "01-home.png"))
        print(f"📸 首页截图: {page.url[:80]}")

        # 2) 点击发布笔记
        # 尝试多种可能的按钮
        clicked = False
        for selector in [
            "text=发布笔记",
            "a:has-text('发布笔记')",
            "span:has-text('发布笔记')",
            "[class*='publish']",
            "[class*='creator'] [class*='btn']",
        ]:
            btn = page.locator(selector).first
            if await btn.count() > 0:
                await btn.click()
                clicked = True
                print(f"✅ 点击发布按钮: {selector}")
                break

        if not clicked:
            # Try navigating directly
            await page.goto("https://creator.xiaohongshu.com/publish", timeout=30000)

        await page.wait_for_timeout(4000)
        await page.screenshot(path=str(DEBUG_DIR / "02-publish-page.png"))
        print(f"📸 发布页截图: {page.url[:80]}")

        # 3) 找所有可交互元素
        inputs = page.locator("input")
        input_count = await inputs.count()
        print(f"\n🔍 找到 {input_count} 个 input:")
        for i in range(min(input_count, 20)):
            inp = inputs.nth(i)
            tp = await inp.get_attribute("type") or "text"
            ph = await inp.get_attribute("placeholder") or ""
            acc = await inp.get_attribute("accept") or ""
            cls = await inp.get_attribute("class") or ""
            print(f"  [{i}] type={tp} placeholder={ph[:40]} accept={acc[:30]}")

        textareas = page.locator("textarea")
        ta_count = await textareas.count()
        print(f"\n🔍 找到 {ta_count} 个 textarea")

        editables = page.locator('[contenteditable="true"]')
        ed_count = await editables.count()
        print(f"\n🔍 找到 {ed_count} 个 contenteditable")

        # 4) 截取完整页面源码用于调试
        html = await page.content()
        (DEBUG_DIR / "03-page-source.html").write_text(html, encoding="utf-8")
        print(f"\n📝 页面源码已保存: {DEBUG_DIR / '03-page-source.html'}")

        await browser.close()
        print("\n✅ 探路完成，请检查 debug/ 目录下的截图和源码")

asyncio.run(main())
