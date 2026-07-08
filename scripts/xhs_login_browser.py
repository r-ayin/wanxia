#!/usr/bin/env python3
"""打开浏览器让用户登录小红书，登录后 Claude 触发导出"""
import asyncio, json, sys
from pathlib import Path
from browser_use import Browser

ROOT = Path(__file__).resolve().parent.parent
STORAGE_STATE = ROOT / "scripts" / ".xhs_storage_state.json"
READY_FILE = ROOT / "scripts" / ".xhs_ready_to_export"

async def main():
    # 清除就绪标记
    READY_FILE.unlink(missing_ok=True)

    browser = Browser(
        headless=False,
        keep_alive=True,
        window_size={"width": 1440, "height": 900},
    )
    await browser.start()
    page = await browser.get_current_page()
    await page.goto("https://creator.xiaohongshu.com")

    print("✅ 浏览器已打开 → 请扫码登录小红书创作者平台")
    print(f"   登录完成后等待 Claude 触发导出（文件: {READY_FILE}）")
    print(f"   PID: {browser}")

    # 等待就绪信号文件出现
    while not READY_FILE.exists():
        await asyncio.sleep(2)

    # 导出 storage state
    print("📥 导出 cookie...")
    await browser.export_storage_state(str(STORAGE_STATE))
    print(f"✅ storage_state 已导出: {STORAGE_STATE}")

    # 也导出 cookie 字符串到 .env
    cookies = await page.context.cookies()
    cookie_parts = [f"{c['name']}={c['value']}" for c in cookies if c.get("name")]
    cookie_str = "; ".join(cookie_parts)
    print(f"📋 Cookie 字符串 ({len(cookie_parts)} 个):")
    print(cookie_str[:200] + "...")

    # 更新 .env
    import re
    env_file = ROOT / ".env"
    content = env_file.read_text(encoding="utf-8")
    new_content = re.sub(
        r"^XIAOHONGSHU_COOKIE=.*$",
        f"XIAOHONGSHU_COOKIE={cookie_str}",
        content, flags=re.MULTILINE
    )
    if new_content != content:
        env_file.write_text(new_content, encoding="utf-8")
        print("✅ .env 已更新")

    await browser.close()
    print("✅ 完成！可以开始发帖了")

asyncio.run(main())
