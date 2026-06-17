@echo off
chcp 65001 >nul
REM 设置 WSL→Windows 端口转发（以管理员身份运行）
REM 用法：右键 → 以管理员身份运行

echo 正在配置 WSL 端口转发...
wsl -d Ubuntu -- ip addr show eth0 | findstr "inet " | findstr /v "inet6" > %temp%\wsl-ip.txt
set /p WSL_IP=<%temp%\wsl-ip.txt

REM 提取 IP 地址
for /f "tokens=2 delims= " %%a in ('type %temp%\wsl-ip.txt') do set WSL_IP_ADDR=%%a
for /f "tokens=1 delims=/" %%a in ("%WSL_IP_ADDR%") do set WSL_IP=%%a

echo WSL IP: %WSL_IP%

REM 添加端口转发
netsh interface portproxy add v4tov4 listenport=8080 listenaddress=0.0.0.0 connectport=8080 connectaddress=%WSL_IP% 2>nul

REM 添加防火墙规则
netsh advfirewall firewall add rule name="WSL Wanxia 8080" dir=in action=allow protocol=TCP localport=8080 2>nul

echo.
echo ✅ 配置完成！
echo 访问 http://localhost:8080 查看晚霞预测
echo.
pause
