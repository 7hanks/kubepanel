import { PassThrough } from 'node:stream'
import { Exec } from '@kubernetes/client-node'
import wsLib from 'ws'
import { getKubeConfig } from './kube.js'
import { accountFromWsToken } from './auth.js'
import { can } from './permissions.js'

const { WebSocketServer, WebSocket } = wsLib

/**
 * 容器内交互式终端：浏览器 <-> 本服务 (WebSocket/JSON) <-> API Server (K8s stream 协议)
 * 前端消息：{type:'stdin', data:<base64>} / {type:'resize', cols, rows}
 * 后端消息：{type:'stdout'|'stderr', data:<base64>} / {type:'exit'|'error', data:<text>}
 */
export function attachTerminal(server) {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    let url
    try { url = new URL(req.url, 'http://localhost') } catch (e) { socket.destroy(); return }
    if (url.pathname !== '/api/v1/ws/exec') return // 交给其它 upgrade 处理器
    const account = accountFromWsToken(url)
    if (!account) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    // 容器内执行命令属于集群对象的写操作，只读角色不允许
    if (!can(account, 'cluster:update') && !can(account, 'cluster:create')) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req, url))
  })

  wss.on('connection', async (ws, req, url) => {
    const namespace = url.searchParams.get('namespace')
    const pod = url.searchParams.get('pod')
    const container = url.searchParams.get('container') || ''
    const shell = url.searchParams.get('shell') || '/bin/sh'
    const clusterId = url.searchParams.get('clusterId') || undefined

    const send = (type, data) => {
      if (ws.readyState !== WebSocket.OPEN) return
      try {
        ws.send(JSON.stringify({ type, data: Buffer.isBuffer(data) ? data.toString('base64') : String(data) }))
      } catch (e) { /* ignore */ }
    }

    if (!namespace || !pod) { send('error', '缺少 namespace / pod 参数'); ws.close(); return }

    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const stdin = new PassThrough()
    // Exec 通过 rows/columns + 'resize' 事件判断是否启用终端尺寸通道
    stdout.rows = 24
    stdout.columns = 80

    stdout.on('data', c => send('stdout', c))
    stderr.on('data', c => send('stderr', c))

    let kubeWs = null
    try {
      const kc = getKubeConfig(clusterId)
      const exec = new Exec(kc)
      kubeWs = await exec.exec(
        namespace, pod, container, [shell],
        stdout, stderr, stdin, true,
        status => send('exit', status?.message || `exit code ${status?.code ?? 0}`)
      )
      send('stdout', Buffer.from(`\r\n`))
    } catch (e) {
      send('error', `exec 连接失败：${e.message}`)
      ws.close()
      return
    }

    ws.on('message', raw => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch (e) { return }
      if (msg.type === 'stdin' && typeof msg.data === 'string') {
        try { stdin.write(Buffer.from(msg.data, 'base64')) } catch (e) { /* ignore */ }
      } else if (msg.type === 'resize') {
        const rows = Math.max(1, Number(msg.rows) || 24)
        const cols = Math.max(1, Number(msg.cols) || 80)
        stdout.rows = rows
        stdout.columns = cols
        stdout.emit('resize')
      }
    })

    const closeAll = () => {
      try { stdin.end() } catch (e) { /* ignore */ }
      try { if (kubeWs && kubeWs.readyState === WebSocket.OPEN) kubeWs.close() } catch (e) { /* ignore */ }
    }
    ws.on('close', closeAll)
    ws.on('error', closeAll)
  })

  return wss
}
