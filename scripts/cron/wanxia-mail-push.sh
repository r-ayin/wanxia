#!/usr/bin/env bash
# wanxia-mail-push.sh — 每日 12:20 推送晚霞预报 posts 到邮箱（Windows 本地版）
#
# 在 server.js 的 node-cron '0 12 * * *' 生成 posts 包之后跑（最迟 12:10 结束），
# 12:20 推送留 10 分钟缓冲，确保封面图已落盘。
# SMTP 凭证: ~/.wechat-env（C:\Users\admin\.wechat-env，从 ECS 迁来）
# 失败不阻断（|| true），日志落 logs/mail-push.log。
#
# Windows 任务计划：
#   20 12 * * * → Wanxia-Mail-Push（Git Bash 调本脚本）

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || { echo "❌ 无法 cd 到 $ROOT"; exit 1; }

mkdir -p logs

# 加载 SMTP 凭证（本地 home 目录，非仓库内，避免误提交）
if [ -f "${WECHAT_ENV:-$HOME/.wechat-env}" ]; then
  # shellcheck disable=SC1090
  set +u; . "${WECHAT_ENV:-$HOME/.wechat-env}"; set -u
else
  echo "⚠️ ~/.wechat-env 不存在，无 SMTP 凭证，跳过" >&2
  exit 1
fi

# 无今日 posts 则脚本自动回退到最新日期；发送失败重试 3 次（SMTP 偶发抖动）
ok=0
for attempt in 1 2 3; do
  if python scripts/mail_push.py >> logs/mail-push.log 2>&1; then ok=1; break; fi
  echo "  ⏳ SMTP 尝试 $attempt 失败，$((attempt*30))s 后重试..." >> logs/mail-push.log
  [ $attempt -lt 3 ] && sleep $((attempt*30))
done
if [ $ok -eq 1 ]; then
  echo "  ✅ $(date -Iseconds) wanxia 邮件已发到 $MAIL_TO" >> logs/mail-push.log
else
  echo "  ⚠️ $(date -Iseconds) wanxia 邮件推送失败（3 次重试后仍失败，见上行）" >> logs/mail-push.log
fi

exit 0
