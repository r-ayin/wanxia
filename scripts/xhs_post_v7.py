#!/usr/bin/env python3
"""
小红书 Playwright 直连发帖 v7 — 坐标+键盘混合方案
- 图片上传: set_input_files() (CDP 层，绕过 Shadow DOM)
- 导航/点击: 坐标点击 + JS click
- 表单填写: 键盘 Tab + type
- 发布: 键盘 Enter
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
    """点击'发布图文笔记'——使用 JS 找到可点击容器并点击"""
    clicked = await page.evaluate("""
    (function() {
        var all = document.querySelectorAll('*');
        var target = null;
        all.forEach(function(el) {
            if (el.textContent.trim() === '发布图文笔记' && el.children.length > 0) {
                target = el;
            }
        });
        if (!target) return 'not_found';

        // 向上找最近的可点击祖先（cursor:pointer 或 有 role 或 是 button/a）
        var el = target;
        for (var i = 0; i < 8; i++) {
            if (!el || el === document.body) break;
            var cs = getComputedStyle(el);
            if (cs.cursor === 'pointer' || el.tagName === 'A' || el.tagName === 'BUTTON' ||
                el.getAttribute('role') === 'button' || el.onclick) {
                el.click();
                return 'clicked:' + el.tagName + '.' + (el.className || '').slice(0,40);
            }
            el = el.parentElement;
        }

        // 如果没找到，点击最外层容器
        target.parentElement.parentElement.parentElement.click();
        return 'clicked_parent3';
    })()
    """)
    return clicked


async def upload_images(page, imgs):
    """上传图片——CDP 层 set_input_files"""
    for k, fpath in enumerate(imgs):
        try:
            fi = page.locator('input[type="file"]').first
            await fi.set_input_files(fpath)
            print(f"   📸 [{k+1}/{len(imgs)}] {Path(fpath).name}")
            await page.wait_for_timeout(4000)
        except Exception as e:
            print(f"   ⚠️  上传 [{k+1}] 失败: {e}")
            # 重试：等 2 秒后再试
            await page.wait_for_timeout(2000)
            try:
                await page.locator('input[type="file"]').first.set_input_files(fpath)
                print(f"   📸 [{k+1}/{len(imgs)}] {Path(fpath).name} (retry)")
                await page.wait_for_timeout(4000)
            except Exception as e2:
                print(f"   ❌ 重试失败: {e2}")


async def fill_title_and_body(page, title, body):
    """用键盘 Tab 导航填写标题和正文"""
    # 先多点几次空白处确保焦点在页面
    await page.mouse.click(700, 400)
    await page.wait_for_timeout(500)

    # 按几次 Tab 跳到标题输入框
    for _ in range(5):
        await page.keyboard.press("Tab")
        await page.wait_for_timeout(100)

    # 粘贴标题
    await page.keyboard.type(title, delay=30)
    print(f"   ✏️  标题: {title[:35]}")

    # Tab 到正文
    await page.keyboard.press("Tab")
    await page.wait_for_timeout(300)

    # 粘贴正文
    await page.keyboard.type(body, delay=15)
    print(f"   📝 正文: {len(body)} 字")

    await page.wait_for_timeout(1000)


async def click_publish(page):
    """点击发布按钮——先尝试 JS 找按钮，不行就 Tab + Enter"""
    # 方法 1: JS 直接找发布按钮
    result = await page.evaluate("""
    (function() {
        var btns = document.querySelectorAll('button, [role="button"], span, div');
        for (var i = 0; i < btns.length; i++) {
            var b = btns[i];
            var t = (b.textContent || '').trim();
            if ((t === '发布' || t === '发布笔记') && b.offsetParent !== null) {
                // 检查是否 disabled
                if (!b.disabled) {
                    b.click();
                    return 'clicked:' + b.tagName;
                }
                return 'disabled:' + b.tagName;
            }
        }
        return 'not_found';
    })()
    """)
    print(f"   🔘 发布按钮: {result}")

    if result.startswith("clicked:"):
        return True

    # 方法 2: Tab + Enter
    print("   🔤 Tab 导航到发布按钮...")
    for _ in range(12):
        await page.keyboard.press("Tab")
        await page.wait_for_timeout(100)
    await page.keyboard.press("Enter")
    print("   🚀 已按 Enter")
    return True


async def publish_one(page, post, idx, total):
    title, body, imgs = prepare_post(post)
    tag = f"{idx:02d}"

    print(f"\n{'─'*50}")
    print(f"[{idx+1}/{total}] {title[:35]}")
    print(f"   📝 {len(body)} 字 | 🖼️  {len(imgs)} 张图")

    DEBUG_DIR.mkdir(exist_ok=True)

    # 1. 首页 → 点击发布图文笔记
    print("   ① 导航到首页...")
    await page.goto("https://creator.xiaohongshu.com/new/home", timeout=30000)
    await page.wait_for_timeout(4000)

    if "/login" in page.url:
        print("   ❌ Cookie 过期")
        return {"success": False, "title": title, "error": "login"}

    clicked = await click_publish_note(page)
    print(f"   ② 点击发布: {clicked}")
    await page.wait_for_timeout(6000)

    publish_url = page.url
    print(f"   ③ 发布页: {publish_url[:80]}")
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-01-publish.png"))

    # 2. 上传图片
    await upload_images(page, imgs)
    await page.wait_for_timeout(3000)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-02-uploaded.png"))

    # 3. 填表
    await fill_title_and_body(page, title, body)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-03-filled.png"))

    # 4. 发布
    await click_publish(page)
    await page.wait_for_timeout(6000)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-04-done.png"))

    final_url = page.url
    success = "/login" not in final_url and "publish/publish" not in final_url.split("?")[0]
    print(f"   ④ 结果: {'✅ 成功' if success else '⚠️ 待确认'} ({final_url[:80]})")

    return {"success": success, "title": title, "url": final_url}


async def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--headless", type=str, default="false")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--post-idx", type=int, default=None)
    parser.add_argument("--delay", type=int, default=60)
    args = parser.parse_args()

    src = STORAGE_BAK if STORAGE_BAK.exists() else STORAGE_STATE
    if not src.exists():
        print("❌ 无 storage_state"); sys.exit(1)

    tmp_state = STORAGE_STATE.with_suffix(".tmp_v7.json")
    tmp_state.unlink(missing_ok=True)
    shutil.copy(src, tmp_state)
    if sys.platform == "win32":
        import os; os.chmod(str(tmp_state), 0o666)

    print(f"✅ storage_state: {tmp_state.stat().st_size} bytes")

    posts = load_posts()
    if args.post_idx is not None and 0 <= args.post_idx < len(posts):
        posts = [posts[args.post_idx]]
    elif args.limit:
        posts = posts[:args.limit]

    print(f"📋 {len(posts)} 篇待发")
    for p in posts:
        print(f"   {p.get('title','')[:35]} | 封面: {p.get('cover','') or '无'}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=args.headless == "true")
        ctx = await browser.new_context(
            storage_state=str(tmp_state),
            viewport={"width": 1440, "height": 900}, locale="zh-CN")
        page = await ctx.new_page()

        t0 = datetime.now()
        results = []
        for i, post in enumerate(posts):
            results.append(await publish_one(page, post, i, len(posts)))
            if i < len(posts) - 1:
                print(f"\n   ⏳ 等待 {args.delay}s...")
                await asyncio.sleep(args.delay)

        await browser.close()

    try:
        if sys.platform == "win32":
            import os; os.chmod(str(tmp_state), 0o666)
        tmp_state.unlink(missing_ok=True)
    except Exception:
        pass

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
