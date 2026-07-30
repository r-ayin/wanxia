#!/usr/bin/env python3
"""mail_push.py — 晚霞预报每日 posts 邮件推送

读 posts/<YYYY-MM-DD>/posts.json + 01-national.txt，拼摘要正文 + 挂 AI 封面图（covers/*.png）附件，
SMTP 发到 MAIL_TO（逗号分隔多收件人，smtplib.send_message 自动解析 To 头）。

环境变量（cron 里 source /opt/wechat/.wechat-env 复用 wechat 的 QQ 邮箱凭证）：
  SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_TO / MAIL_FROM

CLI:
  python scripts/mail_push.py                 # 推送今日（无则取最新日期）
  python scripts/mail_push.py --date 2026-07-02
  python scripts/mail_push.py --dry-run       # 仅打印不发送

退出码：0 成功；1 未配置/无数据；2 发送失败。
"""
from __future__ import annotations

import argparse
import json
import os
import smtplib
import ssl
import sys
import time
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "posts"


def find_latest_date() -> str | None:
    if not POSTS_DIR.is_dir():
        return None
    dates = sorted(
        (d.name for d in POSTS_DIR.iterdir()
         if d.is_dir() and d.name[:4].isdigit()),
        reverse=True,
    )
    return dates[0] if dates else None


def _sunset_hhmm(s: str) -> str:
    return s[11:16] if len(s) >= 16 else ""


def build_body(date_str: str, posts_json: dict, national_txt: str) -> str:
    # 正文只放 national 文案本体（诗意开头 + 5 区全列 + 统计 + 互动）。
    # 删掉冗余的汇总头（🌅晚霞预报/全国均分/🏆最佳——主题里已有日期和最佳）、
    # 「── 全国晚霞地图文案 ──」分隔、以及 national 的标题行「🔥 今日晚霞地图」——
    # 让 DeepSeek 的诗意开头直接打头。
    lines: list[str] = []
    if national_txt:
        body_lines = national_txt.split("\n")
        # 跳过首行标题（🔥 今日晚霞地图 · date）
        if body_lines and "今日晚霞地图" in body_lines[0]:
            body_lines = body_lines[1:]
        # 去掉标题后紧跟的空行，让诗意开头打头
        while body_lines and not body_lines[0].strip():
            body_lines = body_lines[1:]
        lines.extend(body_lines)
    lines.append("")
    lines.append(f"(生成于 {posts_json.get('generatedAt', '?')})")
    return "\n".join(lines)


def run(args) -> int:
    host = os.environ.get("SMTP_HOST", "")
    raw_port = os.environ.get("SMTP_PORT", "465")
    try:
        port = int(raw_port)
    except ValueError:
        print(
            f"⚠️ SMTP_PORT={raw_port!r} 非整数，无法解析端口，跳过邮件推送",
            file=sys.stderr,
        )
        return 1
    if not (1 <= port <= 65535):
        print(f"⚠️ SMTP_PORT={port} 越界（需 1-65535），跳过邮件推送", file=sys.stderr)
        return 1
    user = os.environ.get("SMTP_USER", "")
    pwd = os.environ.get("SMTP_PASS", "")
    to = os.environ.get("MAIL_TO", "")
    sender = os.environ.get("MAIL_FROM", user)

    if not (host and user and pwd and to):
        print("⚠️ SMTP_HOST/USER/PASS/MAIL_TO 未配置，跳过邮件推送", file=sys.stderr)
        return 1

    date_str = args.date or find_latest_date()
    if not date_str:
        print("⚠️ 找不到 posts 目录", file=sys.stderr)
        return 1
    posts_path = POSTS_DIR / date_str / "posts.json"
    if not posts_path.exists():
        print(f"⚠️ {posts_path} 不存在", file=sys.stderr)
        return 1

    posts_json = json.loads(posts_path.read_text(encoding="utf-8"))
    nat_path = POSTS_DIR / date_str / "01-national.txt"
    national_txt = nat_path.read_text(encoding="utf-8") if nat_path.exists() else ""

    body = build_body(date_str, posts_json, national_txt)
    best = posts_json.get("summary", {}).get("bestCity", {})
    subject = f"晚霞预报 {date_str}"
    if best:
        subject += f" · 最佳{best.get('name', '')}{best.get('score', '')}分"
    # 可选主题标注（如 MAIL_TAG=校准版 → 主题末尾加 ·校准版）
    tag = os.environ.get("MAIL_TAG", "").strip()
    if tag:
        subject += f" · {tag}"

    if args.dry_run:
        print(f"[dry-run] To={to}\nSubject={subject}\n\n{body}")
        return 0

    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    if national_txt:
        msg.add_attachment(
            national_txt.encode("utf-8"),
            maintype="text", subtype="plain",
            filename=f"sunset-map-{date_str}.txt",
        )

    # 挂 AI 生成的封面图（GPT-Image-2，covers/*.png）— 先转 JPG 再挂：
    # PNG 2.3MB/张(18MB/8张) 易超 SMTP timeout；JPG q85 ≈300KB/张(2.4MB)，base64 后 ~3MB
    cover_dir = POSTS_DIR / date_str / "covers"
    cover_files = sorted(cover_dir.glob("*.png")) if cover_dir.is_dir() else []
    try:
        from PIL import Image
        from io import BytesIO
    except ImportError:
        Image = None
    for cf in cover_files:
        if Image:
            im = Image.open(cf).convert("RGB")
            buf = BytesIO()
            im.save(buf, "JPEG", quality=85, optimize=True)
            payload = buf.getvalue()
            msg.add_attachment(
                payload,
                maintype="image", subtype="jpeg",
                filename=cf.stem + ".jpg",
            )
        else:
            msg.add_attachment(
                cf.read_bytes(),
                maintype="image", subtype="png",
                filename=cf.name,
            )
    if cover_files:
        tag = " (已转JPG)" if Image else " (PIL缺失,原PNG)"
        print(f"  [mail] 附带 {len(cover_files)} 张封面图{tag}", file=sys.stderr)
    else:
        print(f"  [mail] ⚠️ 无封面图（covers/ 不存在或为空）", file=sys.stderr)

    try:
        print(f"  [mail] 连接 {host}:{port}...", file=sys.stderr)
        if port == 465:
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=ctx, timeout=300) as s:
                s.login(user, pwd)
                s.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=300) as s:
                s.starttls(context=ssl.create_default_context())
                s.login(user, pwd)
                s.send_message(msg)
        print(f"✅ 晚霞预报已发: {to}")
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"❌ 邮件发送失败: {type(e).__name__}: {e}", file=sys.stderr)
        return 2


def main() -> int:
    p = argparse.ArgumentParser(description="晚霞预报每日 posts 邮件推送")
    p.add_argument("--date", help="YYYY-MM-DD，默认取最新日期")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
