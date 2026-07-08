# wanxia — 质量门禁

## 🔴 CRITICAL（不通过则不得合入）
- [x] `node server.js` 可正常启动（v10 验证通过 ✅）
- [ ] `python health-check.py` 通过
- [x] `data/sunset.db` 未被误删或破坏（2026-06-19 验证存在 ✅）
- [x] 无硬编码密钥/令牌（`.env` gitignored，代码中仅引用 `process.env` ✅）
- [x] PROGRESS.md 已更新（2026-06-20 ✅）
- [ ] 🔴 **反自动化检测门禁（新增 2026-06-20）**: 任何自动发帖代码必须通过反检测审查——不得使用裸 Playwright CDP、不得固定间隔、不得遗漏人行为模拟

## 🟡 IMPORTANT（不通过需注释原因）
- [ ] 预报算法改动后已验证准确率
- [ ] 前端改动后 `npm run build` 通过
- [ ] 小红书 API 调用频率在限流范围内

## 🟢 NICE（尽量满足）
- [ ] 新增逻辑有对应测试
- [ ] 前端改动已截图记录
