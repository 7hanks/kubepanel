<template>
  <div>
    <div class="kp-toolbar">
      <el-button :icon="ArrowLeft" @click="$router.back()">返回</el-button>
      <span style="font-weight:600">{{ namespace }} / {{ name }}</span>
      <el-select v-model="container" style="width:180px"><el-option v-for="c in containers" :key="c" :label="c" :value="c" /></el-select>
      <el-select v-model="shell" style="width:150px">
        <el-option v-for="s in ['/bin/sh', '/bin/bash', '/bin/ash', 'sh']" :key="s" :label="s" :value="s" />
      </el-select>
      <el-tag disable-transitions :type="status === 'open' ? 'success' : status === 'error' ? 'danger' : 'info'" size="small">{{ statusText }}</el-tag>
      <span class="spacer" />
      <el-button @click="connect" :disabled="!container || status === 'open'">连接</el-button>
      <el-button @click="disconnect">断开</el-button>
      <el-button @click="term?.clear()">清屏</el-button>
    </div>
    <el-alert type="info" :closable="false" style="margin-bottom:10px"
      title="容器内交互式终端（等价 kubectl exec -it）。会话权限取决于集群凭据，请谨慎执行写操作。" />
    <div ref="host" class="kp-terminal" />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import api, { execWsUrl } from '../api'
import { can } from '../utils/perm'

const route = useRoute()
const router = useRouter()
const namespace = route.params.namespace
const name = route.params.name

const host = ref(null)
const containers = ref([])
const container = ref('')
const shell = ref('/bin/sh')
const status = ref('closed') // closed | connecting | open | error
const statusText = ref('未连接')
let term = null
let fit = null
let ws = null
let ro = null
let connectionRequest=0
let disposed=false

function makeTerm() {
  if (term) return
  term = new Terminal({
    cursorBlink: true, fontSize: 13, fontFamily: 'Consolas, "JetBrains Mono", monospace',
    theme: { background: '#0f1724', foreground: '#d6e2f0', cursor: '#4d9bff' },
    scrollback: 5000, convertEol: false,
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(host.value)
  fit.fit()
  term.focus()
  term.onData(data => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stdin', data: b64encode(data) }))
    }
  })
  term.onResize(({ cols, rows }) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }))
  })
  ro = new ResizeObserver(() => { try { fit.fit() } catch (e) { /* ignore */ } })
  ro.observe(host.value)
}

// 浏览器没有全局 Buffer，这里用 TextEncoder 做 UTF-8 -> base64
function b64encode(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
function b64decode(b64) {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

async function connect() {
  if (!can('pod:exec')) return ElMessage.error('没有容器终端权限')
  if (!container.value) return ElMessage.warning('请先选择容器')
  makeTerm()
  disconnect(false)
  const request=++connectionRequest
  status.value = 'connecting'
  statusText.value = '连接中...'
  term.write('\r\n\x1b[36m[KubePanel] 正在连接容器...\x1b[0m\r\n')

  let ticket
  try { ({ticket} = await api.streamTicket({purpose:'exec',clusterId:localStorage.getItem('kp_cluster'),namespace,pod:name})) }
  catch (e) { if(!disposed && request===connectionRequest){status.value='error'; statusText.value=e.message || '授权失败'} return }
  if(disposed || request!==connectionRequest)return
  const url = execWsUrl({ namespace, pod: name, container: container.value, shell: shell.value, ticket })
  const socket = new WebSocket(url)
  ws = socket
  socket.binaryType = 'arraybuffer'

  socket.onopen = () => {
    status.value = 'open'
    statusText.value = '已连接'
    term.write('\x1b[32m[KubePanel] 连接成功\x1b[0m\r\n')
    term.focus()
    socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
  }
  socket.onmessage = ev => {
    try {
      const msg = JSON.parse(ev.data)
      if (msg.type === 'stdout' || msg.type === 'stderr') term.write(b64decode(msg.data))
      else if (msg.type === 'error') { term.write(`\r\n\x1b[31m[错误] ${msg.data}\x1b[0m\r\n`); disconnect(false) }
      else if (msg.type === 'exit') { term.write(`\r\n\x1b[33m[会话结束] ${msg.data}\x1b[0m\r\n`); disconnect(false) }
    } catch (e) { /* 忽略非 JSON 消息 */ }
  }
  socket.onerror = () => {
    status.value = 'error'; statusText.value = '连接失败'
    term.write('\r\n\x1b[31m[错误] WebSocket 连接失败，请检查 Pod 状态与认证\x1b[0m\r\n')
  }
  socket.onclose = () => {
    if (status.value === 'open' || status.value === 'connecting') {
      status.value = 'closed'; statusText.value = '连接已关闭'
      term.write('\r\n\x1b[33m[连接已关闭]\x1b[0m\r\n')
    }
  }
}

function disconnect(write = true) {
  connectionRequest++
  if (ws) { try { ws.close() } catch (e) { /* ignore */ } ws = null }
  status.value = 'closed'; statusText.value = '未连接'
  if (write && term) term.write('\r\n\x1b[33m[已主动断开]\x1b[0m\r\n')
}

watch(container, () => disconnect(false))

onMounted(async () => {
  if (!can('pod:exec')) {
    ElMessage.error('当前账号只有查看权限，不能进入容器终端')
    router.back()
    return
  }
  await nextTick()
  makeTerm()
  term.write('\x1b[36mKubePanel Web Terminal\x1b[0m\r\n点击右上角「连接」进入容器。\r\n\r\n')
  try {
    const pod = await api.get('', 'v1', 'pods', namespace, name)
    if(route.query.uid && route.query.uid!==pod.metadata?.uid)throw new Error('Pod 已重新创建，请重新选择容器')
    containers.value = [...(pod.spec?.containers || []),...(pod.spec?.initContainers || []),...(pod.spec?.ephemeralContainers || [])].map(c => c.name)
    if(route.query.container && !containers.value.includes(route.query.container))throw new Error('所选容器已不存在，请重新选择')
    container.value = containers.value.includes(route.query.container) ? route.query.container : containers.value[0] || ''
    if (['/bin/sh','/bin/bash','sh','bash'].includes(route.query.shell)) shell.value=route.query.shell
  } catch (e) { ElMessage.error('无法获取 Pod 信息：' + e.message) }
})

onUnmounted(() => { disposed=true; if (ro) ro.disconnect(); disconnect(false); if (term) term.dispose() })
</script>
