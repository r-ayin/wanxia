#!/usr/bin/env python3
"""
晚霞预报 → QQ 机器人推送

读取 posts/ 下的当日素材包，逐条通过 QQ Bot API 发送到指定群/好友。

用法：
  python scripts/push-to-qq.py                              # 推最新
  python scripts/push-to-qq.py --dir posts/2026-06-30       # 指定日期
  python scripts/push-to-qq.py --limit 3                    # 最多 N 条
  python scripts/push-to-qq.py --dry-run                    # 仅列出不发送

环境变量 (.env):
  QQ_APP_ID          — QQ Bot App ID
  QQ_CLIENT_SECRET   — QQ Bot Client Secret
  QQ_TARGET_TYPE     — "group" 或 "user"（默认 group）
  QQ_TARGET_ID       — 群 openid 或用户 openid
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

# ── 路径 ─────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "posts"
ENV_FILE = ROOT / ".env"

# ── QQ Bot API 端点 ──────────────────────────────────────────────────────
TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken"
SEND_MSG_URL = "https://api.sgroup.qq.com/v2/{target_type}s/{target_id}/messages"
SEND_FILE_URL = "https://api.sgroup.qq.com/v2/{target_type}s/{target_id}/files"
SEND_IMG_URL = "https://api.sgroup.qq.com/v2/{target_type}s/{target_id}/messages"

TOKEN_CACHE = {"token": None, "expires_at": 0}
SEND_INTERVAL = 3   # 秒，避免触发频率限制
MAX_TEXT_LEN = 1800  # QQ 消息文本上限


# ═════════════════════════════════════════════════════════════════════════
# §1 环境加载
# ═════════════════════════════════════════════════════════════════════════

def load_env() -> dict:
    env = {}
    if ENV_FILE.exists():
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, _, v = line.partition("=")
                    env[k.strip()] = v.strip()
    for k, v in os.environ.items():
        env.setdefault(k, v)
    return env


# ═════════════════════════════════════════════════════════════════════════
# §2 QQ Bot API
# ═════════════════════════════════════════════════════════════════════════

def get_access_token(app_id: str, client_secret: str) -> str:
    """获取 QQ Bot access_token（带缓存，过期自动刷新）"""
    now = time.time()
    if TOKEN_CACHE["token"] and now < TOKEN_CACHE["expires_at"] - 300:
        return TOKEN_CACHE["token"]

    data = json.dumps({
        "appId": app_id,
        "clientSecret": client_secret,
    }).encode("utf-8")

    req = urllib.request.Request(
        TOKEN_URL,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"获取 token 失败 HTTP {e.code}: {body}")

    token = result.get("access_token")
    if not token:
        raise RuntimeError(f"Token 缺失: {result}")

    expires = result.get("expires_in", 7200)  # 默认 2 小时
    TOKEN_CACHE["token"] = token
    TOKEN_CACHE["expires_at"] = now + expires
    return token


def api_request(url: str, data: dict, token: str, method: str = "POST") -> dict:
    """通用 QQ API 请求，带重试"""
    body = json.dumps(data).encode("utf-8")
    headers = {
        "Authorization": f"QQBot {token}",
        "Content-Type": "application/json",
    }

    for attempt in range(3):
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            if e.code == 429 and attempt < 2:
                wait = 5 * (attempt + 1)
                print(f"   ⚠️  限流，{wait}s 后重试...", end=" ", flush=True)
                time.sleep(wait)
                continue
            raise RuntimeError(f"API HTTP {e.code}: {err_body}")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
                continue
            raise RuntimeError(f"API 连接失败: {e}")
    raise RuntimeError("重试耗尽")


# ═════════════════════════════════════════════════════════════════════════
# §3 消息构建
# ═════════════════════════════════════════════════════════════════════════

def build_text_message(post: dict, target_type: str, target_id: str) -> dict:
    """构建 QQ 文本消息体"""
    title = post.get("title", "")
    body = post.get("body", "")
    hashtags = post.get("hashtags", "")

    # 截断过长正文
    text = f"{title}\n\n{body}"
    if hashtags:
        text += f"\n\n{hashtags}"
    if len(text) > MAX_TEXT_LEN:
        text = text[:MAX_TEXT_LEN - 3] + "..."

    return {
        "msg_type": 0,
        "content": text,
        "msg_id": str(int(time.time() * 1000)),
    }


def build_image_message(image_url: str, target_type: str, target_id: str) -> dict:
    """构建 QQ 图文消息（Markdown 格式嵌入图片）"""
    # QQ Bot API 支持 markdown 消息类型
    return {
        "msg_type": 2,  # markdown
        "markdown": {
            "content": f"![晚霞封面]({image_url})",
        },
        "msg_id": str(int(time.time() * 1000)),
    }


def upload_file(file_path: Path, target_type: str, target_id: str, token: str) -> str | None:
    """上传文件到 QQ，返回 file_id 用于发送（暂用图片链接替代）"""
    # QQ Bot 文件上传需要 multipart/form-data
    # 简化方案：先发文本，图片用 markdown URL（需要公网可访问）
    return None


# ═════════════════════════════════════════════════════════════════════════
# §4 批量推送
# ═════════════════════════════════════════════════════════════════════════

def push_posts(posts_json: Path, env: dict, limit: int = 0, dry_run: bool = False):
    """读取 posts.json，逐条推送到 QQ"""
    if not posts_json.exists():
        print(f"❌ posts.json 不存在: {posts_json}")
        sys.exit(1)

    with open(posts_json, "r", encoding="utf-8") as f:
        package = json.load(f)

    posts = package.get("posts", [])
    if not posts:
        print("⚠️  无帖子")
        return

    # 配置
    app_id = env.get("QQ_APP_ID", "")
    client_secret = env.get("QQ_CLIENT_SECRET", "")
    target_type = env.get("QQ_TARGET_TYPE", "group")
    target_id = env.get("QQ_TARGET_ID", "")

    if not app_id or not client_secret:
        print("❌ 未配置 QQ_APP_ID 或 QQ_CLIENT_SECRET")
        print("   请在 .env 中添加这两个变量")
        sys.exit(1)
    if not target_id:
        print("❌ 未配置 QQ_TARGET_ID")
        print("   请在 .env 中设置 QQ_TARGET_ID（群 openid 或用户 openid）")
        sys.exit(1)

    if dry_run:
        print(f"🔍 [DRY RUN] 将发送到: {target_type}/{target_id}")
        for i, p in enumerate(posts):
            if limit and i >= limit:
                break
            print(f"   {i+1}. {p.get('title', '?')[:50]}")
        print(f"   共 {min(len(posts), limit) if limit else len(posts)} 条")
        return

    print(f"🔑 获取 access token...")
    try:
        token = get_access_token(app_id, client_secret)
        print(f"   ✅ Token 就绪")
    except RuntimeError as e:
        print(f"   ❌ {e}")
        sys.exit(1)

    url = SEND_MSG_URL.format(target_type=target_type, target_id=target_id)
    sent = 0
    failed = 0

    for i, post in enumerate(posts):
        if limit and i >= limit:
            break

        title = post.get("title", "?")[:40]
        print(f"\n📤 [{i+1}/{min(len(posts), limit) if limit else len(posts)}] {title}")

        try:
            # 发送文本消息
            msg = build_text_message(post, target_type, target_id)
            result = api_request(url, msg, token)
            sent += 1
            print(f"   ✅ 已发送 (msg_id={result.get('id', '?')})")
        except RuntimeError as e:
            failed += 1
            print(f"   ❌ {e}")

        # 频率控制
        if i < len(posts) - 1:
            time.sleep(SEND_INTERVAL)

    print(f"\n{'═' * 40}")
    print(f"✅ {sent} 成功, ❌ {failed} 失败")


# ═════════════════════════════════════════════════════════════════════════
# §5 CLI
# ═════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="晚霞预报 → QQ 机器人推送")
    parser.add_argument("--dir", type=str, default="", help="posts 子目录（默认最新）")
    parser.add_argument("--limit", type=int, default=0, help="最多推送 N 条")
    parser.add_argument("--dry-run", action="store_true", help="仅列出，不发送")
    args = parser.parse_args()

    env = load_env()

    if args.dir:
        pj = Path(args.dir) / "posts.json"
    else:
        # 找最新日期目录
        dirs = sorted(
            [d for d in POSTS_DIR.iterdir() if d.is_dir() and (d / "posts.json").exists()],
            key=lambda d: d.name,
            reverse=True,
        )
        if not dirs:
            print("❌ 无可用素材包，请先运行 generate-content.js")
            sys.exit(1)
        pj = dirs[0] / "posts.json"

    print(f"📦 素材包: {pj}")
    push_posts(pj, env, limit=args.limit, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
