import { PassThrough } from 'node:stream'
import { Exec } from '@kubernetes/client-node'
import wsLib from 'ws'
import { getKubeConfig } from './kube.js'
import { accountFromWsToken, originAllowed } from './auth.js'
import { authorizeStream, watchStream } from './streamSecurity.js'
import { writeAudit } from './auditService.js'
import { config } from './config.js'

const { WebSocketServer, WebSocket } = wsLib

/**
 * 容器内交互式终端：浏览器 <-> 本服务 (WebSocket/JSON) <-> API Server (K8s stream 协议)
 * 前端消息：{type:'stdin', data:<base64>} / {type:'resize', cols, rows}
 * 后端消息：{type:'stdout'|'stderr', data:<base64>} / {type:'exit'|'error', data:<text>}
 */
export function attachTerminal(server, { isSecureRequest = req => !!req.socket.encrypted } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64*1024 })
  const counts = new Map()

  server.on('upgrade', (req, socket, head) => {
    let url
    try { url = new URL(req.url, 'http://localhost') } catch (e) { socket.destroy(); return }
    if (url.pathname !== '/api/v1/ws/exec') {socket.destroy();return}
    req.secure=isSecureRequest(req)
    if(!req.headers.origin||!originAllowed(req)) {socket.destroy();return}
    let account
    try { account=accountFromWsToken(url) } catch {socket.destroy();return}
    if (!account) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    try {
      authorizeStream(account,'exec',{clusterId:url.searchParams.get('clusterId'),namespace:url.searchParams.get('namespace'),pod:url.searchParams.get('pod')})
      if((counts.get(account.username)||0)>=5) throw new Error('终端并发限制')
    } catch {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    req.account=account
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req,url))
  })

  wss.on('connection', async (ws, req, url) => {
    const namespace = url.searchParams.get('namespace')
    const pod = url.searchParams.get('pod')
    const container = url.searchParams.get('container') || ''
    const shell = url.searchParams.get('shell') || '/bin/sh'
    const clusterId = url.searchParams.get('clusterId') || undefined
    const account=req.account
    if(!['/bin/sh','/bin/bash','sh','bash'].includes(shell)) {ws.close(1008,'不支持的 shell');return}
    counts.set(account.username,(counts.get(account.username)||0)+1)
    let lastInput=Date.now(),closed=false,kubeWs=null
    const stopWatch=watchStream(account,'exec',{clusterId,namespace,pod},()=>ws.close(1008,'权限或会话已失效'))
    const expiry=setInterval(()=>{if(Date.now()-lastInput>config.terminalIdleMs)ws.close(1008,'终端闲置超时')},10000)
    const maxAge=setTimeout(()=>ws.close(1008,'终端已达最长连接时限'),config.terminalMaxMs)
    const cleanup=()=>{
      if(closed)return;closed=true
      counts.set(account.username,Math.max(0,(counts.get(account.username)||1)-1))
      stopWatch();clearInterval(expiry);clearTimeout(maxAge)
      try {stdin.end();stdout.destroy();stderr.destroy();kubeWs?.close()} catch {}
    }
    ws.on('close',cleanup);ws.on('error',cleanup)
    try {writeAudit({username:account.username,action:'exec:start',clusterId,namespace,resource:'pods/exec',name:pod,status:101})} catch {ws.close(1011,'审计不可用');return}

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

    try {
      const kc = getKubeConfig(clusterId)
      const exec = new Exec(kc)
      kubeWs = await exec.exec(
        namespace, pod, container, [shell],
        stdout, stderr, stdin, true,
        status => send('exit', status?.message || `exit code ${status?.code ?? 0}`)
      )
      if(closed){try{kubeWs?.close()}catch{};return}
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
        lastInput=Date.now()
        try { stdin.write(Buffer.from(msg.data, 'base64')) } catch (e) { /* ignore */ }
      } else if (msg.type === 'resize') {
        const rows = Math.min(500,Math.max(1,Number(msg.rows)||24))
        const cols = Math.min(500,Math.max(1,Number(msg.cols)||80))
        stdout.rows = rows
        stdout.columns = cols
        stdout.emit('resize')
      }
    })

  })

  return wss
}
