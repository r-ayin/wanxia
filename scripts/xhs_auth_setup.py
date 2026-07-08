#!/usr/bin/env python3
"""One-time XHS auth setup — saves cookies to storage_state JSON."""
import asyncio, sys, json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "scripts" / ".xhs_auth.json"

if sys.platform == "win32":
    try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except: pass

async def main():
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=False, args=["--no-first-run"])
    ctx = browser.contexts[0] if browser.contexts else await browser.new_context()
    page = ctx.pages[0] if ctx.pages else await ctx.new_page()

    await page.goto("https://creator.xiaohongshu.com/", wait_until="domcontentloaded", timeout=20000)
    print(f"URL: {page.url[:80]}")

    if "login" in page.url:
        print("\n>>> LOGIN on this browser window. Then come back and press Enter. <<<")
        input()
        # Check if login succeeded
        await page.wait_for_timeout(2000)
        if "login" in page.url:
            print("Still on login page. Did you log in on THIS window?")
            return

    state = await ctx.storage_state()
    STATE.write_text(json.dumps(state, ensure_ascii=False))
    print(f"Auth saved: {STATE} ({len(json.dumps(state))} bytes)")
    await browser.close()
    await pw.stop()

asyncio.run(main())
