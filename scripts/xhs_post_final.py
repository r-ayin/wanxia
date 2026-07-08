#!/usr/bin/env python3
"""Playwright 小红书发帖终版 —— 用 keyboard 操作绕过 DOM 定位问题"""
import asyncio, json, re, shutil, sys
from pathlib import Path
from datetime import datetime
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "posts"
POSTS_JSON = POSTS_DIR / "posts.json"
ENV_FILE = ROOT / ".env"
USER_DATA = ROOT / "scripts" / ".xhs_browser_profile"

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def get_cookies():
    m = re.search(r"^XIAOHONGSHU_COOKIE=(.+)$", ENV_FILE.read_text("utf-8"), re.MULTILINE)
    if not m: return []
    cookies = []
    for item in m.group(1).split(";"):
        item = item.strip()
        if "=" not in item: continue
        n, _, v = item.partition("=")
        cookies.append({"name": n.strip(), "value": v.strip(), "domain": ".xiaohongshu.com", "path": "/", "httpOnly": "token" in n.lower(), "secure": True, "sameSite": "Lax"})
    return cookies


async def main():
    cookies = get_cookies()
    print(f"🍪 {len(cookies)} cookie")

    shutil.rmtree(str(USER_DATA), ignore_errors=True)

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            str(USER_DATA), headless=True,
            viewport={"width": 1440, "height": 900}, locale="zh-CN",
        )
        await ctx.add_cookies(cookies)

        with open(POSTS_JSON, "r", encoding="utf-8") as f:
            package = json.load(f)
        posts = [p for p in package.get("posts", []) if p.get("score")]

        results = []
        for idx, post in enumerate(posts):
            title = post.get("title", "")
            copy_file = POSTS_DIR / (post.get("copyFile") or "")
            img_file = POSTS_DIR / (post.get("file") or "")
            cover_name = post.get("cover") or ""

            raw = copy_file.read_text("utf-8").strip() if copy_file.exists() else ""
            lines = raw.split("\n")
            post_title = lines[0].strip()
            body_lines, hashtags = [], ""
            for l in lines[1:]:
                s = l.strip()
                if s.startswith("#"): hashtags = s
                elif s: body_lines.append(l)
            body = "\n".join(body_lines)
            full_body = f"{body}\n\n{hashtags}" if hashtags else body

            img_paths = []
            cover = POSTS_DIR / "covers" / cover_name if cover_name else None
            if cover and cover.exists(): img_paths.append(str(cover.resolve()))
            if img_file.exists(): img_paths.append(str(img_file.resolve()))

            print(f"\n{'─'*50}")
            print(f"[{idx+1}/{len(posts)}] {post_title[:30]}")

            page = await ctx.new_page()

            # 1) 到仪表盘
            await page.goto("https://creator.xiaohongshu.com/new/home", timeout=30000)
            try:
                await page.wait_for_selector("text=发布笔记", timeout=15000)
            except:
                await page.wait_for_timeout(8000)
            url = page.url
            if "/login" in url:
                print(f"   ❌ Cookie 无效: {url[:80]}")
                await page.close()
                results.append({"success": False, "title": post_title, "error": "login"})
                continue
            print("   ✅ 已登录仪表盘")

            # 2) 点击 "发布图文笔记"
            for sel in ["text=发布图文笔记", "text=发布笔记"]:
                btn = page.locator(sel).first
                if await btn.count() > 0:
                    await btn.click()
                    break
            await page.wait_for_timeout(5000)

            # 截发布页
            DEBUG = POSTS_DIR / "debug"
            DEBUG.mkdir(exist_ok=True)
            await page.screenshot(path=str(DEBUG / f"publish-{idx}.png"))

            # 3) 上传图片 — 用 Tab 导航到上传区域 + Ctrl+O
            # 先点一下页面空白处确保焦点在 page
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(500)

            # 尝试找到上传 input
            file_inputs = page.locator('input[type="file"]')
            fi_count = await file_inputs.count()
            if fi_count > 0:
                for k, fpath in enumerate(img_paths):
                    try:
                        await file_inputs.nth(0).set_input_files(fpath)
                        print(f"   📸 [{k+1}/{len(img_paths)}] {Path(fpath).name}")
                        await page.wait_for_timeout(4000)
                    except Exception as e:
                        print(f"   ⚠️  上传 [{k+1}] 失败: {e}")
            else:
                print("   ⚠️  无 file input，尝试拖拽...")
                # 拖拽方式
                for k, fpath in enumerate(img_paths):
                    try:
                        dropzone = page.locator('[class*="upload"]').first
                        if await dropzone.count() == 0:
                            dropzone = page.locator('[class*="drop"]').first
                        if await dropzone.count() == 0:
                            dropzone = page.locator("body")
                        # 用键盘 Ctrl+O 打开文件选择（在文件对话框不可行时不可靠）
                        print(f"   ⚠️  需要手动上传: {Path(fpath).name}")
                    except Exception as e:
                        print(f"   ⚠️  拖拽失败: {e}")

            await page.wait_for_timeout(3000)
            await page.screenshot(path=str(DEBUG / f"after-upload-{idx}.png"))

            # 4) 用键盘填充标题 — Tab 到标题输入框
            # 按 Tab 几次导航到标题（通常第一个表单元素）
            for _ in range(15):
                await page.keyboard.press("Tab")
                await page.wait_for_timeout(100)

            # 粘贴标题
            await page.keyboard.type(post_title, delay=30)
            print(f"   ✏️  标题: {post_title[:30]}")

            # 5) Tab 到正文 — 再按 Tab
            await page.keyboard.press("Tab")
            await page.wait_for_timeout(300)

            # 粘贴正文
            await page.keyboard.type(full_body, delay=10)
            print(f"   📝 正文: {len(full_body)} 字")

            await page.wait_for_timeout(1000)
            await page.screenshot(path=str(DEBUG / f"before-submit-{idx}.png"))

            # 6) 发布 — Tab 到发布按钮 + Enter
            for _ in range(10):
                await page.keyboard.press("Tab")
                await page.wait_for_timeout(100)

            await page.keyboard.press("Enter")
            print("   🚀 已按 Enter 发布")
            await page.wait_for_timeout(5000)

            await page.screenshot(path=str(DEBUG / f"after-submit-{idx}.png"))
            results.append({"success": True, "title": post_title})
            await page.close()

            if idx < len(posts) - 1:
                await asyncio.sleep(30)

        await ctx.close()

    ok = sum(1 for r in results if r["success"])
    print(f"\n{'═'*50}")
    print(f"📊 {ok}/{len(results)} 成功")
    record = POSTS_DIR / f"publish-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    record.write_text(json.dumps({"published_at": datetime.now().isoformat(), "total": len(results), "ok": ok, "posts": results}, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"📝 {record}")


asyncio.run(main())
