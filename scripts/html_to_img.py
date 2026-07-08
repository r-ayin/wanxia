"""HTML → 长图渲染，适配微信阅读"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

HTML_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent.parent / "posts" / "evomap_article.html"
OUT_PATH = Path(sys.argv[2]) if len(sys.argv) > 2 else HTML_PATH.with_suffix(".png")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 440, "height": 800}, device_scale_factor=2)
    page.goto(f"file:///{HTML_PATH.as_posix()}", wait_until="networkidle")
    page.wait_for_timeout(2000)
    # 获取全文高度
    height = page.evaluate("document.body.scrollHeight")
    page.set_viewport_size({"width": 440, "height": height})
    page.screenshot(path=str(OUT_PATH), full_page=True)
    browser.close()
    print(f"OK: {OUT_PATH} ({Path(OUT_PATH).stat().st_size // 1024}KB)")
