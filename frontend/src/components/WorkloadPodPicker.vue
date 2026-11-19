<template>
  <el-dialog :model-value="true" :title="target.logs&&target.terminal ? '容器日志与终端' : target.logs ? '容器日志' : '容器终端'"
    width="min(900px, 94vw)" top="10vh" append-to-body :close-on-click-modal="false"
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
              <el-tag :type="container.running ? 'success' : 'info'" size="small" effect="light">{{ container.state }}</el-tag>
              <div class="pod-container-actions">
                <el-button v-if="target.logs" size="small" plain type="primary" :aria-label="`查看 ${pod.metadata.name} / ${container.name} 的日志`" @click="select('logs', pod, container)">查看日志</el-button>
                <el-button v-if="target.terminal" size="small" plain type="primary" :aria-label="`打开 ${pod.metadata.name} / ${container.name} 的终端`"
                  :disabled="!container.running||!!pod.metadata.deletionTimestamp" @click="select('terminal', pod, container)">打开终端</el-button>
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
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import api from '../api'
import { ownedPods, podContainers } from '../utils/container-targets'
import { readResourcePages } from '../utils/resource'

const props = defineProps({ target: { type: Object, required: true }, contextKey: String })
const emit = defineEmits(['close', 'select'])
const pods = ref([])
const error = ref('')
const loading = ref(true)
const incomplete = ref(false)
let controller

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

function select(mode, pod, container) {
  if (loading.value) return
  if (mode === 'logs' ? !props.target.logs : !props.target.terminal || !container.running || pod.metadata.deletionTimestamp) return
  const { uid, name, namespace } = pod.metadata
  emit('select', { mode, uid, name, namespace, container: container.name })
}

watch(() => props.contextKey, () => emit('close'))
onMounted(load)
onUnmounted(() => controller?.abort())
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
.pod-container-row>.el-tag{justify-self:start}
.pod-container-actions{display:flex;flex-wrap:wrap;gap:6px}
.pod-container-actions .el-button{margin:0}
.pod-empty{padding:0 16px}
@media(max-width:620px){.pod-container-row{grid-template-columns:minmax(0,1fr) auto;padding-left:16px}.pod-container-actions{grid-column:1/-1}}
</style>
