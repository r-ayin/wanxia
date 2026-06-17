#!/usr/bin/env python3
"""Wanxia server health check — works from Linux-native copy."""
import subprocess, sys, os, json, shutil

PORT = 8080
SRC_DIR = "/mnt/e/x-tool/wanxia"
WORK_DIR = "/tmp/wanxia"
LOG = "/tmp/wanxia-server.log"

def check():
    r = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                        f"http://localhost:{PORT}/api/health", "--connect-timeout", "5", "--max-time", "10"],
                       capture_output=True, text=True, timeout=15)
    return r.stdout.strip() == "200"

def ensure_deployed():
    """Ensure a Linux-native copy exists with proper native modules."""
    if not os.path.isdir(WORK_DIR):
        print(json.dumps({"info": "deploying to /tmp/wanxia", "port": PORT}))
        shutil.copytree(SRC_DIR, WORK_DIR, symlinks=True, ignore_dangling_symlinks=True)
        r = subprocess.run(["npm", "install"], cwd=WORK_DIR, capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            print(json.dumps({"status": "failed", "error": f"npm install failed: {r.stderr.strip()}"}))
            return False
        # Rebuild native addons — critical when copied from Windows filesystem
        r = subprocess.run(["npm", "rebuild"], cwd=WORK_DIR, capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            print(json.dumps({"status": "failed", "error": f"npm rebuild failed: {r.stderr.strip()}"}))
            return False
    return True

def restart():
    # Kill old process on port
    subprocess.run(["fuser", "-k", f"{PORT}/tcp"], capture_output=True, timeout=5)
    subprocess.run(["sleep", "1"], capture_output=True, timeout=5)
    # Ensure deployment
    if not ensure_deployed():
        return False
    # Start new
    with open(LOG, "w") as f:
        subprocess.Popen(["node", "server.js"], cwd=WORK_DIR, stdout=f, stderr=subprocess.STDOUT,
                         close_fds=True)
    import time
    time.sleep(2)
    return check()

if __name__ == "__main__":
    if check():
        print(json.dumps({"status": "ok", "port": PORT}))
    else:
        print(json.dumps({"status": "dead", "port": PORT}))
        if restart():
            print(json.dumps({"status": "restarted", "port": PORT}))
        else:
            # Read log for error details
            error_detail = ""
            try:
                with open(LOG) as f:
                    error_detail = f.read()[-500:]
            except: pass
            print(json.dumps({"status": "failed", "port": PORT, "error": error_detail}))
            sys.exit(1)
