# wanxia — 进度追踪

> 最后更新：2026-06-16T17:45:00Z

## 状态
<!-- STATUS: active -->

## 当前任务
<!-- TASK: Playwright 无头浏览器接入小红书采集 -->
<!-- TASK_STATUS: done -->

## 变更历史
| 时间 | 变更类型 | 描述 | Agent/人 |
|------|---------|------|----------|
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

## 待办
- [ ] 小红书定时发布（22:00采集→22:30截图+文案→发布）
- [ ] Weibo 桌面搜索 cookie 配置（提升微博数据质量）
- [ ] 微博/小红书权重比例校准

## 新建工具链

| 脚本 | 用途 |
|------|------|
| `scripts/screenshot-xhs.js` | 截图：全国概览 + TOP N 城市详情 |
| `scripts/publish-xhs.js` | 一键发帖素材包：截图 + 文案 + posts.json |
| `src/copy-generator.js` | 文案引擎：全国播报 + 一线城市独立帖（风格B） |

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
无
