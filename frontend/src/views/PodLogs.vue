<template>
  <div>
    <div class="kp-toolbar">
      <el-button :icon="ArrowLeft" @click="$router.back()">返回</el-button>
      <span style="font-weight:600">{{ namespace }} / {{ name }}</span>
      <el-select v-model="container" placeholder="容器" size="default" style="width:180px">
        <el-option v-for="c in containers" :key="c" :label="c" :value="c" />
      </el-select>
      <el-select v-model="tailLines" style="width:130px">
        <el-option v-for="n in [100, 200, 500, 1000, 5000]" :key="n" :label="`最后 ${n} 行`" :value="n" />
      </el-select>
      <el-checkbox v-model="timestamps">时间戳</el-checkbox>
      <el-checkbox v-model="previous">上一容器</el-checkbox>
      <el-checkbox v-model="follow" @change="reconnect">实时跟随</el-checkbox>
      <span class="spacer" />
      <el-button @click="reconnect" :disabled="!container"><el-icon><Refresh /></el-icon> 重新加载</el-button>
      <el-button @click="paused = !paused">{{ paused ? '继续滚动' : '暂停滚动' }}</el-button>
      <el-button @click="lines = []">清屏</el-button>
      <el-button @click="download">下载日志</el-button>
    </div>

    <div class="kp-card" style="padding:10px 12px;margin-bottom:10px;display:flex;align-items:center;gap:10px">
      <el-tag :type="connected ? 'success' : 'info'" size="small">{{ connected ? '实时连接中' : follow ? '连接中...' : '已加载' }}</el-tag>
      <span class="kp-muted" style="font-size:12px">{{ lines.length }} 行 · 容器 {{ container || '-' }}</span>
      <span class="spacer" />
      <el-input v-model="filter" placeholder="过滤关键字" clearable size="small" style="width:220px" :prefix-icon="Search" />
    </div>

    <div ref="logBox" class="kp-log" @scroll="onScroll">{{ shown }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Refresh, Search } from '@element-plus/icons-vue'
import api, { logsUrl } from '../api'

const route = useRoute()
const namespace = route.params.namespace
const name = route.params.name

const containers = ref([])
const container = ref('')
const tailLines = ref(200)
const timestamps = ref(false)
const previous = ref(false)
const follow = ref(true)
const paused = ref(false)
const connected = ref(false)
const lines = ref([])
const filter = ref('')
const logBox = ref(null)
let source = null
let stickBottom = true

const shown = computed(() => {
  const f = filter.value.trim()
  const arr = f ? lines.value.filter(l => l.includes(f)) : lines.value
  return arr.join('\n') || (connected.value ? '等待日志输出...' : '暂无日志')
})

function closeSource() {
  if (source) { source.close(); source = null }
  connected.value = false
}

function reconnect() {
  if (!container.value) return
  closeSource()
  lines.value = []
  const params = {
    container: container.value,
    tailLines: tailLines.value,
    timestamps: timestamps.value ? 1 : 0,
    previous: previous.value ? 1 : 0,
    follow: follow.value ? 1 : 0,
  }
  const es = new EventSource(logsUrl(namespace, name, params))
  source = es
  es.onopen = () => { connected.value = true }
  es.onmessage = ev => {
    // 后端按「一行日志 = 一个 SSE 事件」推送，天然规避 SSE data 不能含换行的问题
    lines.value.push(ev.data)
    if (lines.value.length > 20000) lines.value.splice(0, lines.value.length - 20000)
    if (!paused.value && stickBottom) nextTick(() => { if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight })
  }
  es.addEventListener('eof', () => { connected.value = false; closeSource() })
  es.onerror = () => {
    closeSource()
    ElMessage.warning('日志流已断开，可点击「重新加载」')
  }
}
function onScroll() {
  const el = logBox.value
  if (!el) return
  stickBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}
function download() {
  const blob = new Blob([lines.value.join('\n')], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = `${name}-${container.value}.log`; a.click()
  URL.revokeObjectURL(a.href)
}

watch([container, tailLines, timestamps, previous], () => { if (container.value) reconnect() })

onMounted(async () => {
  try {
    const pod = await api.get('', 'v1', 'pods', namespace, name)
    containers.value = [
      ...(pod.spec?.initContainers || []).map(c => c.name),
      ...(pod.spec?.containers || []).map(c => c.name),
    ]
    container.value = containers.value[0] || ''
  } catch (e) { ElMessage.error('无法获取 Pod 信息：' + e.message) }
})
onUnmounted(closeSource)
</script>
