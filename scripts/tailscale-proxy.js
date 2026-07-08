/**
 * 轻量 HTTP 代理 — 跑在 Tailscale 出口节点上
 * wanxia 通过这个代理访问 open-meteo，利用出口节点的干净公网 IP
 *
 * 部署方式（在出口节点上运行）：
 *   node tailscale-proxy.js
 *
 * wanxia .env 配置：
 *   HTTPS_PROXY=http://<tailscale-ip-of-this-node>:8808
 */

import http from 'http'
import https from 'https'
import net from 'net'

const PORT = 8808

const server = http.createServer((clientReq, clientRes) => {
  console.log(`[proxy] ${clientReq.method} ${clientReq.url}`)

  // 解析目标 URL
  const target = new URL(clientReq.url)
  const isHttps = target.protocol === 'https:'

  const options = {
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    path: target.pathname + target.search,
    method: clientReq.method,
    headers: { ...clientReq.headers },
  }
  // 去掉 proxy 相关头
  delete options.headers['proxy-connection']
  delete options.headers['proxy-authorization']

  const transport = isHttps ? https : http
  const proxyReq = transport.request(options, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers)
    proxyRes.pipe(clientRes)
  })

  proxyReq.on('error', (err) => {
    console.error(`[proxy] Error: ${err.message}`)
    clientRes.writeHead(502)
    clientRes.end('Proxy error')
  })

  clientReq.pipe(proxyReq)
})

// 也支持 CONNECT 方法（HTTPS 直连）
server.on('connect', (req, clientSocket, head) => {
  const [hostname, port] = req.url.split(':')
  console.log(`[proxy] CONNECT ${hostname}:${port}`)

  const serverSocket = net.connect(port || 443, hostname, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    serverSocket.write(head)
    serverSocket.pipe(clientSocket)
    clientSocket.pipe(serverSocket)
  })

  serverSocket.on('error', (err) => {
    console.error(`[proxy] CONNECT error: ${err.message}`)
    clientSocket.end()
  })

  clientSocket.on('error', () => serverSocket.end())
})

server.listen(PORT, () => {
  console.log(`[proxy] Tailscale HTTP 代理已启动: http://0.0.0.0:${PORT}`)
  console.log(`[proxy] wanxia .env 配置: HTTPS_PROXY=http://<本机Tailscale IP>:${PORT}`)
})
