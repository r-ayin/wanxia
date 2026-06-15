# wanxia — 质量门禁

## 🔴 CRITICAL（不通过则不得合入）
- [ ] `node server.js` 可正常启动
- [ ] `python health-check.py` 通过
- [ ] `data/sunset.db` 未被误删或破坏
- [ ] 无硬编码密钥/令牌
- [ ] PROGRESS.md 已更新

## 🟡 IMPORTANT（不通过需注释原因）
- [ ] 预报算法改动后已验证准确率
- [ ] 前端改动后 `npm run build` 通过
- [ ] 小红书 API 调用频率在限流范围内

## 🟢 NICE（尽量满足）
- [ ] 新增逻辑有对应测试
- [ ] 前端改动已截图记录
