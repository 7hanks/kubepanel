import WebSocket from 'ws'
import { randomBytes, createHash } from 'node:crypto'
import { getKubeConfig } from './kube.js'

export const TRANSFER_LIMIT = 5 * 1024 ** 3
export const TRANSFER_TIMEOUT = 2 * 60 * 60 * 1000
const error = (status, message) => Object.assign(new Error(message), { status })
export function transferSize(value) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) throw error(400, '文件大小无效')
  const size = Number(value)
  if (!Number.isSafeInteger(size) || size > TRANSFER_LIMIT) throw error(413, '文件不能超过 5 GiB')
  return size
}

// File paths and sizes are argv, never shell source. The final byte is a commit
// marker sent only after the HTTP body has ended at exactly the declared size.
export function transferCommand(action, path, { size = 0, overwrite = false } = {}) {
  const scripts = {
    stat: '[ -f "$1" ] && [ ! -L "$1" ] || exit 2; stat -c %s "$1"',
    download: '[ -f "$1" ] && [ ! -L "$1" ] || exit 2; head -c "$2" "$1"',
    upload: `umask 077
p=$1
[ ! -L "$p" ] && { [ ! -e "$p" ] || [ -f "$p" ]; } || exit 2
m=; if [ -f "$p" ] && [ "$3" = overwrite ]; then m=$(stat -c %a "$p") || exit 2; fi
d=\${p%/*}; [ -n "$d" ] || d=/
t=$(mktemp "$d/.kubepanel-upload.XXXXXXXXXX") || exit 3
g=
trap 'rm -f "$t"; [ -z "$g" ] || rm -f "$g"' EXIT
trap 'exit 4' HUP INT TERM
head -c "$2" > "$t" || exit 5
n=$(stat -c %s "$t") || exit 5
[ "$n" -eq "$2" ] || exit 6
printf R
c=$(head -c 1) || exit 6
[ "$c" = C ] || exit 6
[ ! -L "$p" ] && { [ ! -e "$p" ] || [ -f "$p" ]; } || exit 7
if [ -n "$m" ]; then chmod "$m" "$t" || exit 7; fi
if [ "$3" = overwrite ]; then
  if ! mv -fT "$t" "$p" 2>/dev/null; then
    # Older BusyBox mv has no -T. Recheck after the failed attempt and
    # detect its directory-target behavior instead of reporting success.
    [ -f "$t" ] && [ ! -L "$p" ] && { [ ! -e "$p" ] || [ -f "$p" ]; } || exit 7
    g="$t.guard"; ln -T "$t" "$g" || exit 7
    mv -f "$t" "$p" || exit 7
    if [ -d "$p" ]; then
      candidate="$p/\${t##*/}"
      if [ "$candidate" -ef "$g" ]; then t=$candidate; fi
      exit 7
    fi
  fi
else
  ln -T "$t" "$p" || exit 7
fi`,
  }
  if (!scripts[action]) throw error(400, '不支持的传输操作')
  return ['/bin/sh', '-c', scripts[action], 'kubepanel', path, String(action === 'download' ? size + 1 : size), overwrite ? 'overwrite' : 'create']
}

export async function connectTransfer(target, command, stdin, receive) {
  const kc = getKubeConfig(target.clusterId), cluster = kc.getCurrentCluster()
  if (!cluster) throw error(502, '集群连接不可用')
  const url = new URL(cluster.server)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `${url.pathname.replace(/\/$/, '')}/api/v1/namespaces/${encodeURIComponent(target.namespace)}/pods/${encodeURIComponent(target.pod)}/exec`
  url.search = new URLSearchParams({ container: target.container, stdin: String(stdin), stdout: 'true', stderr: 'true', tty: 'false' }).toString()
  for (const arg of command) url.searchParams.append('command', arg)
  const options = { maxPayload: 1024 * 1024, perMessageDeflate: false, handshakeTimeout: 10000 }
  await kc.applyToHTTPSOptions(options)
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, ['v5.channel.k8s.io', 'v4.channel.k8s.io'], options)
    ws.on('message', (data, binary) => {
      if (!binary || !data.length) return ws.close()
      receive(data[0], data.subarray(1), ws)
    })
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

// No whole-file buffers: HTTP reads advance only after a websocket send callback;
// websocket reads pause while the HTTP response is backpressured.
export function createTransferExecutor(connect = connectTransfer) {
  return (target, command, { input, output, size, signal, authorize = () => {}, idleMs = 120000, timeoutMs = TRANSFER_TIMEOUT } = {}) => new Promise((resolve, reject) => {
    let socket, done = false, received = 0, sent = 0, inputDone = !input, idle, iterator, ready = false, resolveReady
    const readyToCommit = new Promise(resolve => {resolveReady=resolve})
    const waiting = new Set()
    // Remove each cancellation hook as its wait settles. Racing every chunk
    // against one shared pending Promise retains a growing chain of reactions.
    const wait = promise => new Promise((resolveWait,rejectWait) => {
      if(done){rejectWait(error(499,'传输已结束'));return}
      const cancel=reason=>rejectWait(reason)
      waiting.add(cancel)
      Promise.resolve(promise).then(value=>{waiting.delete(cancel);resolveWait(value)},reason=>{waiting.delete(cancel);rejectWait(reason)})
    })
    const touch = () => { if(done)return; clearTimeout(idle); idle = setTimeout(() => finish(error(504, '文件传输长时间无响应，已停止')), idleMs) }
    const abort = () => finish(error(499, '文件传输已取消'))
    const drain = () => { if (!done) { touch(); socket?.resume() } }
    const finish = (err) => {
      if (done) return
      done = true
      clearTimeout(idle); clearTimeout(deadline); clearInterval(recheck)
      signal?.removeEventListener('abort', abort); output?.off('drain', drain)
      try { socket?.terminate() } catch {}
      for(const cancel of waiting)cancel(err||error(499,'传输已结束'))
      waiting.clear()
      if (err) reject(err); else resolve({ exitCode: 0, bytes: input ? sent : received })
    }
    const deadline = setTimeout(() => finish(error(504, '文件传输超过两小时，已停止')), timeoutMs)
    const recheck = setInterval(() => { try { authorize() } catch (e) { finish(e) } }, 500)
    signal?.addEventListener('abort', abort, { once: true }); output?.on('drain', drain)
    const receive = (channel, data, ws) => {
      if (done) return
      try {
        touch()
        if (channel === 1 && data.length) {
          if (input) {
            if(ready || data.toString()!=='R')throw error(502,'上传返回了意外输出')
            ready=true;resolveReady();return
          }
          received += data.length
          if (received > size) throw error(409, '传输期间文件大小发生变化，请重试')
          if (!output.write(data)) ws.pause()
        } else if (channel === 3) {
          if (data.length > 16384) throw error(502, '无效的容器执行结果')
          const status = JSON.parse(data.toString())
          if (status.status !== 'Success') throw error(422, '容器文件传输失败，请检查路径、权限、剩余空间及 head / stat / mktemp / ln / mv 工具')
          if (!inputDone || (output && received !== size)) throw error(409, '文件传输不完整，请重试')
          authorize(); finish()
        } else if (channel === 2) {
          // stderr may contain sensitive paths/content; consume without buffering.
        } else if (channel !== 255 && channel !== 1) throw error(502, '无效的容器传输通道')
      } catch (e) { finish(e.status ? e : error(502, '无法解析容器传输结果')) }
    }
    const send = (data) => wait(new Promise((resolveSend, rejectSend) => {
      const frame = Buffer.allocUnsafe(data.length + 1); frame[0] = 0; data.copy(frame, 1)
      socket.send(frame, err => { if (err) rejectSend(error(502, '容器上传连接中断')); else { touch(); resolveSend() } })
    }))
    ;(async () => {
      try {
        authorize(); if (signal?.aborted) throw error(499, '文件传输已取消')
        touch()
        socket = await connect(target, command, !!input, receive)
        if (done) { socket.terminate(); return }
        socket.on('error', () => finish(error(502, '容器文件连接失败')))
        socket.on('close', () => finish(error(502, '容器连接已关闭，未收到完整结果')))
        if (!input) return
        iterator = input.iterator({ destroyOnReturn: false })
        while (!done) {
          const item = await wait(iterator.next())
          if (item.done) break
          const chunk = Buffer.isBuffer(item.value) ? item.value : Buffer.from(item.value)
          if (sent + chunk.length > size) throw error(413, '上传内容超过声明的文件大小')
          for (let offset = 0; offset < chunk.length; offset += 65536) await send(chunk.subarray(offset, offset + 65536))
          sent += chunk.length
        }
        if (done) return
        if (sent !== size) throw error(400, '上传内容不完整')
        // Some BusyBox head versions read beyond -c into their input buffer.
        // Wait until that process has exited before sending the commit byte.
        await wait(readyToCommit)
        authorize(); inputDone = true
        await send(Buffer.from('C'))
        // v4 stdin EOF closes the whole connection. The remote script exits
        // after consuming the exact byte count and commit marker instead.
      } catch (e) { finish(e.status ? e : error(502, '文件传输连接中断')) }
      finally { iterator?.return().catch(() => {}) }
    })()
  })
}

export function createDownloadTickets({ now = Date.now, limit = 2048 } = {}) {
  const tickets = new Map(), key = token => createHash('sha256').update(String(token)).digest('hex')
  return {
    issue(account, sessionId, target) {
      for (const [hash, record] of tickets) if (record.expires <= now()) tickets.delete(hash)
      if (tickets.size >= limit) throw error(429, '下载请求过多，请稍后重试')
      const token = randomBytes(32).toString('base64url')
      const {clusterId,namespace,pod,container,uid,path,bytes}=target
      tickets.set(key(token), { username: account.username, sessionId, target: {clusterId,namespace,pod,container,uid,path,bytes}, expires: now() + 60000 })
      return token
    },
    consume(token, account, sessionId, clusterId) {
      const hash = key(token), record = tickets.get(hash)
      if (!record || record.expires <= now()) { tickets.delete(hash); throw error(410, '下载链接已失效，请重新下载') }
      if (record.username !== account.username || record.sessionId !== sessionId || record.target.clusterId !== clusterId) throw error(403, '下载链接与当前会话不匹配')
      tickets.delete(hash)
      return record.target
    },
  }
}
