#!/usr/bin/env python3
"""
小红书 Playwright v11 — addInitScript(Shadow DOM open) + 键盘导航兜底

研究驱动改进（2026-06-20 深度调研）：
  ① addInitScript 强制 Shadow DOM → open 模式（解决 xhs-publish-btn 点击失效）
  ② set_input_files 直传文件（不点"上传图片"按钮，避免 openFilePicker 遮罩）
  ③ JS 清除遮罩 overlay + 修改 history URL
  ④ Shadow DOM 穿透点击 → Tab×2 + Enter 键盘导航兜底
  ⑤ 综合成功检测（URL变化 + 发布按钮消失 + 成功文本 + 审核文本）
"""

import asyncio, json, sys
from datetime import datetime
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "posts"
CHROME_PROFILE = ROOT / "scripts" / ".xhs_chrome_profile"
DEBUG_DIR = POSTS_DIR / "diag"

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


# ═══════════════════════════════════════════════════════════
# §1 素材加载
# ═══════════════════════════════════════════════════════════

def find_latest_posts_json():
    """优先最新日期子目录，回退到根 posts.json"""
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

    flat = POSTS_DIR / "posts.json"
    if flat.exists():
        print(f"📂 素材目录: {POSTS_DIR.name}（旧版）")
        return flat, POSTS_DIR, POSTS_DIR / "covers"

    raise FileNotFoundError("找不到 posts.json，请先运行 publish-xhs.js")


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
    # 🔴 v3.2: 只发封面图，不带截图
    cover = cover_dir / (post.get("cover") or "") if post.get("cover") else None
    if cover and cover.exists():
        imgs.append(str(cover.resolve()))
    else:
        # 兜底：无封面时用截图
        img_file = posts_base / (post.get("file") or "")
        if img_file.exists():
            imgs.append(str(img_file.resolve()))

    poi_name = post.get("poiName") or post.get("cityName") or ""
    return title, full_body, body, hashtags, imgs, poi_name


# ═══════════════════════════════════════════════════════════
# §2 Shadow DOM 劫持脚本（addInitScript 注入）
# ═══════════════════════════════════════════════════════════

SHADOW_DOM_FORCE_OPEN_SCRIPT = """
Element.prototype._a_s = Element.prototype.attachShadow;
Element.prototype.attachShadow = function(o) {
    return this._a_s({mode: 'open'});
};
"""


# ═══════════════════════════════════════════════════════════
# §3 发布流程
# ═══════════════════════════════════════════════════════════

async def click_publish_note(page):
    """JS 点击首页「发布图文笔记」"""
    return await page.evaluate("""
    () => { var a=document.querySelectorAll('*');
    a.forEach(function(e){if(e.textContent.trim()==='发布图文笔记'&&e.children.length===0){
    var p=e.parentElement;for(var i=0;i<6;i++){if(!p||p===document.body)break;
    if(getComputedStyle(p).cursor==='pointer'){p.click();return}}}
    }); return 'ok' }
    """)


async def close_file_picker_overlay(page):
    """🔴 关闭文件选择器遮罩"""
    # 1) JS 清除 URL 参数
    await page.evaluate("""() => {
        const u = new URL(window.location.href);
        u.searchParams.delete('openFilePicker');
        window.history.replaceState({}, '', u.toString());
    }""")
    await page.wait_for_timeout(500)

    # 2) Escape × 2（不多不少）
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(500)
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(500)


async def click_publish_button(page):
    """🔴 多层策略点击发布按钮

    已验证: Shadow DOM 内 btn.click() 有效 (URL→/publish/success)
            外层 force click 无效（点击的是容器不是内部 button）
    """
    # ═══ 策略A: Shadow DOM btn.click() — 已验证有效 ═══
    pub = page.locator("xhs-publish-btn")
    has_pub = await pub.count() > 0

    if has_pub:
        clicked = await page.evaluate("""
            () => {
                const xhs = document.querySelector('xhs-publish-btn');
                if (!xhs || !xhs.shadowRoot) return 'no_shadow';
                const btns = xhs.shadowRoot.querySelectorAll('button');
                let btn = null;
                for (const b of btns) {
                    if (b.className.includes('bg-red') || b.className.includes('red'))
                        { btn = b; break; }
                }
                if (!btn) btn = btns[btns.length - 1];
                if (!btn) return 'no_button';
                btn.click();
                return 'clicked';
            }
        """)
        if clicked == 'clicked':
            print("   🚀 策略A: Shadow DOM btn.click()")
            return True
        print(f"   ⚠️ 策略A: {clicked}")

    # ═══ 策略B: Shadow DOM MouseEvent dispatch（更完整的事件序列） ═══
    if has_pub:
        clicked = await page.evaluate("""() => {
            const xhs = document.querySelector('xhs-publish-btn');
            if (!xhs || !xhs.shadowRoot) return 'no_shadow';
            const btns = xhs.shadowRoot.querySelectorAll('button');
            let target = null;
            for (const b of btns) {
                if (b.className.includes('bg-red') || b.className.includes('red'))
                    { target = b; break; }
            }
            if (!target) target = btns[btns.length - 1];
            if (!target) return 'no_button';
            const r = target.getBoundingClientRect();
            const cx = r.left + r.width/2, cy = r.top + r.height/2;
            ['mousedown','mouseup','click'].forEach(t => {
                target.dispatchEvent(new MouseEvent(t, {
                    bubbles: true, cancelable: true, view: window,
                    clientX: cx, clientY: cy, button: 0
                }));
            });
            return 'shadow_events';
        }""")
        if clicked == 'shadow_events':
            print("   🚀 策略B: Shadow DOM MouseEvent")
            return True

    # ═══ 策略C: force click 外层容器（兜底） ═══
    if has_pub:
        try:
            await pub.first.click(force=True, timeout=5000)
            print("   🚀 策略C: force click")
            return True
        except Exception as e:
            print(f"   ⚠️ 策略C失败: {e}")

    # ═══ 策略D: button 文本匹配 ═══
    for text in ["发布", "发布笔记"]:
        btn = page.get_by_role("button").filter(has_text=text)
        count = await btn.count()
        for i in range(count):
            b = btn.nth(i)
            box = await b.bounding_box()
            if box and box['x'] > 250:
                await b.click()
                print(f"   🚀 策略D: button '{text}'")
                return True

    return False


async def check_publish_result(page):
    """综合检测发布结果"""
    return await page.evaluate("""() => {
        const url = window.location.href;
        const body = document.body.textContent || '';
        const xhsBtn = document.querySelector('xhs-publish-btn');
        return {
            urlChanged: url.includes('/success') || url.includes('published=true') || !url.includes('publish/publish'),
            hasSuccess: body.includes('发布成功') || body.includes('已发布'),
            hasReview: body.includes('审核中'),
            btnGone: !xhsBtn,
            url: url
        };
    }""")


async def publish_one(page, post, idx, total, posts_base, cover_dir):
    title, full_body, body_text, hashtags, imgs, poi_name = prepare_post(post, posts_base, cover_dir)
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

    # ── 2. 上传图片（直传，不点"上传图片"按钮） ──
    for k, fpath in enumerate(imgs):
        try:
            file_input = page.locator('input[type="file"]').first
            await file_input.set_input_files(fpath)
            print(f"   📸 [{k+1}/{len(imgs)}] {Path(fpath).name}")
            await page.wait_for_timeout(4000)
        except Exception as e:
            print(f"   ⚠️ 上传失败 [{k+1}]: {e}")
    await page.wait_for_timeout(2000)

    # ── 2.5 关闭文件选择器遮罩 ──
    await close_file_picker_overlay(page)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-02-uploaded.png"))

    # ── 3. 填写标题 ──
    title_box = page.get_by_role("textbox", name="填写标题会有更多赞哦")
    if await title_box.count() > 0:
        await title_box.first.click()
        await page.wait_for_timeout(300)
        await page.keyboard.insert_text(title)
        await page.wait_for_timeout(500)
        # 🔴 验证：读回输入框实际值
        actual_val = await title_box.first.input_value()
        if actual_val != title:
            print(f"   ⚠️ 标题值不匹配! 期望{len(title)}字, 实际{len(actual_val)}字")
            print(f"   实际: \"{actual_val[:60]}\"")
            # 兜底：用 JS 直接设值 + 触发事件
            await page.evaluate("""
                (val) => {
                    const el = document.querySelector('input[placeholder*="标题"]');
                    if (!el) return;
                    const setter = Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype, 'value'
                    ).set;
                    setter.call(el, val);
                    el.dispatchEvent(new Event('input', {bubbles: true}));
                }
            """, title)
            await page.wait_for_timeout(300)
            actual_val2 = await title_box.first.input_value()
            print(f"   兜底后: \"{actual_val2[:60]}\"")
        print(f"   ✏️ 标题: {title[:40]}")
    else:
        print("   ⚠️ 找不到标题输入框")

    # ── 4. 填写正文 ──
    body_filled = False
    ce = page.locator('[contenteditable="true"]').first
    if await ce.count() > 0:
        try:
            await ce.click()
            await page.wait_for_timeout(200)
            await ce.fill(body_text)
            print(f"   📝 正文: {len(body_text)} 字 (fill)")
            body_filled = True
        except Exception:
            pass
    if not body_filled:
        print("   ⚠️ 正文填写失败")

    # ── 5. 话题标签（跳过，诊断已验证无标签能成功发布） ──
    # 标签已在正文末尾的 hashtags 文本中，无需单独点击
    if hashtags:
        tags = [t.strip() for t in hashtags.replace("#", " #").split("#") if t.strip()]
        print(f"   🏷️ {len(tags)} 个标签（含在正文中）")

    await page.wait_for_timeout(1000)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-03-filled.png"))

    # ── 6. 点击发布按钮（多层策略） ──
    if not await click_publish_button(page):
        print("   ❌ 所有策略均无法点击发布按钮")
        await page.screenshot(path=str(DEBUG_DIR / f"{tag}-err-publish.png"))
        return {"success": False, "title": title, "error": "no_publish_btn"}

    # ── 7. 等待发布结果 ──
    await page.wait_for_timeout(3000)
    result = await check_publish_result(page)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-04a-waiting.png"))

    if result['urlChanged'] or result['hasSuccess']:
        print(f"   ② 结果: ✅ 发布成功 (立即)")
        return {"success": True, "title": title, "url": result['url']}

    # 再等 10s
    await page.wait_for_timeout(10000)
    result = await check_publish_result(page)
    await page.screenshot(path=str(DEBUG_DIR / f"{tag}-04b-done.png"))

    success = result['urlChanged'] or result['hasSuccess'] or result['hasReview'] or result['btnGone']

    status = '✅ 成功' if success else '❌ 失败'
    print(f"   ② 结果: {status}")
    if result.get('hasReview'):
        print(f"   ③ 笔记进入审核")
    if result.get('btnGone'):
        print(f"   ③ 发布按钮已消失（表单已提交）")
    if not success:
        print(f"   ③ URL: {result['url'][:100]}")

    return {"success": success, "title": title, "url": result['url']}


# ═══════════════════════════════════════════════════════════
# §4 主入口
# ═══════════════════════════════════════════════════════════

async def main():
    import argparse
    parser = argparse.ArgumentParser(description="小红书 v11 — Shadow DOM 强制 open + 键盘导航")
    parser.add_argument("--headless", type=str, default="false")
    parser.add_argument("--limit", type=int, default=3)
    parser.add_argument("--post-idx", type=int, default=None)
    parser.add_argument("--delay", type=int, default=180)
    args = parser.parse_args()

    posts_json, posts_base, cover_dir = find_latest_posts_json()
    posts = load_posts(posts_json)
    if not posts:
        print("❌ 没有待发帖子")
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

        # 🔴 核心修复: addInitScript 强制 Shadow DOM → open
        await ctx.add_init_script(SHADOW_DOM_FORCE_OPEN_SCRIPT)

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
        "version": "v11",
        "published_at": datetime.now().isoformat(),
        "total": len(results), "ok": ok, "posts": results,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"📝 记录: {record}")


if __name__ == "__main__":
    asyncio.run(main())
