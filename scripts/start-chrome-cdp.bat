@echo off
REM Start Chrome with remote debugging for CDP connection
REM Close all existing Chrome instances first for clean CDP port
taskkill /F /IM chrome.exe 2>nul
timeout /t 2 /nobreak >nul
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --no-first-run --no-default-browser-check
echo Chrome started with CDP port 9222
echo 1. Navigate to https://creator.xiaohongshu.com/ and log in
echo 2. Run: python scripts/xhs_cdp_poster.py
