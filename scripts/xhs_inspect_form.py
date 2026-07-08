#!/usr/bin/env python3
"""测试脚本：提取 XHS 发布页表单结构"""
import asyncio, sys, json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
STORAGE_STATE = ROOT / "scripts" / ".xhs_storage_state.json"

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        ctx = await browser.new_context(
            storage_state=str(STORAGE_STATE),
            viewport={"width": 1440, "height": 900}, locale="zh-CN")
        page = await ctx.new_page()

        # 从首页点击发布图文笔记
        await page.goto("https://creator.xiaohongshu.com/new/home", timeout=30000)
        await page.wait_for_timeout(3000)

        pub_btn = page.locator("text=发布图文笔记").first
        if await pub_btn.count() > 0:
            await pub_btn.click()
            print("Clicked 发布图文笔记")

        await page.wait_for_timeout(5000)
        print("URL:", page.url[:100])

        # 提取表单元素
        js_code = """
        (function() {
            var r = {};
            r.url = location.href;
            r.bodyLen = document.body.innerHTML.length;

            var fields = document.querySelectorAll(
                'input:not([type="file"]):not([type="hidden"]), ' +
                'textarea, [contenteditable="true"]'
            );
            r.fields = [];
            fields.forEach(function(el) {
                r.fields.push({
                    tag: el.tagName,
                    type: el.type || "",
                    placeholder: el.placeholder || "",
                    id: el.id || "",
                    contenteditable: String(el.contentEditable || ""),
                    className: String(el.className || "").slice(0, 80),
                    visible: el.offsetParent !== null
                });
            });

            var btns = document.querySelectorAll("button, [role='button']");
            r.buttons = [];
            btns.forEach(function(b) {
                var t = (b.textContent || "").trim();
                if (t.length > 0 && t.length < 30) {
                    r.buttons.push({
                        text: t,
                        className: String(b.className || "").slice(0, 80),
                        disabled: b.disabled,
                        visible: b.offsetParent !== null
                    });
                }
            });

            return r;
        })()
        """
        info = await page.evaluate(js_code)
        print(json.dumps(info, indent=2, ensure_ascii=False, default=str))

        await browser.close()

asyncio.run(main())
