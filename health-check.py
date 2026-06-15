#!/usr/bin/env python3
"""Wanxia server health check — restart if dead, report if can't fix."""
import subprocess, sys, os, json

PORT = 8080
WORK_DIR = "/mnt/e/x-tool/wanxia"

def check():
    r = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                        f"http://localhost:{PORT}/api/health", "--connect-timeout", "5", "--max-time", "10"],
                       capture_output=True, text=True, timeout=15)
    return r.stdout.strip() == "200"

def restart():
    # Kill old process on port
    subprocess.run(["fuser", "-k", f"{PORT}/tcp"], capture_output=True, timeout=5)
    # Start new
    log = "/tmp/wanxia-server.log"
    with open(log, "w") as f:
        subprocess.Popen(["node", "server.js"], cwd=WORK_DIR, stdout=f, stderr=subprocess.STDOUT,
                         close_fds=True)
    return check()

if __name__ == "__main__":
    if check():
        print(json.dumps({"status": "ok", "port": PORT}))
    else:
        print(json.dumps({"status": "dead", "port": PORT}))
        if restart():
            print(json.dumps({"status": "restarted", "port": PORT}))
        else:
            print(json.dumps({"status": "failed", "port": PORT}))
            sys.exit(1)
