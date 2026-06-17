@echo off
chcp 65001 >nul
REM Wanxia 晚霞预测系统 — Windows 自启脚本
REM 放在 shell:startup 下开机自启

cd /d E:\x-tool\wanxia
start "" wsl -d Ubuntu -- cd /mnt/e/x-tool/wanxia && node server.js

echo Wanxia started on port 8080
