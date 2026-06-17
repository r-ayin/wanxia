#!/usr/bin/env python3
"""
🫀 小红书 Cookie 保活 — 定期访问 creator.xiaohongshu.com 验证登录态

原理：
  - 小红书 cookie 生命周期 ~24h（access-token 可能更短）
  - 定期访问创作者中心首页，模拟正常用户活动
  - 检测到登录页 → cookie 过期 → 告警

Usage:
  python scripts/xhs_keepalive.py                  # 验证一次
  python scripts/xhs_keepalive.py --cron            # 适合定时任务（静默输出）
"""

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STORAGE_STATE = ROOT / "scripts" / ".xhs_storage_state.json"
ENV_FILE = ROOT / ".env"
HEALTH_LOG = ROOT / "scripts" / ".xhs_health.json"


def load_env() -> dict:
    env = {}
    if ENV_FILE.exists():
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, _, v = line.partition("=")
                    env[k.strip()] = v.strip()
    import os
    for k, v in os.environ.items():
        env.setdefault(k, v)
    return env


def update_env_cookie(cookie_str: str) -> None:
    """更新 .env 中的 XIAOHONGSHU_COOKIE"""
    content = ENV_FILE.read_text(encoding="utf-8")
    import re
    new_content = re.sub(
        r"^XIAOHONGSHU_COOKIE=.*$",
        f"XIAOHONGSHU_COOKIE={cookie_str}",
        content,
        flags=re.MULTILINE,
    )
    if new_content != content:
        ENV_FILE.write_text(new_content, encoding="utf-8")
        print(f"   ✅ .env 已更新")


def save_health(ok: bool, details: dict) -> None:
    """记录健康检查日志"""
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "ok": ok,
        **details,
    }
    history = []
    if HEALTH_LOG.exists():
        try:
            history = json.loads(HEALTH_LOG.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            history = []
    history.append(record)
    # 保留最近 30 条
    if len(history) > 30:
        history = history[-30:]
    HEALTH_LOG.write_text(json.dumps(history, indent=2, ensure_ascii=False), encoding="utf-8")


async def check() -> dict:
    """检查小红书 cookie 是否有效"""
    from browser_use import Browser

    browser = Browser(
        headless=True,
        storage_state=str(STORAGE_STATE) if STORAGE_STATE.exists() else None,
        window_size={"width": 1440, "height": 900},
        keep_alive=False,
    )

    try:
        await browser.start()
        page = await browser.get_current_page()
        await page.goto("https://creator.xiaohongshu.com", wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(3)

        url = page.url
        title = await page.title()

        is_logged_in = "/login" not in url.lower() and "登录" not in title

        # Export fresh cookies (they get refreshed by the visit)
        if is_logged_in:
            await browser.export_storage_state(str(STORAGE_STATE))

            # Also update .env cookie string
            cookies = await page.context.cookies()
            cookie_str = "; ".join([f"{c['name']}={c['value']}" for c in cookies if c.get("name")])
            update_env_cookie(cookie_str)

        await browser.close()

        return {
            "logged_in": is_logged_in,
            "url": url,
            "title": title,
        }

    except Exception as e:
        try:
            await browser.close()
        except Exception:
            pass
        return {"logged_in": False, "error": str(e)}


async def main():
    parser = argparse.ArgumentParser(description="🫀 小红书 Cookie 保活")
    parser.add_argument("--cron", action="store_true", help="静默模式（适合定时任务）")
    args = parser.parse_args()

    if not args.cron:
        print("🫀 小红书 Cookie 健康检查")
        print("─" * 40)

    env = load_env()
    if not STORAGE_STATE.exists():
        cookie_str = env.get("XIAOHONGSHU_COOKIE", "")
        if not cookie_str:
            print("❌ 无 storage_state 且无 XIAOHONGSHU_COOKIE")
            sys.exit(1)

    result = await check()

    save_health(result["logged_in"], result)

    if result["logged_in"]:
        msg = f"✅ Cookie 有效 (session refreshed)"
        if not args.cron:
            print(msg)
    else:
        error = result.get("error", f"URL: {result.get('url', '?')}")
        msg = f"❌ Cookie 已过期！需要重新登录: {error}"
        print(msg)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
