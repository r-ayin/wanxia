#!/usr/bin/env python3
"""
XHS CDP Mode poster — connect_over_cdp bypasses automation detection.

Design (based on docs/anti-detection-research.md):
  - User opens Chrome manually with --remote-debugging-port=9222
  - Script attaches via connect_over_cdp — NO launch(), NO automation flags
  - Uses existing browser profile (already logged into XHS creator studio)
  - Minimal CDP footprint: avoids Runtime.enable where possible

Usage:
  1. Start Chrome manually:
     "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
  2. Navigate to https://creator.xiaohongshu.com/ and log in
  3. Run: python scripts/xhs_cdp_poster.py

Requirements:
  pip install playwright
  playwright install chromium
"""

from __future__ import annotations

import asyncio, json, sys
from datetime import datetime
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "posts"
COVERS_DIR = POSTS_DIR / "covers"
DIAG_DIR = POSTS_DIR / "diag"
CDP_URL = "http://localhost:9222"

if sys.platform == "win32":
    try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except: pass


def find_latest_posts_json():
    date_dirs = sorted(
        [d for d in POSTS_DIR.iterdir()
         if d.is_dir() and (d / "posts.json").exists() and d.name not in ("diag","covers")],
        reverse=True)
    if date_dirs:
        d = date_dirs[0]
        covers = d / "covers" if (d / "covers").exists() else COVERS_DIR
        print(f"  dir: {d.name}")
        return d / "posts.json", covers
    flat = POSTS_DIR / "posts.json"
    if flat.exists(): return flat, COVERS_DIR
    raise FileNotFoundError("posts.json not found")


def load_posts(json_path):
    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)
    posts = data if isinstance(data, list) else data.get("posts", [])
    return [p for p in posts if p.get("title") and p.get("content")]


async def connect_via_cdp():
    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp(CDP_URL)
    print(f"  CDP connected: {CDP_URL}")
    pages = browser.contexts[0].pages if browser.contexts else []
    page = pages[0] if pages else await browser.contexts[0].new_page()
    print(f"  page: {page.url[:60]}")
    return browser, page


async def navigate_to_creator(page):
    if "creator.xiaohongshu.com" not in page.url:
        print("  -> creator studio...")
        await page.goto("https://creator.xiaohongshu.com/", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)
    if "publish" not in page.url:
        btn = page.locator("text=发布笔记").first
        if await btn.is_visible(timeout=3000):
            await btn.click(); await page.wait_for_timeout(2000)
            print("  clicked publish")
        else:
            await page.goto("https://creator.xiaohongshu.com/publish/publish", wait_until="domcontentloaded", timeout=15000)
            await page.wait_for_timeout(2000)
    return "creator.xiaohongshu.com" in page.url


async def upload_images(page, paths):
    if not paths: return False
    inp = page.locator('input[type="file"]').first
    try:
        await inp.wait_for(state="attached", timeout=5000)
        await inp.set_input_files(paths)
        print(f"  uploaded {len(paths)} images")
        await page.wait_for_timeout(3000)
        return True
    except Exception as e:
        print(f"  [WARN] upload: {e}"); return False


async def fill_content(page, title, content):
    # Title
    ta = page.locator('[placeholder*="标题"]').first
    try:
        await ta.wait_for(state="visible", timeout=5000)
        await ta.click(); await page.keyboard.press("Control+a")
        await page.keyboard.type(title[:20], delay=30)
        print(f"  title: {title[:30]}")
    except Exception as e:
        print(f"  [WARN] title: {e}"); return False

    await page.wait_for_timeout(500)

    # Content
    ca = page.locator('[placeholder*="正文"]').first
    try:
        await ca.wait_for(state="visible", timeout=5000)
        await ca.click(); await page.keyboard.press("Control+a")
        for i in range(0, len(content), 200):
            await page.keyboard.type(content[i:i+200], delay=10)
            await page.wait_for_timeout(200)
        print(f"  content: {len(content)} chars")
    except Exception as e:
        print(f"  [WARN] content: {e}"); return False
    return True


async def click_publish(page):
    strats = [
        lambda: page.locator("xhs-publish-btn").first.click(timeout=3000),
        lambda: page.locator('button:has-text("发布")').first.click(timeout=3000),
        lambda: page.locator('span:has-text("发布")').first.click(timeout=3000),
        lambda: page.keyboard.press("Control+Enter"),
    ]
    for i, s in enumerate(strats):
        try:
            await s(); print(f"  clicked (strat {i+1})")
            await page.wait_for_timeout(3000); return True
        except: continue
    print("  [ERROR] all strategies failed"); return False


async def check_success(page):
    url = page.url
    result = {"success": False, "evidence": []}
    if "publish" not in url:
        result["success"] = True
        result["evidence"].append("URL changed")
    for t in ["success", "ok", "done"]:
        try:
            if await page.locator(f'text={t}').first.is_visible(timeout=1000):
                result["success"] = True
                result["evidence"].append(f"text: {t}"); break
        except: pass
    return result


async def main():
    print("=" * 50)
    print("XHS CDP Poster")
    print("=" * 50)

    jp, cov = find_latest_posts_json()
    posts = load_posts(jp)
    if not posts: print("No posts."); return
    post = posts[0]
    print(f"  post: {post['title'][:30]} ({len(post.get('content',''))} chars)")

    print("\nConnecting CDP...")
    print("  Ensure: chrome.exe --remote-debugging-port=9222 + logged in to creator.xiaohongshu.com")
    try:
        browser, page = await connect_via_cdp()
    except Exception as e:
        print(f"\n  [ERROR] {e}")
        print("  Start Chrome: chrome.exe --remote-debugging-port=9222")
        return

    try:
        if not await navigate_to_creator(page):
            print("[ERROR] creator studio"); return

        imgs = sorted([str(p) for p in cov.glob("*.png") if p.is_file()])[:10] if cov.exists() else []
        if imgs: await upload_images(page, imgs)

        await fill_content(page, post.get("title",""), post.get("content",""))

        if await click_publish(page):
            await page.wait_for_timeout(3000)
            r = await check_success(page)
            if r["success"]:
                print(f"\n  [OK] Posted!"); [print(f"    - {e}") for e in r["evidence"]]
            else:
                print("\n  [WARN] Could not verify")
                DIAG_DIR.mkdir(exist_ok=True)
                dp = str(DIAG_DIR / f"cdp_{datetime.now():%Y%m%d_%H%M%S}.png")
                await page.screenshot(path=dp)
                print(f"    screenshot: {dp}")
        else:
            print("\n  [FAIL] Publish button")
    finally:
        print("\n  Done. Browser stays open.")


if __name__ == "__main__":
    asyncio.run(main())
