import { kubeStream, KubeError } from './kube.js'
import { authorizeStream, watchStream } from './streamSecurity.js'
import { StringDecoder } from 'node:string_decoder'

/**
 * GET /api/v1/pods/:namespace/:name/logs —— Pod 日志 SSE 流
 * 后端按「一行日志 = 一个 SSE 事件」转发，follow=1 时保持长连接。
 */
export async function streamPodLogs(req, res) {
  const { namespace, name } = req.params
  const q = req.query || {}
  authorizeStream(req.account,'logs',{clusterId:req.clusterId,namespace,pod:name})

  const params = new URLSearchParams()
  if (q.container) params.append('container', String(q.container))
  params.append('tailLines',String(Math.min(20000,Math.max(1,Number(q.tailLines)||200))))
  if (q.sinceSeconds) params.append('sinceSeconds',String(Math.min(604800,Math.max(1,Number(q.sinceSeconds)||3600))))
  if (String(q.timestamps) === '1') params.append('timestamps', 'true')
  if (String(q.previous) === '1') params.append('previous', 'true')
  if (String(q.follow) === '1') params.append('follow', 'true')

  const path = `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}/log?${params}`

  let upstream
  try {
    // pods/log 返回纯文本端点，不能带 application/json / text/plain 的 Accept
    // （API Server 会按标准序列化器协商并报「only the following media types are accepted」）
    upstream = await kubeStream('GET', path, { headers: { Accept: '*/*' }, timeout: 0, clusterId: req.clusterId })
  } catch (e) {
    if (!res.headersSent) {
      return res.status(e.status || 502).json({ message: e.message })
    }
    return
  }

  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // 禁止 Nginx 缓冲，保证实时
  res.flushHeaders?.()

  let buffer = ''
  let closed = false
  const decoder=new StringDecoder('utf8')
  const stopWatch=watchStream({...req.account,sessionId:req.session?.id},'logs',{clusterId:req.clusterId,namespace,pod:name},()=>{cleanup();res.end()})
  const heartbeat = setInterval(() => {
    if (!closed && !res.writableEnded) res.write(': keepalive\n\n')
  }, 20000)

  const emitLine = line => {
    if (closed || res.writableEnded) return
    const safe = line.replace(/\r$/, '').replace(/\n/g, ' ')
    if(!res.write(`data: ${safe}\n\n`)) {upstream.pause();res.once('drain',()=>{if(!closed)upstream.resume()})}
  }

  upstream.on('data', chunk => {
    buffer += decoder.write(chunk)
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      emitLine(buffer.slice(0, idx))
      buffer = buffer.slice(idx + 1)
    }
    // 防止无换行的超长日志无限占用内存
    if (buffer.length > 1024 * 1024) { emitLine(buffer); buffer = '' }
  })
  upstream.on('end', () => {
    buffer+=decoder.end()
    if (buffer) emitLine(buffer)
    if (!closed && !res.writableEnded) res.write('event: eof\ndata: end\n\n')
    cleanup()
    res.end()
  })
  upstream.on('error', err => {
    if (!closed && !res.writableEnded) res.write(`event: error\ndata: ${err.message}\n\n`)
    cleanup()
    res.end()
  })

  function cleanup() {
    closed = true
    clearInterval(heartbeat)
    stopWatch()
    try { upstream.destroy() } catch (e) { /* ignore */ }
  }
  req.on('close', cleanup)
  res.on('close', cleanup)
}
