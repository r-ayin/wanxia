#!/usr/bin/env python3
"""Playwright 小红书发帖 v3 — 等 React 渲染 + 精准定位"""
import asyncio, json, sys
from pathlib import Path
from datetime import datetime
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "posts"
STORAGE_STATE = ROOT / "scripts" / ".xhs_storage_state.json"
COVER_DIR = POSTS_DIR / "covers"
POSTS_JSON = POSTS_DIR / "posts.json"

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

async def main():
    with open(POSTS_JSON, "r", encoding="utf-8") as f:
        package = json.load(f)
    city_posts = [p for p in package.get("posts", []) if p.get("score")]

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            storage_state=str(STORAGE_STATE),
            viewport={"width": 1440, "height": 900},
            locale="zh-CN",
        )
        page = await ctx.new_page()
        results = []

        for idx, post in enumerate(city_posts):
            title = post.get("title", "")
            copy_file = POSTS_DIR / (post.get("copyFile") or "")
            img_file = POSTS_DIR / (post.get("file") or "")
            cover_name = post.get("cover") or ""

            # 读文案
            raw = copy_file.read_text("utf-8").strip() if copy_file.exists() else ""
            lines = raw.split("\n")
            post_title = lines[0].strip()
            body_lines, hashtags = [], ""
            for l in lines[1:]:
                s = l.strip()
                if s.startswith("#"): hashtags = s
                elif s: body_lines.append(l)
            body = "\n".join(body_lines).strip()
            full_body = f"{body}\n\n{hashtags}" if hashtags else body

            # 图片
            img_paths = []
            cover_path = COVER_DIR / cover_name if cover_name else None
            if cover_path and cover_path.exists():
                img_paths.append(str(cover_path.resolve()))
            if img_file.exists():
                img_paths.append(str(img_file.resolve()))

            print(f"\n{'─'*50}")
            print(f"[{idx+1}/{len(city_posts)}] {post_title[:30]}")

            # 1) 到仪表盘
            await page.goto("https://creator.xiaohongshu.com/new/home", timeout=30000)
            try:
                await page.wait_for_selector("text=发布笔记", timeout=15000)
            except:
                print("   ⚠️  仪表盘加载超时")
            await page.wait_for_timeout(2000)

            # 2) 点发布笔记/发布图文笔记
            pub_btn = page.locator("text=发布图文笔记").first
            if await pub_btn.count() == 0:
                pub_btn = page.locator("text=发布笔记").first
            if await pub_btn.count() > 0:
                await pub_btn.click()
                print("   ✅ 进入发布页")
            else:
                print("   ❌ 找不到发布入口")
                continue

            # 3) 等待发布页渲染
            await page.wait_for_timeout(4000)
            await page.screenshot(path=str(POSTS_DIR / "debug" / f"publish-{idx}.png"))

            # 4) 上传图片（文件输入框）
            file_input = page.locator('input[type="file"]').first
            if await file_input.count() > 0:
                for k, fpath in enumerate(img_paths):
                    try:
                        await file_input.set_input_files(fpath)
                        print(f"   📸 [{k+1}/{len(img_paths)}] {Path(fpath).name}")
                        await page.wait_for_timeout(3000)
                    except Exception as e:
                        print(f"   ⚠️  上传失败 [{k+1}]: {e}")
                await page.wait_for_timeout(3000)
            else:
                print("   ❌ 找不到上传控件")

            # 5) 填写标题
            try:
                title_sel = page.locator('[placeholder*="标题"]').first
                if await title_sel.count() == 0:
                    title_sel = page.locator('[id*="title"]').first
                await title_sel.click()
                await page.wait_for_timeout(300)
                await page.keyboard.type(post_title, delay=50)
                print(f"   ✏️  标题: {post_title[:30]}")
            except Exception as e:
                print(f"   ⚠️  标题填写失败: {e}")

            # 6) 填写正文
            try:
                body_sel = page.locator('[placeholder*="正文"]').first
                if await body_sel.count() == 0:
                    body_sel = page.locator('[placeholder*="内容"]').first
                if await body_sel.count() == 0:
                    body_sel = page.locator('[contenteditable="true"]').first
                await body_sel.click()
                await page.wait_for_timeout(300)
                await page.keyboard.type(full_body, delay=20)
                print(f"   📝 正文: {len(full_body)} 字")
            except Exception as e:
                print(f"   ⚠️  正文填写失败: {e}")

            # 7) 截图确认
            await page.screenshot(path=str(POSTS_DIR / "debug" / f"before-publish-{idx}.png"))

            # 8) 发布
            try:
                submit = page.locator("button:has-text('发布')").last
                if await submit.count() == 0:
                    submit = page.locator("text=发布").last
                if await submit.count() > 0:
                    disabled = await submit.is_disabled()
                    if not disabled:
                        await submit.click()
                        print("   🚀 已点击发布")
                        await page.wait_for_timeout(5000)
                        results.append({"success": True, "title": post_title})
                    else:
                        print("   ⚠️  发布按钮禁用")
                        results.append({"success": False, "title": post_title, "error": "disabled"})
                else:
                    print("   ❌ 找不到发布按钮")
                    results.append({"success": False, "title": post_title, "error": "no submit btn"})
            except Exception as e:
                print(f"   ❌ 发布异常: {e}")
                results.append({"success": False, "title": post_title, "error": str(e)})

            if idx < len(city_posts) - 1:
                await asyncio.sleep(30)

        await browser.close()

    ok = sum(1 for r in results if r.get("success"))
    print(f"\n{'═'*50}")
    print(f"📊 发帖完成: {ok} 成功, {len(results)-ok} 失败")
    record_file = POSTS_DIR / f"publish-record-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    with open(record_file, "w", encoding="utf-8") as f:
        json.dump({"published_at": datetime.now().isoformat(), "total": len(results), "ok": ok, "posts": results}, f, indent=2, ensure_ascii=False)
    print(f"📝 记录: {record_file}")

asyncio.run(main())
