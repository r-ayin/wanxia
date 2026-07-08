#!/usr/bin/env python3
"""
小红书 Playwright v10 — 录制级精准选择器
基于真实 codegen 录制，淘汰 Tab 导航方案。

核心选择器来源: 2026-06-19 Playwright codegen 录制
- 发布按钮: xhs-publish-btn (Web Component)
- 上传触发: button "上传图片" → button "Choose File"
- 标题: textbox "填写标题会有更多赞哦"
- 正文: textbox (contenteditable 容器)
- 话题: 逐个点击标签按钮

架构: launch_persistent_context + async
"""

import asyncio, json, sys
from datetime import datetime
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "posts"
CHROME_PROFILE = ROOT / "scripts" / ".xhs_chrome_profile"
DEBUG_DIR = POSTS_DIR / "diag"

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def find_latest_posts_json():
    """优先最新日期子目录（含完整素材），回退到根 posts.json"""
    date_dirs = sorted(
        [d for d in POSTS_DIR.iterdir()
         if d.is_dir() and (d / "posts.json").exists() and d.name != "diag"],
        reverse=True
    )
    if date_dirs:
        latest = date_dirs[0]
        cover_dir = latest / "covers" if (latest / "covers").exists() else POSTS_DIR / "covers"
        print(f"📂 素材目录: {latest.name}")
        return latest / "posts.json", latest, cover_dir

    # 回退：根目录 posts.json（旧版兼容）
    flat = POSTS_DIR / "posts.json"
    if flat.exists():
        print(f"📂 素材目录: {POSTS_DIR.name}（旧版）")
        return flat, POSTS_DIR, POSTS_DIR / "covers"

    raise FileNotFoundError(f"找不到 posts.json，请先运行 publish-xhs.js")


def load_posts(posts_json):
    with open(posts_json, "r", encoding="utf-8") as f:
        data = json.load(f)
    posts = data.get("posts", [])
    return [p for p in posts if p.get("score") or p.get("cover")] or posts


def prepare_post(post, posts_base, cover_dir):
    cf = posts_base / (post.get("copyFile") or "")
    raw = cf.read_text("utf-8").strip() if cf.exists() else post.get("title", "")
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
    cover = cover_dir / (post.get("cover") or "") if post.get("cover") else None
    if cover and cover.exists():
        imgs.append(str(cover.resolve()))
    img_file = posts_base / (post.get("file") or "")
    if img_file.exists():
        imgs.append(str(img_file.resolve()))

    # 🔴 v3.1: POI 位置数据（提升 70% 曝光）
    poi_name = post.get("poiName") or post.get("cityName") or ""
    poi_lat = post.get("lat")
    poi_lon = post.get("lon")

    return title, full_body, body, hashtags, imgs, poi_name, poi_lat, poi_lon


async def click_publish_note(page):
    """JS 点击首页「发布图文笔记」卡片（兜底方案）"""
    return await page.evaluate("""
    () => { var a=document.querySelectorAll('*');
    a.forEach(function(e){if(e.textContent.trim()==='发布图文笔记'&&e.children.length===0){
    var p=e.parentElement;for(var i=0;i<6;i++){if(!p||p===document.body)break;
    if(getComputedStyle(p).cursor==='pointer'){p.click();return}}}
    }); return 'ok' }
    """)


async def publish_one(page, post, idx, total, posts_base, cover_dir):
    title, full_body, body_text, hashtags, imgs, poi_name, poi_lat, poi_lon = prepare_post(post, posts_base, cover_dir)
    tag = f"{idx:02d}"
    DEBUG_DIR.mkdir(exist_ok=True)

    print(f"\n{'─'*50}")
    print(f"[{idx+1}/{total}] {title[:40]}")

    # ── 1. 导航 → 发布页 ──
    await page.goto("https://creator.xiaohongshu.com/new/home",
                     timeout=30000, wait_until="domcontentloaded")
    await page.wait_for_timeout(4000)
    if "/login" in page.url:
        print("   ❌ Cookie 过期，需要重新登录")
        return {"success": False, "title": title, "error": "login"}

    await click_publish_note(page)
    await page.wait_for_timeout(5000)
    print(f"   ① 发布页: {page.url[:80]}")
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-01-publish.png"))

    # ── 2. 上传图片 ──
    #     直接用 input[type=file] set_input_files
    #     🔴 关键: openFilePicker=true 导致文件选择器遮罩层一直存在
    #     上传完成后必须按 Escape 关闭遮罩，否则发布按钮被挡住
    for k, fpath in enumerate(imgs):
        try:
            file_input = page.locator('input[type="file"]').first
            if await file_input.count() > 0:
                await file_input.set_input_files(fpath)
            else:
                cf = page.get_by_role("button", name="Choose File")
                if await cf.count() > 0:
                    await cf.first.set_input_files(fpath)
                else:
                    print(f"   ⚠️ 找不到上传入口")
                    continue
            print(f"   📸 [{k+1}/{len(imgs)}] {Path(fpath).name}")
            await page.wait_for_timeout(4000)
        except Exception as e:
            print(f"   ⚠️ 上传失败 [{k+1}]: {e}")

    # 🔴 v3.2 关键修复: 关闭文件选择器遮罩层
    # openFilePicker=true 导致遮罩一直存在——Escape 无法可靠关闭
    # 方案: JS 清除 URL 参数 + 关闭可能的弹窗 + 点击空白区域
    await page.evaluate("""() => {
        // 1) 清除 openFilePicker URL 参数
        const url = new URL(window.location.href);
        url.searchParams.delete('openFilePicker');
        window.history.replaceState({}, '', url.toString());
        // 2) 关闭可能的遮罩/弹窗
        document.querySelectorAll('[class*="overlay"], [class*="mask"], [class*="dialog"], [class*="modal"]').forEach(el => {
            if (el.style) el.style.display = 'none';
        });
        // 3) 触发 body 点击关闭
        document.body.click();
    }""")
    await page.wait_for_timeout(1500)
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(1000)
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(1000)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-02-uploaded.png"))

    # ── 3. 填写标题 ──
    title_box = page.get_by_role("textbox", name="填写标题会有更多赞哦")
    if await title_box.count() > 0:
        await title_box.first.click()
        await page.wait_for_timeout(300)
        await title_box.first.fill(title)
        print(f"   ✏️ 标题: {title[:40]}")
    else:
        print("   ⚠️ 找不到标题输入框")
        await page.screenshot(path=str(DEBUG_DIR / f"{tag}-err-title.png"))

    # ── 4. 填写正文 ──
    body_filled = False
    # 优先使用 contenteditable 容器
    ce = page.locator('[contenteditable="true"]').first
    if await ce.count() > 0:
        try:
            await ce.click()
            await page.wait_for_timeout(200)
            await ce.fill(body_text)
            print(f"   📝 正文: {len(body_text)} 字 (contenteditable)")
            body_filled = True
        except Exception as e:
            print(f"   ⚠️ contenteditable 填写失败: {e}")

    if not body_filled:
        # 兜底: textbox role
        body_boxes = page.get_by_role("textbox")
        count = await body_boxes.count()
        for i in range(count):
            tb = body_boxes.nth(i)
            name = await tb.get_attribute("name") or ""
            if "标题" in name:
                continue
            text = await tb.text_content() or ""
            if len(text) < 5:
                try:
                    await tb.click()
                    await page.wait_for_timeout(200)
                    await tb.fill(body_text)
                    print(f"   📝 正文: {len(body_text)} 字 (textbox[{i}])")
                    body_filled = True
                    break
                except Exception:
                    continue

    if not body_filled:
        print("   ⚠️ 找不到正文编辑区")
        await page.screenshot(path=str(DEBUG_DIR / f"{tag}-err-body.png"))

    # ── 5. 话题标签 ──
    if hashtags:
        tags = [t.strip() for t in hashtags.replace("#", " #").split("#") if t.strip()]
        for tag_text in tags:
            try:
                tag_btn = page.get_by_text(f"#{tag_text}").first
                if await tag_btn.count() > 0:
                    await tag_btn.click()
                    await page.wait_for_timeout(300)
            except Exception:
                pass
        print(f"   🏷️ {len(tags)} 个话题标签")

    await page.wait_for_timeout(1000)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-03-filled.png"))

    # ── 🔴 v3.1: POI 位置标签 ──
    if poi_name:
        print(f"   📍 添加位置: {poi_name}...", end=" ", flush=True)
        try:
            loc_btn = page.get_by_text("添加位置").first
            if await loc_btn.count() == 0:
                loc_btn = page.get_by_role("button").filter(has_text="位置").first
            if await loc_btn.count() > 0:
                await loc_btn.click()
                await page.wait_for_timeout(1500)
                search_box = page.get_by_role("textbox").filter(has_text="搜索").last
                if await search_box.count() == 0:
                    search_box = page.locator('input[placeholder*="搜索"]').first
                if await search_box.count() > 0:
                    await search_box.fill(poi_name)
                    await page.wait_for_timeout(2000)
                    first_result = page.locator('[class*="location"]').first
                    if await first_result.count() == 0:
                        first_result = page.locator('li').filter(has_text=poi_name).first
                    if await first_result.count() > 0:
                        await first_result.click()
                        await page.wait_for_timeout(1000)
                        print(f"✅", flush=True)
                    else:
                        print(f"⚠️ 无搜索结果", flush=True)
                else:
                    print(f"⚠️ 无搜索框", flush=True)
            else:
                print(f"⚠️ 无位置按钮", flush=True)
        except Exception as e:
            print(f"⚠️ 跳过 ({e})", flush=True)

    # ── 🔴 v3.2: 滚动 .publish-page 到底，找到发布按钮 ──
    # XHS 2026-06 更新：发布按钮在 .publish-page 滚动容器的底部
    # 该容器 scrollH≈1572 但 clientH≈836，不滚动看不到发布按钮
    await page.evaluate("""() => {
        const pp = document.querySelector('.publish-page');
        if (pp) { pp.scrollTop = pp.scrollHeight; }
    }""")
    await page.wait_for_timeout(1500)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-03b-scrolled.png"))

    # ── 6. 查找并点击发布按钮 ──
    publish_clicked = False

    # 🔴 v3.2: xhs-publish-btn 是 Web Component，外层点击可能不触发 Shadow DOM 内的 button
    # 先用 JS 穿透 Shadow DOM 找到真正的 button 并点击
    pub = page.locator("xhs-publish-btn")
    if await pub.count() > 0:
        # 方案A: 普通点击（可能被遮罩拦截）
        try:
            await pub.first.click(timeout=3000)
            publish_clicked = True
            print("   🚀 已点击发布 (xhs-publish-btn direct)")
        except Exception:
            pass

        # 方案B: JS 强制点击（绕过遮罩和 Shadow DOM）
        if not publish_clicked:
            try:
                await pub.first.evaluate("el => el.click()")
                publish_clicked = True
                print("   🚀 已点击发布 (xhs-publish-btn JS click)")
            except Exception:
                pass

        # 方案C: 穿透 Shadow DOM 点击内部 button
        if not publish_clicked:
            clicked = await page.evaluate("""() => {
                const xhs = document.querySelector('xhs-publish-btn');
                if (!xhs) return 'no_element';
                // 尝试 Shadow DOM
                if (xhs.shadowRoot) {
                    const btn = xhs.shadowRoot.querySelector('button, [role="button"], .btn, .submit');
                    if (btn) { btn.click(); return 'shadow_clicked'; }
                }
                // 尝试查找内部 button
                const inner = xhs.querySelector('button');
                if (inner) { inner.click(); return 'inner_clicked'; }
                // 最后手段: click + dispatch
                xhs.click();
                xhs.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
                return 'force_clicked';
            }""")
            if clicked != 'no_element':
                publish_clicked = True
                print(f"   🚀 已点击发布 (Shadow DOM: {clicked})")

    # 方案D: 找红底"发布"按钮（兜底）
    if not publish_clicked:
        clicked = await page.evaluate("""() => {
            const all = document.querySelectorAll('button, [role="button"], div, span, xhs-publish-btn');
            for (const el of all) {
                const text = (el.textContent || '').trim();
                if ((text === '发布' || text === '发布笔记') && el.children.length <= 1) {
                    const rect = el.getBoundingClientRect();
                    if (rect.x > 250 && rect.width > 40 && rect.height > 20) {
                        if (el.shadowRoot) {
                            const btn = el.shadowRoot.querySelector('button');
                            if (btn) { btn.click(); return 'shadow_btn'; }
                        }
                        el.click();
                        return 'clicked';
                    }
                }
            }
            return 'not_found';
        }""")
        if clicked != 'not_found':
            publish_clicked = True
            print(f"   🚀 已点击发布 ({clicked})")

    if not publish_clicked:
        print("   ❌ 找不到发布按钮")
        await page.screenshot(path=str(DEBUG_DIR / f"{tag}-err-publish.png"))
        return {"success": False, "title": title, "error": "no_publish_btn"}

    # ── 7. 等待发布结果 ──
    #     先等 3s 检查即时反馈，再等 10s 确认最终状态
    await page.wait_for_timeout(3000)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-04a-waiting.png"))

    # 检查即时反馈
    quick_check = await page.evaluate("""() => {
        const body = document.body.textContent || '';
        return {
            hasSuccess: body.includes('发布成功') || body.includes('已发布'),
            hasReview: body.includes('审核中'),
            hasError: body.includes('发布失败') || body.includes('失败'),
            url: window.location.href,
            urlChanged: !window.location.href.includes('publish/publish')
        };
    }""")

    if quick_check['urlChanged'] or quick_check['hasSuccess']:
        # 发布成功了——页面已跳转或显示成功
        print(f"   ② 结果: ✅ 发布成功 (立即反馈)")
        await page.screenshot(path=str(DEBUG_DIR / f"{tag}-04b-success.png"))
        return {"success": True, "title": title, "url": quick_check['url']}

    # 再等 10s（长内容需要更多处理时间）
    await page.wait_for_timeout(10000)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-04c-done.png"))

    final_url = page.url
    final_check = await page.evaluate("""() => {
        const body = document.body.textContent || '';
        const xhsBtn = document.querySelector('xhs-publish-btn');
        return {
            hasSuccess: body.includes('发布成功') || body.includes('已发布'),
            hasReview: body.includes('审核中'),
            urlChanged: !window.location.href.includes('publish/publish'),
            btnGone: !xhsBtn,  // 发布按钮消失=表单已提交
            hasToast: !!document.querySelector('[class*="toast"], [class*="message"], [class*="notification"], [class*="notice"]')
        };
    }""")

    # 综合判断
    success = (
        final_check['urlChanged'] or
        final_check['hasSuccess'] or
        final_check['hasReview'] or
        final_check['btnGone']
    )

    status = '✅ 成功' if success else '❌ 失败'
    print(f"   ② 结果: {status}")
    if final_check['hasReview']:
        print(f"   ③ 笔记进入审核")
    if final_check['btnGone']:
        print(f"   ③ 发布按钮已消失（表单已提交）")
    if not success:
        print(f"   ③ URL: {final_url[:100]}")
        # 快速诊断
        diag = await page.evaluate("""() => ({
            hasXhsBtn: !!document.querySelector('xhs-publish-btn'),
            hasFilePicker: window.location.href.includes('openFilePicker'),
            bodyLen: document.body.textContent.length
        })""")
        print(f"   ③ 诊断: xhsBtn={diag['hasXhsBtn']} filePicker={diag['hasFilePicker']} bodyLen={diag['bodyLen']}")

    return {"success": success, "title": title, "url": final_url}


async def main():
    import argparse
    parser = argparse.ArgumentParser(description="小红书 v10 — 录制级精准选择器")
    parser.add_argument("--headless", type=str, default="false")
    parser.add_argument("--limit", type=int, default=3,
                        help="每日最多发帖数 (默认3)")
    parser.add_argument("--post-idx", type=int, default=None,
                        help="只发第 N 篇 (调试用)")
    parser.add_argument("--delay", type=int, default=180,
                        help="帖间间隔秒数 (默认180)")
    args = parser.parse_args()

    posts_json, posts_base, cover_dir = find_latest_posts_json()
    posts = load_posts(posts_json)
    if not posts:
        print("❌ 没有待发帖子 (posts.json 为空)")
        return

    if args.post_idx is not None and 0 <= args.post_idx < len(posts):
        posts = [posts[args.post_idx]]
    elif args.limit:
        posts = posts[:args.limit]

    print(f"📋 {len(posts)} 篇待发")
    for p in posts:
        print(f"   {p.get('title','')[:40]}")

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
            results.append(await publish_one(page, post, i, len(posts), posts_base, cover_dir))
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
        "version": "v10",
        "published_at": datetime.now().isoformat(),
        "total": len(results), "ok": ok, "posts": results,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"📝 记录: {record}")


if __name__ == "__main__":
    asyncio.run(main())
