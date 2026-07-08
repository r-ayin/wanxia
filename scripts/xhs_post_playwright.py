#!/usr/bin/env python3
"""Playwright 直连小红书发帖 — 绕过 Browser Use storage_state bug"""
import asyncio, json, re, sys
from pathlib import Path
from datetime import datetime
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "posts"
POSTS_JSON = POSTS_DIR / "posts.json"
STORAGE_STATE = ROOT / "scripts" / ".xhs_storage_state.json"
COVER_DIR = POSTS_DIR / "covers"

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

async def post_one(page, post: dict, idx: int, total: int) -> dict:
    title = post.get("title", "")
    copy_file = POSTS_DIR / (post.get("copyFile") or "")
    img_file = POSTS_DIR / (post.get("file") or "")
    cover_file_name = post.get("cover") or ""

    # 读取文案
    copy_text = copy_file.read_text("utf-8").strip() if copy_file.exists() else title
    lines = copy_text.split("\n")
    post_title = lines[0].strip()
    hashtags = ""
    body_lines = []
    for l in lines[1:]:
        if l.strip().startswith("#"):
            hashtags = l.strip()
        elif l.strip():
            body_lines.append(l)
    body = "\n".join(body_lines).strip()

    # 图片路径列表：封面第一，截图第二
    img_paths = []
    if cover_file_name:
        cover_path = COVER_DIR / cover_file_name
        if cover_path.exists():
            img_paths.append(str(cover_path.resolve()))
    if img_file.exists():
        img_paths.append(str(img_file.resolve()))

    print(f"\n{'─'*50}")
    print(f"[{idx+1}/{total}] {post_title[:30]}")

    # 1) 去首页
    await page.goto("https://creator.xiaohongshu.com", wait_until="domcontentloaded")
    await page.wait_for_timeout(3000)

    # 2) 点击发布笔记
    publish_btn = page.locator("text=发布笔记").first
    if await publish_btn.count() == 0:
        publish_btn = page.locator("text=发布").first
    if await publish_btn.count() == 0:
        publish_btn = page.locator("a:has-text('发布笔记')").first
    if await publish_btn.count() == 0:
        # maybe already on publish page, try clicking + button
        publish_btn = page.locator("[class*='publish']").first

    if await publish_btn.count() > 0:
        await publish_btn.click()
        print("   ✅ 点击发布笔记")
    else:
        print("   ⚠️  找不到发布按钮，尝试直接导航")
        await page.goto("https://creator.xiaohongshu.com/publish", wait_until="domcontentloaded")

    await page.wait_for_timeout(3000)

    # 3) 上传图片 — 封面先（逐个上传，找图片专用的 input）
    if img_paths:
        # 找图片上传 input：accept 含 image 而非 video
        all_inputs = page.locator('input[type="file"]')
        count = await all_inputs.count()
        upload_input = None
        for j in range(count):
            inp = all_inputs.nth(j)
            accept = await inp.get_attribute("accept") or ""
            if "video" not in accept:  # 排除视频上传
                upload_input = inp
                break
        if not upload_input:
            upload_input = all_inputs.first  # 回退

        # 逐个上传
        for k, fpath in enumerate(img_paths):
            try:
                await upload_input.set_input_files(fpath)
                print(f"   📸 上传 [{k+1}/{len(img_paths)}] {Path(fpath).name}")
                await page.wait_for_timeout(3000)
            except Exception as e:
                print(f"   ⚠️  上传失败: {e}")

    # 4) 等页面渲染完成
    await page.wait_for_timeout(3000)

    # 5) 填写标题
    title_input = page.locator('[placeholder*="标题"]').first
    if await title_input.count() == 0:
        title_input = page.locator('input[placeholder*="标"]').first
    if await title_input.count() == 0:
        title_input = page.locator('[class*="title"] input[type="text"]').first
    if await title_input.count() == 0:
        title_input = page.locator('[id*="title"]').first
    if await title_input.count() > 0:
        await title_input.click()
        await page.wait_for_timeout(300)
        await title_input.fill(post_title)
        print(f"   ✏️  标题: {post_title[:30]}")
    else:
        print("   ⚠️  找不到标题输入框")

    # 6) 填写正文
    full_body = f"{body}\n\n{hashtags}" if hashtags else body
    content_area = page.locator('[placeholder*="正文"]').first
    if await content_area.count() == 0:
        content_area = page.locator('[placeholder*="内容"]').first
    if await content_area.count() == 0:
        content_area = page.locator('[class*="ql-editor"]').first
    if await content_area.count() == 0:
        content_area = page.locator('[contenteditable="true"]').first
    if await content_area.count() > 0:
        await content_area.click()
        await page.wait_for_timeout(300)
        await content_area.fill(full_body)
        print(f"   📝 正文已填写 ({len(full_body)} 字)")
    else:
        print("   ⚠️  找不到正文编辑区")

    await page.wait_for_timeout(2000)

    # 6) 点击发布
    submit_btn = page.locator("text=发布").last
    if await submit_btn.count() == 0:
        submit_btn = page.locator("button:has-text('发布')").last
    if await submit_btn.count() > 0:
        # 检查是否可点击
        is_disabled = await submit_btn.is_disabled()
        if not is_disabled:
            await submit_btn.click()
            print("   🚀 已点击发布")
            await page.wait_for_timeout(5000)
            return {"success": True, "title": post_title}
        else:
            print("   ⚠️  发布按钮被禁用（可能缺必填字段）")
            return {"success": False, "title": post_title, "error": "发布按钮禁用"}
    else:
        print("   ⚠️  找不到发布按钮")
        return {"success": False, "title": post_title, "error": "找不到发布按钮"}


async def main():
    if not POSTS_JSON.exists():
        print("❌ posts.json 不存在")
        return

    with open(POSTS_JSON, "r", encoding="utf-8") as f:
        package = json.load(f)

    posts = package.get("posts", [])
    # 只要城市帖（有 cover 或有 score 的，跳过全国播报）
    city_posts = [p for p in posts if p.get("score") or p.get("cover")]

    if not city_posts:
        print("❌ 无城市帖子")
        return

    print(f"📱 待发布: {len(city_posts)} 篇")
    for p in city_posts:
        cover = p.get("cover") or "无"
        print(f"   {p.get('title','')[:35]} | 封面: {cover}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            storage_state=str(STORAGE_STATE),
            viewport={"width": 1440, "height": 900},
            locale="zh-CN",
        )
        page = await ctx.new_page()

        results = []
        for i, post in enumerate(city_posts):
            result = await post_one(page, post, i, len(city_posts))
            results.append(result)
            if i < len(city_posts) - 1:
                await asyncio.sleep(60)

        await browser.close()

    # 汇总
    ok = sum(1 for r in results if r.get("success"))
    fail = len(results) - ok
    print(f"\n{'═'*50}")
    print(f"📊 发帖完成: {ok} 成功, {fail} 失败")

    record = {
        "published_at": datetime.now().isoformat(),
        "total": len(results),
        "ok": ok,
        "fail": fail,
        "posts": results,
    }
    record_file = POSTS_DIR / f"publish-record-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    with open(record_file, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2, ensure_ascii=False)
    print(f"📝 记录: {record_file}")


asyncio.run(main())
