#!/usr/bin/env python3
"""
终极方案：Playwright 启动含 cookie 浏览器 → Browser Use 通过 CDP 接管
Cookie 由 Playwright 管理（已验证有效），Browser Use 只负责操控 UI
"""
import asyncio, json, re, subprocess, sys, time
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "posts"
POSTS_JSON = POSTS_DIR / "posts.json"
ENV_FILE = ROOT / ".env"
USER_DATA_DIR = ROOT / "scripts" / ".xhs_browser_profile"
CDP_PORT = 9223

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def get_cookies_from_env():
    content = ENV_FILE.read_text("utf-8")
    m = re.search(r"^XIAOHONGSHU_COOKIE=(.+)$", content, re.MULTILINE)
    if not m:
        return []
    cookies = []
    for item in m.group(1).split(";"):
        item = item.strip()
        if "=" not in item:
            continue
        name, _, value = item.partition("=")
        cookies.append({
            "name": name.strip(), "value": value.strip(),
            "domain": ".xiaohongshu.com", "path": "/",
            "httpOnly": "token" in name.lower() or "session" in name.lower(),
            "secure": True, "sameSite": "Lax",
        })
    return cookies


def launch_cdp_browser():
    """用 Playwright 启动带 cookie 的浏览器，返回 CDP URL"""
    import shutil
    if USER_DATA_DIR.exists():
        shutil.rmtree(str(USER_DATA_DIR), ignore_errors=True)

    # 直接用 subprocess 启动 Chrome + remote debugging
    import shutil as sh
    chrome = sh.which("google-chrome") or sh.which("chrome") or sh.which("chromium") or ""
    if not chrome:
        # 找 Playwright 自带的 Chromium
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=False)
            chrome = browser.version.split()[0]  # 没用，换思路
            browser.close()
        # 遍历 Playwright 的 browsers 目录
        pw_browsers = Path.home() / "AppData" / "Local" / "ms-playwright"
        for exe in pw_browsers.rglob("chrome.exe"):
            chrome = str(exe)
            break
        if not chrome:
            for exe in pw_browsers.rglob("chromium.exe"):
                chrome = str(exe)
                break

    if not chrome:
        raise RuntimeError("找不到 Chrome/Chromium 可执行文件")

    # 把 cookie 写入 user_data_dir
    import shutil
    if USER_DATA_DIR.exists():
        shutil.rmtree(str(USER_DATA_DIR), ignore_errors=True)
    USER_DATA_DIR.mkdir(parents=True, exist_ok=True)

    # 启动 Chrome with remote debugging
    cmd = [
        chrome,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={USER_DATA_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled",
        "about:blank",
    ]

    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)

    return f"http://127.0.0.1:{CDP_PORT}"


def inject_cookies_via_cdp(cdp_url):
    """通过 CDP 注入 cookie"""
    import urllib.request, json as j

    # 获取可用的 page target
    req = urllib.request.Request(f"{cdp_url}/json")
    targets = j.loads(urllib.request.urlopen(req, timeout=5).read())
    page_target = None
    for t in targets:
        if t.get("type") == "page":
            page_target = t
            break

    if not page_target:
        return False

    ws_url = page_target["webSocketDebuggerUrl"]

    # 用 websocket 注入 cookie... 太复杂。换个方法：
    # 直接用 Playwright connect_over_cdp + add_cookies
    return True


async def main():
    cookies = get_cookies_from_env()
    if not cookies:
        print("❌ 无 cookie")
        return

    print(f"🍪 {len(cookies)} 个 cookie")

    # 用 Playwright 启动浏览器并注入 cookie
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(cdp_url)
        contexts = browser.contexts
        if not contexts:
            page = await browser.new_page()
            ctx = page.context
        else:
            ctx = contexts[0]

        await ctx.add_cookies(cookies)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        # 验证登录
        await page.goto("https://creator.xiaohongshu.com/new/home", timeout=30000)
        await page.wait_for_timeout(5000)
        url = page.url
        if "/login" in url:
            print(f"❌ Cookie 无效 ({url[:80]})")
            # 杀掉 chrome 进程
            subprocess.run(["taskkill", "/F", "/PID", str(proc.pid)] for proc in [subprocess.Popen])  # noqa
            return

        print(f"✅ Cookie 有效 ({url[:80]})")
        print(f"🔗 CDP: {cdp_url}")

        # 保持浏览器打开，Browser Use 通过 CDP 连接
        print(f"\n{'═'*50}")
        print("浏览器就绪！现在启动 Browser Use Agent...")
        print(f"{'═'*50}\n")

        # 关闭 Playwright 连接（不关闭浏览器）
        # browser.close() 会尝试关闭连接的浏览器，用 dispose 或直接断开
        try:
            await browser.close()
        except Exception:
            pass

    # 现在用 Browser Use 通过 CDP 接管
    from browser_use import Agent, Browser, ChatAnthropic

    with open(POSTS_JSON, "r", encoding="utf-8") as f:
        package = json.load(f)
    city_posts = [p for p in package.get("posts", []) if p.get("score")]

    results = []
    for idx, post in enumerate(city_posts):
        title = post.get("title", "")
        copy_file = POSTS_DIR / (post.get("copyFile") or "")
        img_file = POSTS_DIR / (post.get("file") or "")
        cover_name = post.get("cover") or ""

        raw = copy_file.read_text("utf-8").strip() if copy_file.exists() else ""
        lines = raw.split("\n")
        post_title = lines[0].strip()
        body_parts, hashtags = [], ""
        for l in lines[1:]:
            s = l.strip()
            if s.startswith("#"): hashtags = s
            elif s: body_parts.append(l)
        body = "\n".join(body_parts)
        full_body = f"{body}\n\n{hashtags}" if hashtags else body

        available_paths = []
        cover_path = POSTS_DIR / "covers" / cover_name if cover_name else None
        if cover_path and cover_path.exists():
            available_paths.append(str(cover_path.resolve()))
        if img_file.exists():
            available_paths.append(str(img_file.resolve()))

        img_list_str = "\n".join(f"  - {Path(p).name}" for p in available_paths)
        cover_note = "\n【图片顺序重要】先上传封面图，再上传截图。" if cover_path else ""

        task = f"""你在一个已经登录的小红书创作者平台。请发布一篇晚霞预报笔记：

【起始操作】
先在浏览器地址栏输入 https://creator.xiaohongshu.com/new/home 回车，确认看到创作者中心仪表盘（显示「发布笔记」「发布图文笔记」按钮即已登录）。

【发布内容】
标题: {post_title}
正文:
{body}
标签: {hashtags}
图片:
{img_list_str}
{cover_note}
【操作步骤】
1. 导航到 https://creator.xiaohongshu.com/new/home
2. 等待页面加载，看到「发布图文笔记」或「发布笔记」按钮
3. 点击「发布图文笔记」
4. 在发布页上传图片（按顺序，封面第一张截图第二张）
5. 填写标题: {post_title}
6. 填写正文和标签
7. 点击「发布」按钮
8. 确认发布成功

【关键】
- 你已经登录了，不要管登录页面。直接操作。
- 正文中 emoji 保留
"""

        print(f"\n{'─'*50}")
        print(f"[{idx+1}/{len(city_posts)}] {post_title[:30]}")

        browser = Browser(
            cdp_url=cdp_url,
            keep_alive=True,
            window_size={"width": 1440, "height": 900},
        )
        llm = ChatAnthropic(model="claude-sonnet-4-0", temperature=0.0, thinking={"type": "disabled"})
        agent = Agent(
            task=task, llm=llm, browser=browser,
            use_vision=True, use_thinking=False,
            available_file_paths=available_paths,
            max_failures=2, max_actions_per_step=3, max_steps=20,
        )

        try:
            result = await agent.run()
            results.append({"success": True, "title": post_title})
            print(f"   ✅ 完成")
        except Exception as e:
            print(f"   ❌ {e}")
            results.append({"success": False, "title": post_title, "error": str(e)})

        if idx < len(city_posts) - 1:
            await asyncio.sleep(30)

    # 汇总
    ok = sum(1 for r in results if r["success"])
    print(f"\n{'═'*50}")
    print(f"📊 {ok}/{len(results)} 成功")

    # 关闭 Chrome
    subprocess.run(["taskkill", "/F", "/IM", "chrome.exe"], capture_output=True)

    record_file = POSTS_DIR / f"publish-record-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    with open(record_file, "w", encoding="utf-8") as f:
        json.dump({"published_at": datetime.now().isoformat(), "total": len(results), "ok": ok, "posts": results}, f, indent=2, ensure_ascii=False)
    print(f"📝 {record_file}")


asyncio.run(main())
