"""发送 douyin HTML 到微信——使用 hermes send + MEDIA: 语法"""
import sys, os, subprocess, tempfile, time, glob

OUT_DIR = "E:/x-tool/douyin/godtier-deep-research/output"

def _win_to_wsl(path):
    abs_path = os.path.abspath(path).replace("\\", "/")
    if abs_path[1:2] == ":":
        return "/mnt/" + abs_path[0].lower() + abs_path[2:]
    return abs_path

def _run_wsl_cmd(cmd):
    """在 WSL 中执行命令"""
    sh_path = os.path.join(tempfile.gettempdir(), "douyin_push.sh")
    with open(sh_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("#!/bin/bash\n{}\n".format(cmd))
    result = subprocess.run(
        ["wsl", "-d", "Ubuntu", "bash", _win_to_wsl(sh_path)],
        capture_output=True, text=True, timeout=120,
    )
    return result

def send_html(file_path, label, caption=""):
    """发送 HTML 文件到微信"""
    wsl_path = _win_to_wsl(file_path)
    HERMES = "/root/.local/bin/hermes"

    # hermes send 格式: hermes send --to weixin 'caption\n\nMEDIA:/path/to/file'
    msg = "{}  \n\nMEDIA:{}".format(caption, wsl_path) if caption else "MEDIA:{}".format(wsl_path)

    for attempt in range(3):
        cmd = "{} send --to weixin '{}'".format(HERMES, msg.replace("'", "'\\''"))
        result = _run_wsl_cmd(cmd)
        if result.returncode == 0:
            return True
        stderr = result.stderr.strip()
        if stderr:
            print("  [WARN] {}".format(stderr[:300]))
        if "ret=-2" in stderr or "rate limit" in stderr.lower():
            delay = 10 * (attempt + 1)
            print("  Rate limited, wait {}s...".format(delay))
            time.sleep(delay)
            continue
        if attempt < 2:
            delay = 5 * (2 ** attempt)
            print("  Retry {}/3 in {}s...".format(attempt + 2, delay))
            time.sleep(delay)
    return False

# Find HTML files
files = [f for f in glob.glob(OUT_DIR + "/EvoMap_*2026-06-21*.html") if os.path.getsize(f) > 100]
files.sort()

# Also find the script cards
cards = glob.glob(OUT_DIR + "/EvoMap_v2_*.html")
files.extend(cards)

print("Files:")
for f in files:
    print("  {} ({} KB)".format(os.path.basename(f), os.path.getsize(f)//1024))

for path in files:
    name = os.path.basename(path).replace(".html", "")
    # Truncate label for hermes
    label = name[:30]
    caption = "[douyin] EvoMap v2"
    print("\nSending: {}...".format(label))
    ok = send_html(path, label, caption)
    print("  [{}]".format("OK" if ok else "FAIL"))
    time.sleep(3)  # rate limit between files

print("\nDONE")
