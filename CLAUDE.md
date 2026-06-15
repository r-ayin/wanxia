# wanxia — 晚霞预报小红书账号

> 遵循工作区协议 [PROTOCOL.md](../PROTOCOL.md)

## 项目身份
- **名称**：晚霞预报系统 (Sunset Forecast)
- **目的**：晚霞质量预测 + 小红书内容自动发布
- **技术栈**：Node.js / Express / SQLite / React
- **入口**：`start-wanxia.bat`

## 快速命令
```bash
cd E:\x-tool\wanxia
start-wanxia.bat          # 启动服务
node server.js            # 或直接启动
```

## 项目规则
1. **数据库** `data/sunset.db` — 任何变更前先备份
2. **预报算法** 在 `server.js` 中 — 修改后必须跑 `health-check.py` 验证
3. **小红书自动化** 在 `src/social-scraper.js` 和 `scripts/social-calibrate.js` — 小红书 API 有严格限流，谨慎调整频率
4. **前端** 在 `src/` — React SPA，`npm run build` 输出到 `public/`

## 关联文件
- [PROGRESS.md](./PROGRESS.md) — 进度追踪
- [GATES.md](./GATES.md) — 质量门禁
- `scripts/social-calibrate.js` — 社媒校准脚本
- `health-check.py` — 健康检查
