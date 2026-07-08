#!/usr/bin/env python3
"""
小红书 Playwright v9 — 键盘终极方案
- 图片: set_input_files() CDP 上传
- 标题: 精准选择器 input[placeholder=\"填写标题会有更多赞哦\"]
- 正文: contenteditable div
- 发布: Tab 导航到底部 + Enter（因发布按钮非文本元素）
- Profile: launch_persistent_context（绕过 WAF）
"""

import asyncio, json, sys
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
    return [p for p in posts if p.get("score") or p.get("cover")] or posts


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
    """JS 点击首页'发布图文笔记'卡片"""
    return await page.evaluate("""
    () => { var a=document.querySelectorAll('*');
    a.forEach(function(e){if(e.textContent.trim()==='发布图文笔记'&&e.children.length===0){
    var p=e.parentElement;for(var i=0;i<6;i++){if(!p||p===document.body)break;
    if(getComputedStyle(p).cursor==='pointer'){p.click();return}}}
    }); return 'ok' }
    """)


async def publish_one(page, post, idx, total):
    title, body, imgs = prepare_post(post)
    tag = f"{idx:02d}"
    DEBUG_DIR.mkdir(exist_ok=True)

    print(f"\n{'─'*50}")
    print(f"[{idx+1}/{total}] {title[:35]}")

    # ── 1. 导航并进入发布页 ──
    await page.goto("https://creator.xiaohongshu.com/new/home", timeout=30000, wait_until="domcontentloaded")
    await page.wait_for_timeout(4000)
    if "/login" in page.url:
        print("   ❌ Cookie 过期")
        return {"success": False, "title": title, "error": "login"}

    await click_publish_note(page)
    await page.wait_for_timeout(6000)
    print(f"   ① 发布页: {page.url[:80]}")
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-01-publish.png"))

    # ── 2. 上传图片 ──
    for k, fpath in enumerate(imgs):
        try:
            await page.locator('input[type="file"]').first.set_input_files(fpath)
            print(f"   📸 [{k+1}/{len(imgs)}] {Path(fpath).name}")
            await page.wait_for_timeout(4000)
        except Exception as e:
            print(f"   ⚠️ 上传失败 [{k+1}]: {e}")
    await page.wait_for_timeout(2000)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-02-uploaded.png"))

    # ── 3. 填写标题（精准选择器）──
    title_sel = page.locator('input[placeholder="填写标题会有更多赞哦"]').first
    if await title_sel.count() > 0:
        await title_sel.click()
        await page.wait_for_timeout(300)
        await title_sel.fill(title)
        print(f"   ✏️ 标题: {title[:35]}")
    else:
        print("   ⚠️ 找不到标题输入框")

    # ── 4. 填写正文 ──
    body_sel = page.locator('[contenteditable="true"]').first
    if await body_sel.count() > 0:
        await body_sel.click()
        await page.wait_for_timeout(300)
        await body_sel.fill(body)
        print(f"   📝 正文: {len(body)} 字")
    else:
        print("   ⚠️ 找不到正文编辑区")

    await page.wait_for_timeout(1000)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-03-filled.png"))

    # ── 5. 滚动到表单底部 ──
    await page.evaluate('document.querySelector(".publish-page").scrollTop = 9999')
    await page.wait_for_timeout(1000)

    # ── 6. 用 Tab 导航到发布按钮 + Enter ──
    #    先点一下表单区域确保焦点在 publish-page 内
    await page.mouse.click(400, 300)
    await page.wait_for_timeout(300)

    #    按很多次 Tab 跳过所有表单元素，到达发布按钮
    #    表单元素：标题→正文→话题→@用户→表情→活动→合集→引用→地点→群聊→标记→路线→文件→权限...→发布
    print("   🔤 Tab 导航中...")
    for i in range(25):
        await page.keyboard.press("Tab")
        await page.wait_for_timeout(80)

    #    截图看当前聚焦位置
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-03b-before-enter.png"))

    #    按 Enter 提交
    await page.keyboard.press("Enter")
    print("   🚀 已按 Enter")
    await page.wait_for_timeout(8000)

    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-04-done.png"))

    # ── 7. 检查结果 ──
    final_url = page.url
    success = "login" not in final_url and "/publish/publish" not in final_url
    print(f"   ② 结果: {'✅ 成功' if success else '⚠️ 待确认'} ({final_url[:80]})")

    return {"success": success, "title": title, "url": final_url}


async def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--headless", type=str, default="false")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--post-idx", type=int, default=None)
    parser.add_argument("--delay", type=int, default=180)
    args = parser.parse_args()

    posts = load_posts()
    if args.post_idx is not None and 0 <= args.post_idx < len(posts):
        posts = [posts[args.post_idx]]
    elif args.limit:
        posts = posts[:args.limit]

    print(f"📋 {len(posts)} 篇待发")
    for p in posts:
        print(f"   {p.get('title','')[:35]}")

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            str(CHROME_PROFILE),
            headless=args.headless == "true",
            viewport={"width": 1440, "height": 900},
            locale="zh-CN",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        t0 = datetime.now()
        results = []
        for i, post in enumerate(posts):
            results.append(await publish_one(page, post, i, len(posts)))
            if i < len(posts) - 1:
                print(f"\n   ⏳ 间隔 {args.delay}s...")
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
