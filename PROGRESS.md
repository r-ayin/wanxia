# wanxia — 进度追踪

> 最后更新：2026-07-18 CST | 🔴 自动发帖仍停用 | CDP 模式已落地 | 待 E2E 验证

## 状态
<!-- STATUS: blocked -->
<!-- BLOCKED_SINCE: 2026-06-20 -->
<!-- BLOCK_REASON: 小红书检测到自动化脚本——v11 addInitScript Shadow DOM + launch模式 + 固定延迟 被多层检测命中；CDP 模式已实施，待反检测效果验证 -->

## 当前任务
<!-- TASK: CDP 模式 E2E 验证 + 行为拟态调优 -->
<!-- TASK_STATUS: in_progress -->
<!-- NEXT: 验证 CDP 反检测效果 → 行为拟态（随机延迟/鼠标轨迹） → 恢复小流量自动发帖 -->
<!-- RESEARCH: ✅ 深度研究完成 → docs/anti-detection-research.md -->
<!-- RESEARCH: ✅ CDP 方案已落地 → scripts/xhs_cdp_poster.py / xhs_persistent_poster.py -->

## v2.0 图文优化（2026-06-18）
- [x] 文案引擎 v2.0: 扩颜色变体(7→10 hex, 每色5-6表达 + 季节轮换)
- [x] 去技术化: 子分数叙事→人话（"高云条件好"→"云在高处，容易着色"）
- [x] 连续趋势感知: 3日连续走高/走低 + 5日持续高位检测
- [x] 季节感: 夏烧冬暖春秋透亮 + 季节动态标签
- [x] 蹲点时效化: 高分→best spots, 低分→quick spots
- [x] 天气简报: 温度+天气描述+湿度
- [x] 社交分享卡生成器: generate-social-card.js (1080×1350, 4:5)

## v2.1 AI 封面图（2026-06-18）
- [x] GPT-Image-2 API 接入: generate-cover-image.py（深度智算，1024×1536 2:3）
- [x] 智能 Prompt: 按城市+分数+色调+地标动态构建摄影级 prompt
- [x] 管线集成: publish-xhs.js 截图后自动调用封面生成
- [x] Browser Use 适配: 封面图作为首图上传，截图作为第二张
- [x] 环境变量: GPT_IMAGE_API_KEY + GPT_IMAGE_COVER_ENABLED + GPT_IMAGE_COVER_LIMIT
- [x] Cron 超时: 12:00 管线从 2min → 15min（含封面 ~5min）

## v2.2 发帖可靠性（2026-06-18 → 2026-06-19）
- [x] **根因分析**: Browser Use Agent 无法突破 XHS Shadow DOM 文件上传保护 (`writable: false`)
- [x] **Playwright 直连方案**: `set_input_files()` 走 CDP `DOM.setFileInputFiles` 绕过保护 ✅
- [x] **post_xhs_browseruse.py v5**: 防覆写机制 (.bak 只读保护) + 智能成功检测
- [x] **xhs_keepalive.py**: Windows UTF-8 编码修复
- [x] **xhs_post_v6/v7**: Playwright 直连发帖脚本（坐标+键盘混合方案）
- [x] **xhs_post_v8/v9**: Tab 导航方案迭代（25次Tab→发布按钮，不稳定）
- [x] **WAF 发现**: 阿里云 `acw_tc` 封锁 30min，频繁浏览器启动触发限流
- [x] **🔑 xhs_post_v10**: Playwright codegen 录制级精准选择器 — 核心突破：发现 `xhs-publish-btn` Web Component
- [x] **Cron 集成 v10**: server.js 支持 `XHS_POST_ENGINE=playwright` / `browseruse` 双引擎切换
- [x] **发布管线 E2E 验证通过**: v10 首跑 1/1 成功 (31s)，xhs-publish-btn 精准命中 ✅

## v3.3 诗意文案 + v11 发帖引擎（2026-06-20）
- [x] **v11 Shadow DOM 发帖**: addInitScript 强制 open → shadowRoot btn.click() 穿透
- [x] **标题精简**: ≤17字（含emoji），XHS标题硬限制适配
- [x] **3大根因解决**: ① 文件选择器 openFilePicker 遮罩 ② Web Component 封闭 Shadow DOM ③ Vue fill() 长文本失效
- [x] **文案去模板化**: 4种诗意叙事结构轮换 + 温情小故事互动（融合 hetianyu 技能模式）
- [x] **日期上下文**: 夏至/端午/周末/暑假/年中 自动感知注入
- [x] **天气诗意叙事**: 温度/湿度/天气描述 → 诗意语言转换
- [x] **核心城市每日必发**: 杭州/广州/厦门/北京/上海 强制播报（无晚霞→预测帖）
- [x] **全国播报封面**: build_national_prompt() + D模板
- [x] **封面全覆盖**: 全部城市预生成 AI 封面（covers-only 模式）
- [x] **截图城市缩放**: zoomToCity(lat, lon, 12) + 瓦片加载验证
- [x] **封面稳健性**: 失败自动重试 + 批次失败汇总
- [x] **E2E 验证**: 7/7 全部发帖成功（广州/重庆/天津/厦门/杭州/北京/上海）

## v3.4 手动发帖 SOP（2026-06-29）
- [x] 素材包 → 小红书发布完整流程文档：`docs/manual-posting-sop.md`
- [x] 修正 SOP：服务必须启动、素材包不会自动生成
- [x] 精简 SOP：两步走，去掉冗余章节

## v3.5 CDP 反检测发帖引擎（2026-07-08）
- [x] **CDP 模式迁移**: `scripts/xhs_cdp_poster.py` 改用 `connect_over_cdp()` 连接真实 Chrome
- [x] **持久化 poster**: `scripts/xhs_persistent_poster.py` — 复用同一 Chrome 实例 + 用户态 profile
- [x] **登录态 auth 工具**: `scripts/xhs_auth_setup.py` — 扫码/登录态初始化
- [x] **绕过反检测**: 避免裸 `launch()` + 固定指纹，走真实浏览器 CDP 通道
- [x] **Bugfix**: `copyFile` 内容读取兜底（inline content 缺失时）

## v3.6 文案引擎 v3.1（2026-07-08）
- [x] 节气 + 节假日感知（夏至/端午/暑假/年中等）
- [x] 短文案 + 互动轮换，降低模板化痕迹
- [x] 12 城扩展（在原有核心城市基础上增加覆盖）
- [x] 天气 insight 奖励 + `quickLine` 多城摘要

## v3.7 数据健康监控看板 v1.0（2026-07-08）
- [x] 监控看板前端：`public/monitor.html` + `src/monitor-dashboard.js`
- [x] 管线健康监测 + API 调用追踪：`src/data-health.js`
- [x] `/api/monitor` 路由接入，暴露监控数据
- [x] `generateDashboard` 导出修复，供路由消费

## v3.8 邮件推送（未提交，2026-07-18）
- [x] 每日 posts 邮件推送脚本：`scripts/mail_push.py`（读 posts.json + 封面图附件）
- [x] Windows 本地 cron 脚本：`scripts/cron/wanxia-mail-push.sh`（12:20 运行，3 次重试）
- [ ] **待提交**: `mail_push.py` / `wanxia-mail-push.sh` / `logs/` 尚未进入 git

## 变更历史




| 时间 | 变更类型 | 描述 | Agent/人 |
|------|---------|------|----------|
| 2026-08-23 | 配置 | 配置（4 文件） — sunset/sunset/sunset/mail-push | Claude (auto) |
| 2026-08-03 | 配置 | 配置（3 文件） — sunset/sunset/mail-push | Claude (auto) |
| 2026-07-31 | 配置 | 配置（2 文件） — sunset/sunset | Claude (auto) |
| 2026-07-31 | 配置 | 配置（1 文件） — mail-push | Claude (auto) |
| 2026-07-30 | 配置 | 配置（3 文件） — sunset/sunset/mail-push | Claude (auto) |
| 2026-07-30 | 新增 | 新增（8 文件） — GATES/PROGRESS/sunset/sunset/sunset/+3 | Claude (auto) |
| 2026-07-08 | 功能 | 数据健康监控看板 v1.0 + `/api/monitor` 路由 (7e61345, 73bb827, 9209bf9) | Claude |
| 2026-07-08 | 功能 | 文案引擎 v3.1：节气/节假日/短文案/互动轮换/12城扩展 (d0a3a28, db169ad) | Claude |
| 2026-07-08 | 功能 | CDP 反检测发帖引擎：connect_over_cdp + 持久 poster + auth 设置 (c6a8792, fb4dc22) | Claude |
| 2026-06-29 | 文档 | 手动发帖 SOP 迭代：完整流程 → 修正 → 精简两步走 (9362863, 36cc82b, bab8649) | Claude |
| 2026-06-19 | 重构 | 路由重构 + grid/weather fetcher 优化 + recorded_publish 清理 (edc38a0) | Claude |
| 2026-06-19 | 重构 | v3.5 封面 prompt 统一为你调的风格 (c7ddc65) | Claude |
| 2026-06-19 | 文档 | 项目看板更新 — 微信推送闭环 + iLink 发现 (a3865e6) | Claude |
| 2026-06-17 | 文档 | 文档（1 文件） — PROGRESS | Claude (auto) |
| 2026-06-17 | 配置 | 配置（2 文件） — PROGRESS/screenshot-xhs | Claude (auto) |
| 2026-06-17 | 自动发帖 | Browser Use (Manus 底层引擎) 集成 — Python 脚本 + Cron 开关 + Cookie 导出工具 | Claude |
| 2026-06-16 | 文案优化 | 颜色叙事变体（每色3表达）+ 趋势感知（日环比）+ 模板轮换（3风格），基于L3社媒自动化研究 | Claude |
| 2026-06-16 | 管线收尾 | 22:30 cron 定时发布调度器、publish-xhs.js E2E 验证通过（80城→12帖）、代码提交 | Claude |
| 2026-06-16 | 架构升级 | XHS 采集从纯 HTTP → Playwright 无头浏览器，绕过 X-S 签名反爬；新增 closeBrowser() 生命周期管理 | Claude |
| 2026-06-16 | 配置+修复 | 添加 XIAOHONGSHU_COOKIE 到 .env，修复 cron 同时检查微博和小红书 cookie | Hermes |
| 2026-06-14 | 初始化 | 项目接入 x-tool 工作区，创建三件套 | Claude |

## 已完成
- [x] 晚霞预报核心系统
- [x] 数据采集和存储
- [x] 前端展示界面
- [x] 项目接入工作区
- [x] 小红书双源采集（Playwright 浏览器 + cookie 注入 + API 拦截）
- [x] CLI 脚本双源状态显示
- [x] 端到端验证通过（杭州 22条笔记，社交得分 100/100）
- [x] 定时发布管线（22:00 cron 采集 → 22:30 cron 自动生成素材包）
- [x] 文案引擎 copy-generator.js（全国播报 + 16城独立帖，风格B）
- [x] publish-xhs.js E2E 验证（80城 → 12帖素材包：截图 + 文案 + posts.json）

## 反检测研究结论（2026-06-20）

> 详见 `docs/anti-detection-research.md`

**v11 被检测分析（证据分级）**：
- 🔴 **确证**：v11 使用 `launch()` + `addInitScript`，被小红书检测并限制
- 🟡 **有案例支撑**：`navigator.webdriver` + 浏览器指纹异常是已知检测点（yousali.com 2026-02 案例）
- ⚪ **推测**：Shadow DOM 的 `addInitScript` 是主因——CDP 侧信道理论上可检测，但不确定小红书是否实际监控
- **诚实结论**：我们不知道具体哪个信号触发了检测，只能基于安全侧假设做防御

**推荐解决方案**：CDP 连接真实 Chrome（`connect_over_cdp`）+ Patchright + 行为拟态

---

## 待办
- [x] Browser Use 自动发帖 — 基于 Manus 底层引擎 (browser-use v0.13.1, 75k+ stars)
- [x] 每日自动发帖 — 22:30 cron 发帖已开启 (max 5 篇/天) + Cookie 4h 保活
- [x] 🔴 **自动发帖已禁用** — server.js cron 已关闭（2026-06-20）
- [x] 🔴 **反检测深度研究** — 小红书 5 层风控体系完整调研 → `docs/anti-detection-research.md`
- [x] 🔴 **短期**：手动发帖 SOP — `docs/manual-posting-sop.md`（素材包→用户手动上传，含完整步骤+异常处理+验证清单）
- [x] 🟡 **中期**：CDP 模式迁移 — `scripts/xhs_cdp_poster.py` + `scripts/xhs_persistent_poster.py` 已落地（2026-07-08）
- [ ] 🟡 **中期**：CDP 反检测 E2E 验证 — 小流量回测确认通过率与账号安全
- [ ] 🟡 **中期**：行为拟态 — 随机延迟、贝塞尔鼠标轨迹、发帖时间随机化
- [x] 🟢 每日邮件推送 — `scripts/mail_push.py` + `scripts/cron/wanxia-mail-push.sh` 已开发（未提交 git）
- [ ] 🟢 **长期**：移动端自动化 — Android 真机 + Appium（设备指纹完全真实）
- [ ] Weibo 桌面搜索 cookie 配置（提升微博数据质量）
- [ ] 微博/小红书权重比例校准
- [ ] 未提交改动归档：`data/sunset.db-shm` / `data/sunset.db-wal` 运行时 WAL 文件，无需提交

## 新建工具链

| 脚本 | 用途 |
|------|------|
| `scripts/screenshot-xhs.js` | 截图：全国概览 + TOP N 城市详情 |
| `scripts/publish-xhs.js` | 一键发帖素材包：截图 + 文案 + posts.json |
| `scripts/post_xhs_browseruse.py` | Browser Use AI Agent 自动发帖 |
| `scripts/export-xhs-cookie.js` | Playwright Cookie 导出（已登录 → storage_state） |
| `scripts/xhs_keepalive.py` | Cookie 保活心跳（每 4h 刷新 session） |
| `scripts/generate-cover-image.py` | 🆕 GPT-Image-2 AI 封面图生成器（1024×1536, 摄影级晚霞） |
| `scripts/xhs_cdp_poster.py` | CDP 模式发帖：connect_over_cdp 连接真实 Chrome |
| `scripts/xhs_persistent_poster.py` | 持久化 poster：复用 Chrome 实例 + profile |
| `scripts/xhs_auth_setup.py` | 小红书登录态/扫码初始化工具 |
| `scripts/mail_push.py` | 每日 posts 邮件推送（读 posts.json + AI 封面图附件） |
| `scripts/cron/wanxia-mail-push.sh` | Windows 本地 12:20 cron 邮件推送脚本（3 次重试） |
| `src/copy-generator.js` | 文案引擎：全国播报 + 一线城市独立帖（风格B） |
| `src/data-health.js` | 数据管线健康检查与 API 追踪 |
| `src/monitor-dashboard.js` | 监控看板数据生成与渲染 |

### 素材包输出 (`posts/`)
```
posts/
├── posts.json          — 索引（标题、截图路径、日期）
├── 01-national.png     — 全国等高线概览
├── 01-national.txt     — 全国播报文案
├── 02-上海.png          — 上海 77分 极佳
├── 02-上海.txt
├── 03-杭州.png          — 杭州 71分 好
...
└── 10-大连.png          — 大连 87分 极佳
```

## 阻塞项

| 阻塞 | 影响范围 | 状态 |
|------|---------|------|
| 🔴 **小红书反检测效果待验证** | 自动发帖仍停用；CDP + 持久 poster 已落地，需小流量 E2E 验证通过率与账号安全 | 待验证（2026-07-18） |
