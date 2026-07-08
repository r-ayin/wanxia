#!/usr/bin/env python3
"""
小红书 Playwright 直连发帖 v8 — 持久化 Profile 方案
关键突破：launch_persistent_context 使用真实 Chrome profile（非隐身模式）
—— Browser Use 的 setup 用这个方式成功绕过 WAF！
"""

import asyncio, json, sys, shutil, os
from datetime import datetime
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "posts"
CHROME_PROFILE = ROOT / "scripts" / ".xhs_chrome_profile"
COVER_DIR = POSTS_DIR / "covers"
POSTS_JSON = POSTS_DIR / "posts.json"
DEBUG_DIR = POSTS_DIR / "diag"

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def load_posts():
    with open(POSTS_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)
    posts = data.get("posts", [])
    city = [p for p in posts if p.get("score") or p.get("cover")]
    return city if city else posts


def prepare_post(post):
    cf = POSTS_DIR / (post.get("copyFile") or "")
    raw = cf.read_text("utf-8").strip() if cf.exists() else post.get("title", "")
    lines = raw.split("\n")
    title = lines[0].strip()
    body_lines, hashtags = [], ""
    for l in lines[1:]:
        s = l.strip()
        if s.startswith("#"): hashtags = s
        elif s: body_lines.append(l)
    body = "\n".join(body_lines).strip()
    full_body = f"{body}\n\n{hashtags}" if hashtags else body
    imgs = []
    cover = COVER_DIR / (post.get("cover") or "") if post.get("cover") else None
    if cover and cover.exists(): imgs.append(str(cover.resolve()))
    img_file = POSTS_DIR / (post.get("file") or "")
    if img_file.exists(): imgs.append(str(img_file.resolve()))
    return title, full_body, imgs


async def click_publish_note(page):
    """JS 点击'发布图文笔记'"""
    return await page.evaluate("""
    (function() {
        var all = document.querySelectorAll('*');
        var target = null;
        all.forEach(function(el) {
            var txt = (el.textContent || '').trim();
            if (txt === '发布图文笔记' && el.children.length === 0) {
                target = el;
            }
        });
        if (!target) {
            // 宽松匹配
            all.forEach(function(el) {
                var txt = (el.textContent || '').trim();
                if (txt.indexOf('发布图文笔记') >= 0 && txt.length < 30 && el.children.length === 0) {
                    target = el;
                }
            });
        }
        if (!target) return 'not_found';
        // 向上找最近的可点击祖先
        var el = target;
        for (var i = 0; i < 8; i++) {
            if (!el || el === document.body) break;
            var cs = getComputedStyle(el);
            if (cs.cursor === 'pointer' || el.tagName === 'A' || el.tagName === 'BUTTON' ||
                el.getAttribute('role') === 'button' || el.onclick) {
                el.click();
                return 'clicked:' + el.tagName;
            }
            el = el.parentElement;
        }
        // 还没找到就点击 target 的祖父
        if (target.parentElement && target.parentElement.parentElement) {
            target.parentElement.parentElement.click();
            return 'clicked_grandparent';
        }
        return 'no_clickable_ancestor';
    })()
    """)


async def upload_images(page, imgs):
    """CDP 层上传"""
    for k, fpath in enumerate(imgs):
        try:
            await page.locator('input[type="file"]').first.set_input_files(fpath)
            print(f"   📸 [{k+1}/{len(imgs)}] {Path(fpath).name}")
            await page.wait_for_timeout(4000)
        except Exception as e:
            print(f"   ⚠️  上传 [{k+1}] 失败: {e}")
            await page.wait_for_timeout(2000)
            try:
                await page.locator('input[type="file"]').first.set_input_files(fpath)
                print(f"   📸 [{k+1}] {Path(fpath).name} (retry)")
                await page.wait_for_timeout(4000)
            except Exception as e2:
                print(f"   ❌ 重试失败: {e2}")


async def fill_form(page, title, body):
    """键盘填写标题+正文"""
    await page.mouse.click(700, 400)
    await page.wait_for_timeout(500)
    for _ in range(5):
        await page.keyboard.press("Tab")
        await page.wait_for_timeout(100)
    await page.keyboard.type(title, delay=30)
    print(f"   ✏️  标题: {title[:35]}")
    await page.keyboard.press("Tab")
    await page.wait_for_timeout(300)
    await page.keyboard.type(body, delay=15)
    print(f"   📝 正文: {len(body)} 字")
    await page.wait_for_timeout(1000)


async def click_publish(page):
    """点击发布按钮"""
    result = await page.evaluate("""
    (function() {
        var btns = document.querySelectorAll('button, [role="button"], span, div');
        for (var i = 0; i < btns.length; i++) {
            var b = btns[i];
            var t = (b.textContent || '').trim();
            if ((t === '发布' || t === '发布笔记') && b.offsetParent !== null) {
                if (!b.disabled) { b.click(); return 'clicked:' + b.tagName; }
                return 'disabled:' + b.tagName;
            }
        }
        return 'not_found';
    })()
    """)
    print(f"   🔘 发布: {result}")
    if result.startswith("clicked:"):
        return True
    # Fallback: Tab + Enter
    for _ in range(12):
        await page.keyboard.press("Tab")
        await page.wait_for_timeout(100)
    await page.keyboard.press("Enter")
    return True


async def publish_one(page, post, idx, total):
    title, body, imgs = prepare_post(post)
    tag = f"{idx:02d}"

    print(f"\n{'─'*50}")
    print(f"[{idx+1}/{total}] {title[:35]}")
    print(f"   📝 {len(body)} 字 | 🖼️  {len(imgs)} 张图")

    DEBUG_DIR.mkdir(exist_ok=True)

    # 1. 首页
    print("   ① 导航首页...")
    await page.goto("https://creator.xiaohongshu.com/new/home", timeout=30000, wait_until="domcontentloaded")
    await page.wait_for_timeout(4000)
    print(f"      首页: {page.url[:80]}")

    if "/login" in page.url:
        print("   ❌ Cookie 过期，需要重新 --setup")
        return {"success": False, "title": title, "error": "login"}

    # 2. 点击发布图文笔记
    clicked = await click_publish_note(page)
    print(f"   ② 点击: {clicked}")
    await page.wait_for_timeout(6000)
    print(f"   ③ 发布页: {page.url[:80]}")
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-01-publish.png"))

    # 3. 上传图片
    await upload_images(page, imgs)
    await page.wait_for_timeout(3000)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-02-uploaded.png"))

    # 4. 填表
    await fill_form(page, title, body)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-03-filled.png"))

    # 5. 发布
    await click_publish(page)
    await page.wait_for_timeout(6000)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-04-done.png"))

    final_url = page.url
    success = "/login" not in final_url and "publish/publish" not in final_url
    print(f"   ④ 结果: {'✅ 成功' if success else '⚠️ 待确认'} ({final_url[:80]})")

    return {"success": success, "title": title, "url": final_url}


async def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--headless", type=str, default="false")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--post-idx", type=int, default=None)
    parser.add_argument("--delay", type=int, default=120)  # 2min between posts (avoid WAF)
    args = parser.parse_args()

    headless = args.headless == "true"

    posts = load_posts()
    if args.post_idx is not None and 0 <= args.post_idx < len(posts):
        posts = [posts[args.post_idx]]
    elif args.limit:
        posts = posts[:args.limit]

    print(f"📋 {len(posts)} 篇待发")
    for p in posts:
        print(f"   {p.get('title','')[:35]} | 封面: {p.get('cover','') or '无'}")

    # 🔴 关键：使用 launch_persistent_context（真实 Chrome profile）
    # 这与 --setup 登录用的是同一个 profile 目录，WAF 会认为是正常用户
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            str(CHROME_PROFILE),
            headless=headless,
            viewport={"width": 1440, "height": 900},
            locale="zh-CN",
            args=[
                "--disable-blink-features=AutomationControlled",
            ],
        )

        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        t0 = datetime.now()
        results = []
        for i, post in enumerate(posts):
            results.append(await publish_one(page, post, i, len(posts)))
            if i < len(posts) - 1:
                print(f"\n   ⏳ 间隔 {args.delay}s（防止 WAF 限流）...")
                await asyncio.sleep(args.delay)

        await ctx.close()

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
