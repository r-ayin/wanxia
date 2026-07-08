"""晚霞预报内容 → 微信推送（替代自动发帖）

读取 publish-xhs.js 生成的 posts.json，逐条推送到微信。

用法：
  python scripts/push-to-wechat.py                     # 推送最新 posts.json
  python scripts/push-to-wechat.py --dir posts/2026-06-20  # 指定目录
  python scripts/push-to-wechat.py --dry-run            # 仅列出，不推送
  python scripts/push-to-wechat.py --limit 3            # 最多推送N条

前置条件：
  - Hermes CLI 已安装 (`/root/.local/bin/hermes`)
  - WSL Ubuntu 可用 (Windows 上自动桥接)
  - `HERMES_ILINK_TOKEN` 已设置
  - 微信 Bot 已扫码登录
"""

import json, os, sys, subprocess, tempfile, time, argparse, io
from pathlib import Path
from datetime import datetime

# Windows GBK 编码兼容
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# ── 配置 ──
HERMES_PATH = "/root/.local/bin/hermes"
WSL_DISTRO = "Ubuntu"
MAX_RETRIES = 3
RETRY_BASE_DELAY = 5
RATE_LIMIT_DELAY = 3  # 条间间隔（微信限流：~20条/分钟）


def _is_windows() -> bool:
    return sys.platform == "win32" or os.name == "nt"


def _win_to_wsl(path: str) -> str:
    """Windows 绝对路径 → WSL /mnt/ 路径"""
    abs_path = os.path.abspath(path).replace("\\", "/")
    if abs_path[1:2] == ":":
        return f"/mnt/{abs_path[0].lower()}{abs_path[2:]}"
    return abs_path


def _run_hermes(text: str = None, file_path: str = None, filename: str = None) -> bool:
    """通过 WSL Hermes CLI 发送微信消息（文本 / 文件）。

    在 Windows 上通过 wsl bash 桥接；WSL 内直接调用 hermes。
    """
    if _is_windows():
        # Windows → 写临时 shell 脚本 → wsl bash 执行
        sh_parts = ["#!/bin/bash"]
        if file_path:
            wsl_file = _win_to_wsl(file_path)
            label = filename or os.path.basename(file_path)
            sh_parts.append(
                f"{HERMES_PATH} send --to weixin --file '{wsl_file}' --title '{label}'"
            )
        elif text:
            # 长文本先写文件再用 MEDIA 发（避免 shell 转义问题）
            txt_file = os.path.join(tempfile.gettempdir(), "wanxia_wechat.txt")
            with open(txt_file, "w", encoding="utf-8") as f:
                f.write(text)
            wsl_txt = _win_to_wsl(txt_file)
            sh_parts.append(
                f"{HERMES_PATH} send --to weixin --file '{wsl_txt}' --title '晚霞预报'"
            )
        sh_path = os.path.join(tempfile.gettempdir(), "wanxia_push.sh")
        with open(sh_path, "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(sh_parts) + "\n")
        wsl_sh = _win_to_wsl(sh_path)
        result = subprocess.run(
            ["wsl", "-d", WSL_DISTRO, "bash", wsl_sh],
            capture_output=True, text=True, timeout=120,
        )
    else:
        # 已在 WSL 内
        if file_path:
            label = filename or os.path.basename(file_path)
            cmd = [HERMES_PATH, "send", "--to", "weixin", "--file", file_path, "--title", label]
        elif text:
            cmd = [HERMES_PATH, "send", "--to", "weixin", "--message", text]
        else:
            return False
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

    if result.returncode != 0:
        print(f"  [WARN] Hermes 返回非零: {result.stderr.strip()[:200]}")
    return result.returncode == 0


def push_posts(posts_dir: str, dry_run: bool = False, limit: int = 0) -> dict:
    """读取 posts.json，逐条推送到微信。"""
    json_path = os.path.join(posts_dir, "posts.json")
    if not os.path.exists(json_path):
        print(f"[FAIL] posts.json 不存在: {json_path}")
        return {"ok": False, "error": "posts.json not found"}

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    posts = data.get("posts", [])
    if not posts:
        print("[WARN] 没有帖子可推送")
        return {"ok": True, "pushed": 0, "total": 0}

    if limit > 0:
        posts = posts[:limit]

    print(f"[WeChat] 准备推送 {len(posts)} 条到微信...")
    if dry_run:
        print("  [DRY RUN] 不实际发送\n")
    print(f"  日期: {data.get('date', '?')}")
    print(f"  摘要: {data.get('summary', {}).get('recommendation', '')}\n")

    pushed, failed = 0, 0
    for i, post in enumerate(posts):
        title = post.get("title", f"晚霞预报 {i+1}")
        copy_file = post.get("copyFile", "")
        cover_file = post.get("cover", "") or post.get("file", "")
        screenshot_file = post.get("file", "")

        print(f"[{i+1}/{len(posts)}] {title}")

        if dry_run:
            print(f"  [COPY] 文案: {copy_file}")
            print(f"  [IMG] 封面: {cover_file}")
            print(f"  [SHOT] 截图: {screenshot_file}")
            pushed += 1
            continue

        # Step 1: 发送封面图（或截图）+ 标题
        image_to_send = None
        for candidate in [cover_file, screenshot_file]:
            candidate_path = os.path.join(posts_dir, candidate) if candidate else ""
            if candidate_path and os.path.exists(candidate_path) and os.path.getsize(candidate_path) > 100:
                image_to_send = candidate_path
                break

        if image_to_send:
            ok = False
            for attempt in range(MAX_RETRIES):
                ok = _run_hermes(file_path=image_to_send, filename=title)
                if ok:
                    break
                delay = RETRY_BASE_DELAY * (2 ** attempt)
                print(f"    重试 {attempt+2}/{MAX_RETRIES} ({delay}s)...")
                time.sleep(delay)
            if not ok:
                print(f"  [FAIL] 图片发送失败")
                failed += 1
                continue
            time.sleep(0.5)

        # Step 2: 发送文案
        copy_path = os.path.join(posts_dir, copy_file) if copy_file else ""
        copy_text = ""
        if copy_path and os.path.exists(copy_path):
            with open(copy_path, "r", encoding="utf-8") as f:
                copy_text = f.read().strip()

        if copy_text:
            # 文案首行作为独立消息（微信阅读体验）
            lines = copy_text.split("\n")
            msg = f"{title}\n\n" + "\n".join(lines[:20])  # 前20行，避免过长
            if len(lines) > 20:
                msg += f"\n\n（完整文案见 {copy_file}）"

            for attempt in range(MAX_RETRIES):
                ok = _run_hermes(text=msg)
                if ok:
                    break
                delay = RETRY_BASE_DELAY * (2 ** attempt)
                time.sleep(delay)

        pushed += 1
        print(f"  [OK] 已推送")

        # 条间限流
        if i < len(posts) - 1:
            time.sleep(RATE_LIMIT_DELAY)

    return {"ok": True, "pushed": pushed, "failed": failed, "total": len(posts),
            "dry_run": dry_run}


def find_latest_posts() -> str:
    """找到最新的 posts 目录（优先日期子目录，其次根目录）。"""
    base = Path(__file__).parent.parent / "posts"
    if not base.exists():
        return str(base)

    # 按日期命名的子目录（格式：YYYY-MM-DD）
    date_dirs = sorted(
        [d for d in base.iterdir()
         if d.is_dir() and len(d.name) == 10 and d.name[4] == '-' and (d / "posts.json").exists()],
        reverse=True
    )
    if date_dirs:
        return str(date_dirs[0])

    # 回退到 posts/ 根目录
    if (base / "posts.json").exists():
        return str(base)

    return str(base)


def main():
    parser = argparse.ArgumentParser(description="晚霞内容 → 微信推送")
    parser.add_argument("--dir", help="posts 目录路径")
    parser.add_argument("--dry-run", action="store_true", help="仅列出不推送")
    parser.add_argument("--limit", type=int, default=0, help="最多推送N条")
    args = parser.parse_args()

    posts_dir = args.dir or find_latest_posts()
    print(f"[DIR] 读取: {posts_dir}")

    result = push_posts(posts_dir, dry_run=args.dry_run, limit=args.limit)

    if result["ok"]:
        action = "将推送" if args.dry_run else "已推送"
        print(f"\n[OK] {action} {result['pushed']}/{result['total']} 条"
              + (f"（{result['failed']} 失败）" if result.get("failed") else ""))
    else:
        print(f"\n[FAIL] {result['error']}")
        sys.exit(1)


if __name__ == "__main__":
    main()
