#!/usr/bin/env python3
"""穿透 Shadow DOM 查找 XHS 发布页表单"""
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

        await page.goto("https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image_text", timeout=30000)
        await page.wait_for_timeout(5000)

        # 穿透 Shadow DOM
        js_code = """
        (function() {
            var r = {};

            function findShadowForms(root, depth) {
                if (depth > 10) return [];
                var result = [];
                var els = root.querySelectorAll('*');
                for (var i = 0; i < els.length; i++) {
                    var el = els[i];
                    if (el.shadowRoot) {
                        var sr = el.shadowRoot;
                        // 找 shadow 中的 input/textarea/contenteditable
                        var fields = sr.querySelectorAll(
                            'input:not([type="file"]):not([type="hidden"]), ' +
                            'textarea, [contenteditable="true"]'
                        );
                        fields.forEach(function(f) {
                            result.push({
                                tag: f.tagName,
                                type: f.type || '',
                                placeholder: f.placeholder || '',
                                contenteditable: String(f.contentEditable || ''),
                                depth: depth
                            });
                        });

                        var btns = sr.querySelectorAll('button, [role="button"]');
                        btns.forEach(function(b) {
                            var t = (b.textContent || '').trim();
                            if (t.length > 0 && t.length < 30) {
                                result.push({
                                    tag: 'BUTTON',
                                    text: t,
                                    disabled: b.disabled,
                                    depth: depth
                                });
                            }
                        });

                        // 递归
                        result = result.concat(findShadowForms(sr, depth + 1));
                    }
                }
                return result;
            }

            r.shadowFields = findShadowForms(document, 0);
            r.total = r.shadowFields.length;
            return r;
        })()
        """
        info = await page.evaluate(js_code)
        print(json.dumps(info, indent=2, ensure_ascii=False, default=str))

        await browser.close()

asyncio.run(main())
