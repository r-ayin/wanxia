"""
轻量 HTTP/HTTPS 转发代理 — 跑在 Tailscale VPS 上
支持 CONNECT 隧道（HTTPS 必须）

VPS 上运行：
    python ts-proxy.py

本机测试：
    curl -x http://VPS_IP:8808 https://api.open-meteo.com/v1/forecast?...
"""

import socket
import select
import threading
import sys

PORT = 8808
BUFSIZE = 65536


def handle_client(client_sock):
    """解析请求，HTTP 直连或 CONNECT 隧道转发"""
    try:
        data = client_sock.recv(BUFSIZE)
        if not data:
            client_sock.close()
            return

        request = data.decode("utf-8", errors="replace")
        first_line = request.split("\r\n")[0]
        parts = first_line.split(" ")

        if len(parts) < 3:
            client_sock.close()
            return

        method, target, _ = parts

        if method == "CONNECT":
            # HTTPS 隧道：连接目标，然后双向转发
            host, port_str = target.split(":")
            port = int(port_str)

            target_sock = socket.create_connection((host, port), timeout=15)
            client_sock.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            print(f"[proxy] CONNECT {host}:{port} -> established", flush=True)

            # 双向转发
            relay(client_sock, target_sock)

        else:
            # HTTP 请求：解析 Host，建立连接，转发请求和响应
            headers = {}
            body_start = request.find("\r\n\r\n")
            header_section = request[:body_start] if body_start >= 0 else request
            for line in header_section.split("\r\n")[1:]:
                if ":" in line:
                    k, v = line.split(":", 1)
                    headers[k.strip().lower()] = v.strip()

            host = headers.get("host", "localhost")
            if ":" in host:
                host, port_str = host.split(":")
                port = int(port_str)
            else:
                port = 80

            target_sock = socket.create_connection((host, port), timeout=15)
            target_sock.sendall(data)

            print(f"[proxy] {method} {target} -> {host}:{port}", flush=True)

            # 转发响应
            relay(client_sock, target_sock)

    except Exception as e:
        print(f"[proxy] ERROR: {e}", flush=True)
        try:
            client_sock.sendall(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
        except:
            pass
    finally:
        try:
            client_sock.close()
        except:
            pass


def relay(a, b):
    """双向转发 a <-> b"""
    sockets = [a, b]
    try:
        while True:
            r, _, _ = select.select(sockets, [], [], 30)
            if not r:
                break
            for sock in r:
                data = sock.recv(BUFSIZE)
                if not data:
                    return
                other = b if sock is a else a
                other.sendall(data)
    except Exception:
        pass
    finally:
        try:
            a.close()
        except:
            pass
        try:
            b.close()
        except:
            pass


def main():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("0.0.0.0", PORT))
    server.listen(50)
    print(f"[proxy] Tailscale 转发代理已启动: 0.0.0.0:{PORT}", flush=True)

    while True:
        try:
            client, addr = server.accept()
            print(f"[proxy] 连接来自 {addr[0]}:{addr[1]}", flush=True)
            t = threading.Thread(target=handle_client, args=(client,), daemon=True)
            t.start()
        except KeyboardInterrupt:
            print("\n[proxy] 已停止")
            break
        except Exception as e:
            print(f"[proxy] accept error: {e}", flush=True)

    server.close()


if __name__ == "__main__":
    main()
