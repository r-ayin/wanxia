@echo off
chcp 65001 >nul
REM Wanxia 晚霞预测系统 — 开机自启脚本
REM 放到 shell:startup 目录下（Win+R → shell:startup）

cd /d E:\x-tool\wanxia

REM 检查是否已在运行
curl -s http://localhost:8080/api/predictions >nul 2>&1
if %errorlevel% equ 0 (
    echo Wanxia already running on port 8080
    exit /b 0
)

REM 直接 Windows Node.js 启动（不依赖 WSL）
start "Wanxia" /MIN node server.js

echo Wanxia started on port 8080
