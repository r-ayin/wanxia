#!/usr/bin/env python3
"""测试 Playwright 定位策略 — XHS 发布页"""
import asyncio, sys
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
STORAGE_STATE = ROOT / "scripts" / ".xhs_storage_state.json"

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        ctx = await browser.new_context(
            storage_state=str(STORAGE_STATE),
            viewport={"width": 1440, "height": 900}, locale="zh-CN")
        page = await ctx.new_page()

        # 先去首页验证登录，再导航到发布页
        await page.goto("https://creator.xiaohongshu.com/new/home", timeout=30000)
        await page.wait_for_timeout(3000)
        print(f"Home: {page.url[:80]}")

        # 通过点击进入发布页
        pub_btn = page.locator("text=发布图文笔记").first
        if await pub_btn.count() > 0:
            await pub_btn.click()
            print("Clicked 发布图文笔记")
        await page.wait_for_timeout(5000)
        print(f"Publish URL: {page.url[:100]}")

        # 上传封面图
        covers = sorted((ROOT / "posts" / "covers").glob("*.png"))
        if covers:
            fi = page.locator('input[type="file"]').first
            if await fi.count() > 0:
                await fi.set_input_files(str(covers[0]))
                print(f"Uploaded: {covers[0].name}")
                await page.wait_for_timeout(5000)

        # 测试各种定位策略
        tests = [
            # 标题
            ('get_by_placeholder("标题")', lambda: page.get_by_placeholder("标题").count()),
            ('get_by_placeholder("填写标题")', lambda: page.get_by_placeholder("填写标题").count()),
            ('locator("[placeholder*=\\"标题\\"]")', lambda: page.locator('[placeholder*="标题"]').count()),
            # 正文
            ('get_by_placeholder("正文")', lambda: page.get_by_placeholder("正文").count()),
            ('get_by_placeholder("填写正文")', lambda: page.get_by_placeholder("填写正文").count()),
            ('locator("[placeholder*=\\"正文\\"]")', lambda: page.locator('[placeholder*="正文"]').count()),
            # contenteditable
            ('locator("[contenteditable=\\"true\\"]")', lambda: page.locator('[contenteditable="true"]').count()),
            # 发布
            ('get_by_role("button", name="发布")', lambda: page.get_by_role("button", name="发布").count()),
            ('locator("button:has-text(\\"发布\\")")', lambda: page.locator('button:has-text("发布")').count()),
            ('locator("text=发布").last', lambda: page.locator("text=发布").count()),
            # 所有 textbox
            ('get_by_role("textbox")', lambda: page.get_by_role("textbox").count()),
        ]

        print("\n定位策略测试:")
        for name, fn in tests:
            try:
                count = await fn()
                el = None
                if count > 0:
                    if "placeholder" in name:
                        el = page.get_by_placeholder(name.split('"')[1]) if '"' in name else None
                    elif "role" in name and "textbox" in name:
                        el = page.get_by_role("textbox").first
                    elif "role" in name:
                        el = page.get_by_role("button", name="发布").first if "发布" in name else None
                    if el:
                        try:
                            tag = await el.evaluate("el => el.tagName + (el.type ? '['+el.type+']' : '')")
                            visible = await el.is_visible()
                            print(f"  ✅ {name}: {count} 个 (tag={tag}, visible={visible})")
                        except:
                            print(f"  ✅ {name}: {count} 个")
                    else:
                        print(f"  ✅ {name}: {count} 个")
                else:
                    print(f"  ❌ {name}: 0 个")
            except Exception as e:
                print(f"  ⚠️  {name}: {str(e)[:80]}")

        # 截图
        await page.screenshot(path=str(ROOT / "posts" / "diag" / "locator-test.png"))
        await browser.close()

asyncio.run(main())
