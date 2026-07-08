"""
open-meteo 应用层转发 — VPS 拉数据，本机读结果
不需要 CONNECT 隧道，纯 HTTP GET/POST 即可

VPS 上运行：
    python3 meteo-relay.py

本机使用：
    把 wanxia 中 api.open-meteo.com 替换为 http://100.122.6.38:8080
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import ssl

PORT = 8080
UPSTREAM = "https://api.open-meteo.com"
AQ_UPSTREAM = "https://air-quality-api.open-meteo.com"

HOST_MAP = {
    "api.open-meteo.com": UPSTREAM,
    "air-quality-api.open-meteo.com": AQ_UPSTREAM,
}


class Relay(BaseHTTPRequestHandler):
    def do_GET(self):
        self._forward("GET")

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else None
        self._forward("POST", body)

    def _forward(self, method, body=None):
        host = self.headers.get("Host", "api.open-meteo.com")
        upstream = HOST_MAP.get(host, f"https://{host}")
        url = upstream + self.path

        try:
            ctx = ssl.create_default_context()
            req = urllib.request.Request(url, data=body, method=method)
            # 只传递必要的头
            for k, v in self.headers.items():
                if k.lower() not in ("host", "proxy-connection", "connection"):
                    req.add_header(k, v)

            resp = urllib.request.urlopen(req, timeout=30, context=ctx)

            self.send_response(resp.status)
            for k, v in resp.headers.items():
                if k.lower() not in ("transfer-encoding", "connection"):
                    self.send_header(k, v)
            self.end_headers()
            self.wfile.write(resp.read())

            print(f"[relay] {method} {host}{self.path} -> {resp.status}")
        except Exception as e:
            print(f"[relay] ERROR: {e}")
            self.send_response(502)
            self.end_headers()
            self.wfile.write(f"Relay error: {e}".encode())

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), Relay)
    print(f"[relay] open-meteo 转发服务已启动: http://0.0.0.0:{PORT}")
    server.serve_forever()
