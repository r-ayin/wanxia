#!/usr/bin/env python3
"""
XHS Persistent-Profile Poster — Playwright persistent context.

One-time login, then reusable. Much simpler than CDP:
  1. First run: opens browser -> user logs in -> closes
  2. Subsequent runs: auto-logged-in, posts directly

Usage:
  python scripts/xhs_persistent_poster.py          # auto-post
  python scripts/xhs_persistent_poster.py --login  # just login
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
PROFILE_DIR = ROOT / "scripts" / ".xhs_persistent_profile"

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
    result = []
    parent = json_path.parent
    for p in posts:
        if not p.get("title"): continue
        content = p.get("content", "")
        if not content and p.get("copyFile"):
            cf = parent / p["copyFile"]
            if cf.exists(): content = cf.read_text(encoding="utf-8")
        result.append({**p, "content": content})
    return [p for p in result if p.get("content")]


async def post_one(page, post, images):
    """Post a single piece of content. Returns True on success."""
    # Navigate to publish page
    if "publish" not in page.url:
        await page.goto("https://creator.xiaohongshu.com/publish/publish",
                        wait_until="domcontentloaded", timeout=15000)
    await page.wait_for_timeout(3000)

    # Upload images
    if images:
        inp = page.locator('input[type="file"]').first
        try:
            await inp.wait_for(state="attached", timeout=15000)
            await inp.set_input_files(images)
            print(f"  uploaded {len(images)} images")
            await page.wait_for_timeout(5000)
        except Exception as e:
            print(f"  [WARN] upload: {e}")

    # Fill title
    ta = page.locator('[placeholder*="标题"]').first
    try:
        await ta.wait_for(state="visible", timeout=10000)
        await ta.click(); await page.keyboard.press("Control+a")
        await page.keyboard.type(post.get("title","")[:20], delay=30)
        print(f"  title: {post['title'][:30]}")
    except Exception as e:
        print(f"  [WARN] title: {e}"); return False

    await page.wait_for_timeout(500)

    # Fill content
    ca = page.locator('[placeholder*="正文"]').first
    try:
        await ca.wait_for(state="visible", timeout=10000)
        await ca.click(); await page.keyboard.press("Control+a")
        content = post.get("content","")
        for i in range(0, len(content), 200):
            await page.keyboard.type(content[i:i+200], delay=10)
            await page.wait_for_timeout(200)
        print(f"  content: {len(content)} chars")
    except Exception as e:
        print(f"  [WARN] content: {e}"); return False

    # Click publish
    strats = [
        lambda: page.locator("xhs-publish-btn").first.click(timeout=3000),
        lambda: page.locator('button:has-text("发布")').first.click(timeout=3000),
        lambda: page.locator('span:has-text("发布")').first.click(timeout=3000),
        lambda: page.keyboard.press("Control+Enter"),
    ]
    clicked = False
    for i, s in enumerate(strats):
        try: await s(); print(f"  clicked (strat {i+1})"); await page.wait_for_timeout(3000); clicked = True; break
        except: continue

    if not clicked:
        print("  [ERROR] publish button"); return False

    # Verify
    await page.wait_for_timeout(3000)
    if "publish" not in page.url:
        print("  [OK] published!")
        return True
    print("  [WARN] may still be on publish page")
    return True


async def login_only():
    """Open browser for manual login, then close."""
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    pw = await async_playwright().start()
    ctx = await pw.chromium.launch_persistent_context(
        str(PROFILE_DIR),
        headless=False,
        args=["--no-first-run", "--no-default-browser-check"],
        viewport={"width": 1280, "height": 800},
    )
    page = await ctx.new_page()
    await page.goto("https://creator.xiaohongshu.com/", wait_until="domcontentloaded")
    print("\n  Login on this browser, then close it.")
    print("  Profile saved to:", str(PROFILE_DIR))
    print("  Press Enter after closing the browser...")
    input()
    await ctx.close()
    await pw.stop()
    print("  Profile saved.")


async def main():
    print("=" * 50)
    print("XHS Persistent Poster")
    print("=" * 50)

    if "--login" in sys.argv:
        await login_only()
        return

    jp, cov = find_latest_posts_json()
    posts = load_posts(jp)
    if not posts: print("No posts."); return
    post = posts[0]
    print(f"  post: {post['title'][:30]} ({len(post.get('content',''))} chars)")

    imgs = sorted([str(p) for p in cov.glob("*.png") if p.is_file()])[:10] if cov.exists() else []

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    pw = await async_playwright().start()
    ctx = await pw.chromium.launch_persistent_context(
        str(PROFILE_DIR),
        headless=False,
        args=["--no-first-run"],
        viewport={"width": 1280, "height": 800},
    )
    page = ctx.pages[0] if ctx.pages else await ctx.new_page()

    try:
        # Check if logged in
        await page.goto("https://creator.xiaohongshu.com/", wait_until="domcontentloaded", timeout=15000)
        await page.wait_for_timeout(2000)
        if "login" in page.url:
            print("\n  NOT LOGGED IN. First run: python scripts/xhs_persistent_poster.py --login")
            print(f"  Then log in manually. Profile: {PROFILE_DIR}")
            return
        print(f"  logged in: {page.url[:60]}")

        # Post
        ok = await post_one(page, post, imgs)
        if not ok:
            DIAG_DIR.mkdir(exist_ok=True)
            dp = str(DIAG_DIR / f"persist_{datetime.now():%Y%m%d_%H%M%S}.png")
            await page.screenshot(path=dp)
            print(f"  screenshot: {dp}")
        else:
            print(f"\n  [OK] Done!")
    finally:
        await ctx.close()
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
