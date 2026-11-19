<template>
  <el-dialog :model-value="true" title="容器操作"
    width="min(1080px, 94vw)" top="10vh" append-to-body :close-on-click-modal="false"
    @update:model-value="open => { if (!open) emit('close') }">
    <p class="pod-picker-context">{{ target.namespace }} / {{ target.name }}</p>
    <p v-if="loading" class="kp-muted" role="status">正在读取容器组…</p>
    <el-alert v-else-if="error" :title="error" type="error" show-icon :closable="false" />
    <template v-else>
      <el-alert v-if="incomplete" title="仅加载了部分容器组，可在容器组列表中继续查找" type="warning" :closable="false" />
      <div v-if="groups.length" class="pod-groups">
        <details v-for="({ pod, phase, containers }, index) in groups" :key="pod.metadata.uid" :open="index===0" class="pod-group">
          <summary class="pod-summary">
            <span class="pod-identity"><strong>{{ pod.metadata.name }}</strong><span v-if="pod.spec?.nodeName">节点 {{ pod.spec.nodeName }}</span></span>
            <el-tag :type="phase==='Running' ? 'success' : 'info'" size="small" effect="light">{{ phase }}</el-tag>
          </summary>
          <ul v-if="containers.length" class="pod-container-list">
            <li v-for="container in containers" :key="container.key" class="pod-container-row">
              <div class="pod-identity">
                <strong>{{ container.name }} <span v-if="container.type==='Init'">初始化</span><span v-if="container.type==='Ephemeral'">临时</span></strong>
                <code>{{ container.image }}</code>
              </div>
              <div class="pod-container-state">
                <el-tag :type="container.running ? 'success' : 'info'" size="small" effect="light">{{ container.state }}</el-tag>
                <span v-if="container.startedAt" class="kp-muted">启动于 {{ formatStartedAt(container.startedAt) }}</span>
              </div>
              <div class="pod-container-actions">
                <el-button v-if="can('pod:files:read')" size="small" :disabled="!running(pod,container)" @click="openFiles(pod,container)">文件浏览器</el-button>
                <el-button v-if="target.terminal" size="small" :disabled="!running(pod,container)||!container.startedAt" @click="openBatch(pod,container)">批量执行</el-button>
                <el-button v-if="target.logs" size="small" :loading="downloads.has(container.key)" @click="downloadLogs(container)">下载日志</el-button>
                <el-button v-if="target.logs" size="small" plain type="primary" :aria-label="`追踪 ${pod.metadata.name} / ${container.name} 的日志`" @click="select('logs', pod, container)">追踪日志</el-button>
                <el-dropdown v-if="target.terminal" split-button size="small" type="primary" :disabled="!running(pod,container)"
                  @click="select('terminal',pod,container,'/bin/sh')" @command="shell=>select('terminal',pod,container,shell)">
                  打开终端
                  <template #dropdown><el-dropdown-menu><el-dropdown-item command="/bin/sh">sh</el-dropdown-item><el-dropdown-item command="/bin/bash">bash</el-dropdown-item></el-dropdown-menu></template>
                </el-dropdown>
              </div>
            </li>
          </ul>
          <p v-else class="kp-muted pod-empty">该容器组没有可用容器</p>
        </details>
      </div>
      <p v-else class="kp-muted">当前部署没有所属容器组</p>
    </template>
    <template #footer>
      <el-button v-if="!loading" @click="load">刷新</el-button>
      <el-button @click="emit('close')">关闭</el-button>
    </template>
  </el-dialog>
  <ContainerFilesDialog v-model="filesVisible" :target="fileTarget" append-to-body />
  <ContainerBatchDialog v-if="batchTarget" :workload="target" :entries="batchTarget.entries" :initial-key="batchTarget.key" @close="batchTarget=null" />
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, shallowReactive, shallowRef, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import { ownedPods, podContainers } from '../utils/container-targets'
import { readResourcePages } from '../utils/resource'
import { can } from '../utils/perm'
import ContainerFilesDialog from './ContainerFilesDialog.vue'
import ContainerBatchDialog from './ContainerBatchDialog.vue'

const props = defineProps({ target: { type: Object, required: true }, contextKey: String })
const emit = defineEmits(['close', 'select'])
const pods = ref([])
const error = ref('')
const loading = ref(true)
const incomplete = ref(false)
const filesVisible = ref(false)
const fileTarget = shallowRef(null)
const batchTarget = shallowRef(null)
const downloads = shallowReactive(new Map())
let controller
let logTailLines = '2000'

const groups = computed(() => pods.value.map(pod => ({
  pod,
  phase: pod.metadata.deletionTimestamp ? 'Terminating' : (pod.status?.phase || 'Unknown'),
  containers: podContainers(pod),
})))

async function load() {
  controller?.abort()
  const request = new AbortController()
  controller = request
  const { clusterId, namespace, name, uid, kind } = props.target
  const singlePod = kind === 'Pod'
  const config = { signal: request.signal, silent: true }
  loading.value = true
  error.value = ''
  incomplete.value = false
  pods.value = []
  try {
    const resource = await api.get(singlePod ? '' : 'apps', 'v1', singlePod ? 'pods' : 'deployments',
      namespace, name, { ...config, params: { clusterId } })
    if (request.signal.aborted) return
    if (resource?.metadata?.uid !== uid || resource.metadata.name !== name || resource.metadata.namespace !== namespace) {
      throw new Error('资源已被替换，请关闭后刷新列表')
    }
    if (singlePod) { pods.value = [resource]; return }
    const list = (group, plural) => readResourcePages(cursor => api.list(group, 'v1', plural,
      { clusterId, namespace, limit: 200, continue: cursor }, config), request.signal)
    const [related, replicas] = await Promise.all([list('', 'pods'), list('apps', 'replicasets')])
    if (request.signal.aborted) return
    incomplete.value = related.incomplete || replicas.incomplete
    pods.value = ownedPods(resource, related.items, replicas.items)
      .filter(pod => pod.metadata?.uid && pod.metadata.name)
      .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
  } catch (cause) {
    if (request.signal.aborted) return
    error.value = cause.message || '无法读取所属容器组'
    request.abort()
  } finally {
    if (controller === request) loading.value = false
  }
}

function running(pod, container) { return container.running&&!pod.metadata.deletionTimestamp }
function formatStartedAt(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', {hour12:false})
}
function openFiles(pod, container) {
  if (!can('pod:files:read')||!running(pod,container)) return
  fileTarget.value = {namespace:container.namespace,pod:container.pod,container:container.name,uid:container.uid,
    startedAt:container.startedAt,clusterId:props.target.clusterId}
  filesVisible.value = true
}
function openBatch(pod, container) {
  if (!props.target.terminal||!can('pod:exec')||!running(pod,container)||!container.startedAt) return
  const entries = groups.value.flatMap(group=>group.containers.filter(item=>running(group.pod,item)&&item.startedAt))
  batchTarget.value = {key:container.key,entries}
}
async function downloadLogs(container) {
  if (!props.target.logs||!can('pod:logs')||downloads.has(container.key)) return
  const request = new AbortController()
  downloads.set(container.key,request)
  try {
    const destination = { ...container, clusterId: props.target.clusterId }
    const { value } = await ElMessageBox.prompt('输入要下载的日志行数，单次最多 5 MiB。', '下载日志', {
      inputValue: logTailLines,
      inputPlaceholder: '日志行数',
      inputValidator: value => /^[1-9]\d*$/.test(value) && Number(value) <= 20000 || '请输入 1–20000 的整数',
      confirmButtonText: '下载',
      cancelButtonText: '取消',
    })
    if (request.signal.aborted || !can('pod:logs')) return
    logTailLines = value
    const blob = await api.containerLogsDownload({...destination,tailLines:Number(value)},{signal:request.signal})
    if (request.signal.aborted) return
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.href = url
    link.download = `${container.pod}-${container.name}.log`
    document.body.appendChild(link)
    try { link.click() } finally { link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000) }
  } catch (cause) {
    if (request.signal.aborted || cause === 'cancel' || cause === 'close') return
    let message = cause.message||'日志下载失败'
    const body = cause.raw?.response?.data
    if (body instanceof Blob) {
      try { message = JSON.parse(await body.text()).message||message } catch { /* Keep the original error. */ }
    }
    if (!request.signal.aborted) ElMessage.error(message)
  } finally { downloads.delete(container.key) }
}
function select(mode, pod, container, shell) {
  if (loading.value) return
  if (mode === 'logs' ? !props.target.logs : !props.target.terminal || !running(pod,container)) return
  const { uid, name, namespace } = pod.metadata
  emit('select', { mode, uid, name, namespace, container: container.name, shell })
}

watch(() => props.contextKey, () => emit('close'))
onMounted(load)
onUnmounted(() => { controller?.abort(); for (const request of downloads.values()) request.abort() })
</script>

<style scoped>
.pod-picker-context{margin:0 0 16px;color:var(--kp-text-2);font-weight:600;overflow-wrap:anywhere}
.pod-groups{display:grid;gap:10px;max-height:62vh;overflow:auto;margin-top:12px}
.pod-group{border:1px solid var(--kp-border);border-radius:8px;overflow:hidden}
.pod-summary{display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;list-style:none}
.pod-summary::-webkit-details-marker{display:none}
.pod-summary::before{content:'';border:solid var(--kp-muted);border-width:0 1.5px 1.5px 0;padding:3px;transform:rotate(-45deg);flex:none}
.pod-group[open]>.pod-summary::before{transform:rotate(45deg)}
.pod-summary:focus-visible{outline:2px solid var(--kp-brand);outline-offset:-2px}
.pod-summary .pod-identity{flex:1}
.pod-identity{display:grid;gap:3px;min-width:0;overflow-wrap:anywhere}
.pod-identity span,.pod-identity code{color:var(--kp-muted);font-size:12px;font-weight:400}
.pod-container-list{margin:0;padding:0;list-style:none}
.pod-container-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(90px,auto) auto;align-items:center;gap:12px;padding:12px 16px 12px 35px;border-top:1px solid var(--kp-border);background:var(--kp-surface-2)}
.pod-container-state{display:grid;justify-items:start;gap:5px;font-size:12px}
.pod-container-actions{display:flex;flex-wrap:wrap;gap:6px}
.pod-container-actions .el-button{margin:0}
.pod-empty{padding:0 16px}
@media(max-width:820px){.pod-container-row{grid-template-columns:minmax(0,1fr) auto;padding-left:16px}.pod-container-actions{grid-column:1/-1}}
</style>
