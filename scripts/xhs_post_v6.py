#!/usr/bin/env python3
"""
小红书 Playwright 直连发帖 v6 — 确定性脚本
突破点：Playwright set_input_files() 走 CDP DOM.setFileInputFiles，绕过 Shadow DOM 保护
认证：storage_state（Playwright 原生格式，含 cookies + localStorage）
"""

import asyncio, json, sys, shutil
from datetime import datetime
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "posts"
STORAGE_STATE = ROOT / "scripts" / ".xhs_storage_state.json"
STORAGE_BAK = ROOT / "scripts" / ".xhs_storage_state.json.bak"
COVER_DIR = POSTS_DIR / "covers"
POSTS_JSON = POSTS_DIR / "posts.json"
DEBUG_DIR = POSTS_DIR / "diag"

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def load_posts():
    """加载待发帖子（跳过全国播报，只发城市帖）"""
    with open(POSTS_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)
    posts = data.get("posts", [])
    # 优先城市帖（有 score/cover），回退全部
    city = [p for p in posts if p.get("score") or p.get("cover")]
    return city if city else posts


def prepare_post(post):
    """准备单篇帖子的标题、正文、图片路径"""
    copy_file = POSTS_DIR / (post.get("copyFile") or "")
    img_file = POSTS_DIR / (post.get("file") or "")
    cover_name = post.get("cover") or ""

    raw = copy_file.read_text("utf-8").strip() if copy_file.exists() else post.get("title", "")
    lines = raw.split("\n")
    title = lines[0].strip()

    body_lines, hashtags = [], ""
    for l in lines[1:]:
        s = l.strip()
        if s.startswith("#"):
            hashtags = s
        elif s:
            body_lines.append(l)
    body = "\n".join(body_lines).strip()
    full_body = f"{body}\n\n{hashtags}" if hashtags else body

    imgs = []
    cover_path = COVER_DIR / cover_name if cover_name else None
    if cover_path and cover_path.exists():
        imgs.append(str(cover_path.resolve()))
    if img_file.exists():
        imgs.append(str(img_file.resolve()))

    return title, full_body, imgs


async def publish_one(page, post, idx, total):
    """发布一篇帖子"""
    title, body, imgs = prepare_post(post)

    print(f"\n{'─'*50}")
    print(f"[{idx+1}/{total}] {title[:35]}")
    print(f"   📝 {len(body)} 字 | 🖼️  {len(imgs)} 张图")

    DEBUG_DIR.mkdir(exist_ok=True)
    tag = f"{idx:02d}"

    # ── 1. 直接导航到图文发布页 ──
    publish_url = "https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image_text"
    await page.goto(publish_url, timeout=30000)
    await page.wait_for_timeout(4000)

    url = page.url
    if "/login" in url:
        print(f"   ❌ Cookie 已过期")
        return {"success": False, "title": title, "error": "cookie_expired"}

    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-01-publish-page.png"))

    # ── 2. 上传图片 ──
    if imgs:
        file_input = page.locator('input[type="file"]').first
        if await file_input.count() == 0:
            # 有时 input 是隐藏的，尝试强制显示
            await page.evaluate("""
                document.querySelectorAll('input[type="file"]').forEach(el => {
                    el.style.display = 'block';
                    el.style.visibility = 'visible';
                });
            """)
            await page.wait_for_timeout(500)

        for k, fpath in enumerate(imgs):
            try:
                await file_input.set_input_files(fpath)
                print(f"   📸 [{k+1}/{len(imgs)}] {Path(fpath).name}")
                await page.wait_for_timeout(4000)
            except Exception as e:
                print(f"   ⚠️  上传失败 [{k+1}]: {e}")
                # 尝试用 nth(0) 或重新获取
                try:
                    await page.locator('input[type="file"]').first.set_input_files(fpath)
                    print(f"   📸 [{k+1}/{len(imgs)}] {Path(fpath).name} (retry)")
                    await page.wait_for_timeout(4000)
                except Exception as e2:
                    print(f"   ❌ 重试也失败: {e2}")

        await page.wait_for_timeout(3000)
        await page.screenshot(path=str(DEBUG_DIR / f"{tag}-02-uploaded.png"))

    # ── 3. 填写标题 ──
    title_filled = False
    # 尝试多种选择器
    for sel in [
        'input[placeholder*="标题"]',
        '[placeholder*="标题"]',
        '[class*="title"] input',
        '[class*="title"] [contenteditable]',
        '[data-testid="title"]',
        '#title',
    ]:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                await el.click()
                await page.wait_for_timeout(300)
                await el.fill(title)
                title_filled = True
                print(f"   ✏️  标题 (via {sel[:30]}): {title[:30]}")
                break
        except Exception:
            continue

    if not title_filled:
        # 回退：键盘 Tab 导航
        print("   🔤 用键盘 Tab 导航...")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)
        for _ in range(10):
            await page.keyboard.press("Tab")
            await page.wait_for_timeout(150)
        # 粘贴标题
        await page.keyboard.type(title, delay=30)
        print(f"   ✏️  标题 (keyboard): {title[:30]}")

    await page.wait_for_timeout(500)

    # ── 4. 填写正文 ──
    body_filled = False
    for sel in [
        '[placeholder*="正文"]',
        '[placeholder*="内容"]',
        '[contenteditable="true"]',
        '[class*="editor"] [contenteditable]',
        '[class*="ql-editor"]',
        '[class*="body"] [contenteditable]',
    ]:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                await el.click()
                await page.wait_for_timeout(300)
                await el.fill(body)
                body_filled = True
                print(f"   📝 正文 (via {sel[:30]}): {len(body)} 字")
                break
        except Exception:
            continue

    if not body_filled:
        # 回退：Tab + type
        await page.keyboard.press("Tab")
        await page.wait_for_timeout(300)
        await page.keyboard.type(body, delay=15)
        print(f"   📝 正文 (keyboard): {len(body)} 字")

    await page.wait_for_timeout(1000)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-03-filled.png"))

    # ── 5. 点击发布 ──
    publish_clicked = False
    for sel in [
        "button:has-text('发布'):not(:has-text('图文')):not(:has-text('笔记'))",
        "text=发布",
        "button:has-text('发布')",
        "[class*='publish'] button",
        "[class*='submit'] button",
    ]:
        try:
            btn = page.locator(sel).last
            if await btn.count() > 0:
                disabled = await btn.is_disabled()
                if not disabled:
                    await btn.click()
                    publish_clicked = True
                    print(f"   🚀 已点击发布 (via {sel[:35]})")
                    break
                else:
                    print(f"   ⚠️  发布按钮禁用 ({sel[:30]})")
        except Exception as e:
            continue

    if not publish_clicked:
        # 回退：Tab + Enter
        print("   🔤 用键盘找发布按钮...")
        for _ in range(15):
            await page.keyboard.press("Tab")
            await page.wait_for_timeout(100)
        await page.keyboard.press("Enter")
        print("   🚀 已按 Enter 发布")

    await page.wait_for_timeout(6000)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-04-after-publish.png"))

    # ── 6. 检查结果 ──
    post_url = page.url
    success = "publish" not in post_url.lower().split("?")[0].rstrip("/").split("/")[-1]
    # 发布成功后通常会跳转
    if success or "success" in post_url.lower():
        print(f"   ✅ 发布成功 ({post_url[:60]})")
        return {"success": True, "title": title}
    else:
        print(f"   ⚠️  仍在发布页 ({post_url[:60]})")
        return {"success": False, "title": title, "error": "still_on_publish_page", "url": post_url}


async def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--headless", type=str, default="false")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--post-idx", type=int, default=None)
    parser.add_argument("--delay", type=int, default=60)
    args = parser.parse_args()

    headless = args.headless == "true"

    # 检查 storage_state
    src = STORAGE_BAK if STORAGE_BAK.exists() else STORAGE_STATE
    if not src.exists():
        print("❌ 无 storage_state，请先运行 post_xhs_browseruse.py --setup 登录")
        sys.exit(1)

    # 复制一份用于本次发帖（防止原文件被覆写）
    tmp_state = STORAGE_STATE.with_suffix(".tmp_v6.json")
    tmp_state.unlink(missing_ok=True)
    shutil.copy(src, tmp_state)
    print(f"✅ storage_state: {tmp_state.stat().st_size} bytes (from {src.name})")

    posts = load_posts()
    if args.post_idx is not None:
        posts = [posts[args.post_idx]] if 0 <= args.post_idx < len(posts) else posts
    elif args.limit:
        posts = posts[:args.limit]

    print(f"📋 {len(posts)} 篇待发")
    for p in posts:
        cover = p.get("cover") or "无"
        print(f"   {p.get('title','')[:35]} | 封面: {cover}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        ctx = await browser.new_context(
            storage_state=str(tmp_state),
            viewport={"width": 1440, "height": 900},
            locale="zh-CN",
        )
        page = await ctx.new_page()

        t0 = datetime.now()
        results = []
        for i, post in enumerate(posts):
            results.append(await publish_one(page, post, i, len(posts)))
            if i < len(posts) - 1:
                await asyncio.sleep(args.delay)

        await browser.close()

    # 清理
    tmp_state.unlink(missing_ok=True)

    ok = sum(1 for r in results if r.get("success"))
    elapsed = (datetime.now() - t0).total_seconds()
    print(f"\n{'═'*50}")
    print(f"📊 {ok}/{len(results)} 成功 ({elapsed:.0f}s)")

    record = POSTS_DIR / f"publish-record-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    record.write_text(json.dumps({
        "published_at": datetime.now().isoformat(),
        "total": len(results), "ok": ok, "posts": results,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"📝 {record}")


if __name__ == "__main__":
    asyncio.run(main())
