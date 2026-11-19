<template>
  <el-dialog :model-value="true" title="容器操作" class="pod-picker-dialog"
    width="min(1080px, 94vw)" top="10vh" append-to-body :close-on-click-modal="false"
    @update:model-value="open => { if (!open) emit('close') }">
    <div class="pod-picker-context">
      <span class="pod-picker-scope">命名空间 <strong>{{ target.namespace }}</strong></span>
      <span v-if="target.kind==='Deployment'" class="pod-picker-workload">部署 <strong>{{ target.name }}</strong></span>
      <el-button v-if="showTemplateImageAction" class="pod-template-image-action" size="small" type="primary" plain
        @click="emit('update-image')">更新镜像</el-button>
    </div>
    <p v-if="loading" class="kp-muted" role="status">正在读取容器组…</p>
    <el-alert v-else-if="error" :title="error" type="error" show-icon :closable="false" />
    <template v-else>
      <el-alert v-if="incomplete" title="仅加载了部分容器组，可在容器组列表中继续查找" type="warning" :closable="false" />
      <div v-if="groups.length" class="pod-groups">
        <details v-for="({ pod, phase, containers }, index) in groups" :key="pod.metadata.uid" :open="index===0" class="pod-group">
          <summary class="pod-summary">
            <span class="pod-icon" aria-hidden="true"><el-icon><Connection /></el-icon></span>
            <span class="pod-summary-content">
              <strong class="pod-name">{{ pod.metadata.name }}</strong>
              <span v-if="pod.spec?.nodeName" class="pod-node">节点 {{ pod.spec.nodeName }}</span>
            </span>
            <span v-if="containers.length > 1" class="pod-container-count">{{ containers.length }} 个容器</span>
            <el-tag class="pod-state" :type="statusType(phase)" :title="phase" size="small" effect="light">
              {{ statusLabel(phase) }}
            </el-tag>
          </summary>
          <ul v-if="containers.length" class="pod-container-list">
            <li v-for="container in containers" :key="container.key" class="pod-container-row">
              <div class="pod-container-info">
                <span class="pod-container-icon" aria-hidden="true"><el-icon><Box /></el-icon></span>
                <div class="pod-container-content">
                  <div class="pod-container-heading">
                    <strong>{{ container.name }}</strong>
                    <span v-if="container.type==='Init'" class="pod-container-kind">初始化</span>
                    <span v-if="container.type==='Ephemeral'" class="pod-container-kind">临时</span>
                    <el-tag class="pod-state" :type="statusType(container.state)" :title="container.state" size="small" effect="light">
                      {{ statusLabel(container.state) }}
                    </el-tag>
                  </div>
                  <div v-if="container.image" class="pod-image-tools">
                    <div class="pod-image">
                      <code>{{ container.image }}</code>
                      <button type="button" class="pod-image-copy" title="复制镜像地址" :aria-label="`复制 ${container.name} 的镜像地址`"
                        @click="copyImage(container.image)">
                        <el-icon aria-hidden="true"><CopyDocument /></el-icon>
                      </button>
                    </div>
                    <el-button v-if="canEditImage(container)" size="small" type="primary" link
                      :title="`更新部署模板中 ${container.name} 的镜像`"
                      @click="emit('update-image', { name: container.name, field: imageFields[container.type] })">更新镜像</el-button>
                  </div>
                  <div v-if="container.startedAt || container.restartCount > 0" class="pod-runtime">
                    <span v-if="container.startedAt"><el-icon aria-hidden="true"><Clock /></el-icon>
                      启动于 <time :datetime="container.startedAt">{{ formatStartedAt(container.startedAt) }}</time>
                    </span>
                    <el-tag v-if="container.restartCount > 0" size="small" type="info" effect="plain">
                      重启 {{ container.restartCount }} 次
                    </el-tag>
                  </div>
                </div>
              </div>
              <div class="pod-container-actions">
                <el-button v-if="can('pod:files:read')" size="small" color="#147564" plain
                  :disabled="!running(pod,container)" @click="openFiles(pod,container)">文件浏览器</el-button>
                <el-button v-if="target.terminal" size="small" color="#a35412" plain
                  :disabled="!running(pod,container)||!container.startedAt" @click="openBatch(pod,container)">批量执行</el-button>
                <el-button v-if="target.logs" size="small" color="#6d40b7" plain
                  :loading="downloads.has(container.key)" @click="downloadLogs(container)">下载日志</el-button>
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
      <p v-else-if="target.logs || target.terminal" class="kp-muted">当前部署没有所属容器组</p>
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
import { Box, Clock, Connection, CopyDocument } from '@element-plus/icons-vue'
import api from '../api'
import { copyText } from '../utils/clipboard'
import { ownedPods, podContainers } from '../utils/container-targets'
import { readResourcePages } from '../utils/resource'
import { can } from '../utils/perm'
import ContainerFilesDialog from './ContainerFilesDialog.vue'
import ContainerBatchDialog from './ContainerBatchDialog.vue'

const props = defineProps({ target: { type: Object, required: true }, contextKey: String })
const emit = defineEmits(['close', 'select', 'update-image'])
const pods = ref([])
const deploymentTemplate = shallowRef(null)
const error = ref('')
const loading = ref(true)
const incomplete = ref(false)
const filesVisible = ref(false)
const fileTarget = shallowRef(null)
const batchTarget = shallowRef(null)
const downloads = shallowReactive(new Map())
let controller
let logTailLines = '2000'

const statusLabels = {
  Running: '运行中',
  Pending: '等待中',
  Succeeded: '已完成',
  Completed: '已完成',
  Failed: '失败',
  Terminating: '终止中',
  Unknown: '未知',
}

function statusLabel(status) {
  return Object.hasOwn(statusLabels, status) ? statusLabels[status] : status
}

function statusType(status) {
  if (['Running', 'Succeeded', 'Completed'].includes(status)) return 'success'
  if (['Failed', 'Error', 'OOMKilled', 'CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull'].includes(status)) return 'danger'
  return ['Pending', 'Terminating'].includes(status) ? 'warning' : 'info'
}

const groups = computed(() => pods.value.map(pod => ({
  pod,
  phase: pod.metadata.deletionTimestamp ? 'Terminating' : (pod.status?.phase || 'Unknown'),
  containers: podContainers(pod),
})))
const imageFields = { Container: 'containers', Init: 'initContainers' }
function canEditImage(container) {
  return !!container.image && !!deploymentTemplate.value?.[imageFields[container.type]]?.some(item => item.name === container.name)
}
const showTemplateImageAction = computed(() => !loading.value && !!deploymentTemplate.value
  && !groups.value.some(({ containers }) => containers.some(canEditImage)))

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
  deploymentTemplate.value = null
  try {
    const resource = await api.get(singlePod ? '' : 'apps', 'v1', singlePod ? 'pods' : 'deployments',
      namespace, name, { ...config, params: { clusterId } })
    if (request.signal.aborted) return
    if (resource?.metadata?.uid !== uid || resource.metadata.name !== name || resource.metadata.namespace !== namespace) {
      throw new Error('资源已被替换，请关闭后刷新列表')
    }
    if (singlePod) { pods.value = [resource]; return }
    if (props.target.imageUpdate && !resource.metadata.deletionTimestamp) {
      deploymentTemplate.value = resource.spec?.template?.spec || null
    }
    if (!props.target.logs && !props.target.terminal) return
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
async function copyImage(image) {
  try {
    await copyText(image)
    ElMessage.success('镜像地址已复制')
  } catch (error) {
    ElMessage.error(error.message)
  }
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
:global(.pod-picker-dialog .el-dialog__title) { font-size: 17px; font-weight: 650; }
.pod-picker-context {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  margin-bottom: 16px;
  color: var(--kp-muted);
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.pod-picker-context strong { margin-inline-start: 5px; color: var(--kp-text); font-weight: 600; }
.pod-picker-scope {
  padding: 4px 9px;
  border: 1px solid var(--kp-border);
  border-radius: 6px;
  background: var(--kp-surface-2);
}
.pod-groups { display: grid; gap: 10px; max-height: 62vh; overflow: auto; margin-top: 12px; }
.pod-group { border: 1px solid var(--kp-border); border-radius: 10px; overflow: hidden; }
.pod-summary { display: flex; align-items: center; gap: 10px; padding: 13px 16px; cursor: pointer; list-style: none; }
.pod-summary::-webkit-details-marker { display: none; }
.pod-summary::before {
  content: '';
  flex: none;
  width: 6px;
  height: 6px;
  border: solid var(--kp-muted);
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(-45deg);
}
.pod-group[open] > .pod-summary::before { transform: translateY(-2px) rotate(45deg); }
.pod-summary:hover { background: var(--kp-surface-2); }
.pod-summary:focus-visible { outline: 2px solid var(--kp-brand); outline-offset: -2px; }
.pod-icon, .pod-container-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border: 1px solid var(--kp-border);
  border-radius: 8px;
  font-size: 17px;
}
.pod-icon { color: var(--kp-brand); background: var(--kp-brand-soft); }
.pod-container-icon { color: var(--kp-muted); background: var(--kp-surface); }
.pod-summary-content { display: grid; flex: 1; gap: 2px; min-width: 0; }
.pod-name, .pod-container-heading strong {
  color: var(--kp-text);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.pod-node, .pod-container-count, .pod-container-kind { color: var(--kp-muted); font-size: 13px; line-height: 1.5; }
.pod-node { overflow-wrap: anywhere; }
.pod-container-count { white-space: nowrap; }
.pod-state { max-width: 100%; font-size: 12px; }
.pod-container-list { margin: 0; padding: 0; list-style: none; }
.pod-container-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  padding: 13px 16px 13px 32px;
  border-top: 1px solid var(--kp-border);
  background: var(--kp-surface-2);
}
.pod-container-info { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.pod-container-content { display: grid; gap: 5px; min-width: 0; }
.pod-container-heading, .pod-runtime { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 9px; }
.pod-image-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; min-width: 0; }
.pod-image-tools .el-button { margin: 0; }
.pod-template-image-action { margin-inline-start: auto; }
.pod-image {
  display: flex;
  align-items: center;
  justify-self: start;
  gap: 2px;
  max-width: 100%;
  min-width: 0;
  padding-inline-start: 8px;
  border: 1px solid var(--kp-border);
  border-radius: 6px;
  background: var(--kp-surface);
}
.pod-image code {
  min-width: 0;
  color: var(--kp-text-2);
  font: 12px/1.5 'Cascadia Mono', Consolas, ui-monospace, monospace;
  overflow-wrap: anywhere;
}
.pod-image-copy {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  color: var(--kp-text-2);
  background: transparent;
  font-size: 15px;
  cursor: pointer;
}
.pod-image-copy:hover { color: var(--kp-brand); background: var(--kp-brand-soft); }
.pod-image-copy:focus-visible { outline: 2px solid var(--kp-brand); outline-offset: -2px; }
.pod-runtime { color: var(--kp-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.pod-runtime > span:first-child { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.pod-container-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.pod-container-actions .el-button { margin: 0; }
.pod-empty { padding: 0 16px; }
@media (max-width: 950px) {
  .pod-container-row { grid-template-columns: minmax(0, 1fr); gap: 10px; padding-inline-start: 16px; }
  .pod-container-actions { justify-content: flex-start; }
}
@media (max-width: 520px) {
  .pod-summary, .pod-container-row { padding-inline: 10px; }
  .pod-container-count { display: none; }
}
</style>
