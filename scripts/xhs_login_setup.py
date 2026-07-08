#!/usr/bin/env python3
"""Playwright 登录 → 同时产出 Playwright + Browser Use 兼容的 storage_state"""
import asyncio, json, re, shutil, sys
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"
STORAGE_STATE = ROOT / "scripts" / ".xhs_storage_state.json"
STORAGE_BAK = ROOT / "scripts" / ".xhs_storage_state.json.bak"
# 用 Playwright 的 persistent context 目录作为 Browser Use 的 user_data_dir
CHROME_PROFILE = ROOT / "scripts" / ".xhs_chrome_profile"

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


async def main():
    print("🚀 打开浏览器 → 请扫码登录小红书创作者平台")
    print("⏳ 自动检测登录（URL 不再是 /login 即完成）...\n")

    # 清除旧文件
    shutil.rmtree(str(CHROME_PROFILE), ignore_errors=True)
    STORAGE_STATE.unlink(missing_ok=True)

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            str(CHROME_PROFILE),
            headless=False,
            viewport={"width": 1440, "height": 900},
            locale="zh-CN",
        )
        page = await ctx.new_page()
        await page.goto("https://creator.xiaohongshu.com", timeout=30000)

        # 等登录
        for i in range(120):
            await asyncio.sleep(3)
            url = page.url
            if "/login" not in url:
                print(f"✅ 登录成功 ({url[:60]})")
                break
            if i % 15 == 0:
                print(f"   ⏳ {url[:50]}")

        await asyncio.sleep(3)

        # 1) 导出 Playwright 格式 storage_state
        await ctx.storage_state(path=str(STORAGE_STATE))
        p_size = STORAGE_STATE.stat().st_size

        # 2) 导出 cookie 字符串 → .env
        cookies = await ctx.cookies()
        cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies if c.get("name"))
        content = ENV_FILE.read_text("utf-8")
        new_content = re.sub(
            r"^XIAOHONGSHU_COOKIE=.*$",
            f"XIAOHONGSHU_COOKIE={cookie_str}",
            content, flags=re.MULTILINE,
        )
        if new_content != content:
            ENV_FILE.write_text(new_content, "utf-8")

        # 3) 生成 Browser Use 兼容格式（storage_state JSON）
        bu_cookies = []
        for c in cookies:
            bu_cookies.append({
                "name": c.get("name", ""),
                "value": c.get("value", ""),
                "domain": c.get("domain", ".xiaohongshu.com"),
                "path": c.get("path", "/"),
                "httpOnly": c.get("httpOnly", False),
                "secure": c.get("secure", True),
                "sameSite": c.get("sameSite", "Lax"),
            })
        bu_state = {"cookies": bu_cookies, "origins": []}
        STORAGE_STATE.write_text(json.dumps(bu_state, indent=2, ensure_ascii=False), "utf-8")
        bu_size = STORAGE_STATE.stat().st_size

        # 🔴 关键：备份到 .bak（此文件永不被动——只读）
        shutil.copy(STORAGE_STATE, STORAGE_BAK)
        # Windows 只读
        import os
        os.chmod(str(STORAGE_BAK), 0o444)

        await ctx.close()

    print(f"\n✅ storage_state: {bu_size} bytes (Browser Use 兼容)")
    print(f"✅ 备份（只读）: {STORAGE_BAK.stat().st_size} bytes")
    print(f"✅ Chrome Profile: {CHROME_PROFILE}")
    print(f"✅ .env 已更新 ({len(cookies)} cookie)")
    print(f"\n🔧 现在可以发帖了")


asyncio.run(main())
