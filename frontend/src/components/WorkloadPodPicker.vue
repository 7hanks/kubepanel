<template>
  <el-dialog :model-value="true" :title="terminal ? '选择终端容器' : '选择日志容器'"
    width="min(560px, 94vw)" append-to-body :close-on-click-modal="false"
    @update:model-value="open => { if (!open) emit('close') }">
    <p class="pod-picker-context">{{ target.namespace }} / {{ target.name }}</p>
    <p v-if="loading" class="kp-muted" role="status">正在读取部署的容器组…</p>
    <el-alert v-else-if="error" :title="error" type="error" show-icon :closable="false" />
    <template v-else>
      <el-alert v-if="incomplete" title="仅加载了部分容器组，可在容器组列表中继续查找" type="warning" :closable="false" />
      <el-form v-if="pods.length" label-position="top">
        <el-form-item label="容器组">
          <el-select v-model="podUid" aria-label="容器组" filterable style="width:100%">
            <el-option v-for="pod in pods" :key="pod.metadata.uid" :value="pod.metadata.uid"
              :label="`${pod.metadata.name} · ${pod.status?.phase || 'Unknown'}`" />
          </el-select>
        </el-form-item>
        <el-form-item label="容器">
          <el-select v-model="containerName" aria-label="容器" filterable style="width:100%">
            <el-option v-for="container in containers" :key="container.key" :value="container.name"
              :label="`${container.name} · ${container.state}`" />
          </el-select>
        </el-form-item>
      </el-form>
      <p v-else class="kp-muted">{{ terminal ? '当前部署没有运行中的容器' : '当前部署没有所属容器组' }}</p>
    </template>
    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button v-if="error || !loading && !pods.length" @click="load">重新读取</el-button>
      <el-button type="primary" :disabled="loading || !!error || !containerName" @click="select">
        {{ terminal ? '打开终端' : '查看日志' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import api from '../api'
import { ownedPods, podContainers } from '../utils/container-targets'
import { readResourcePages } from '../utils/resource'

const props = defineProps({ target: { type: Object, required: true }, terminal: Boolean, contextKey: String })
const emit = defineEmits(['close', 'select'])
const pods = ref([])
const podUid = ref('')
const containerName = ref('')
const error = ref('')
const loading = ref(true)
const incomplete = ref(false)
let controller

const selectedPod = computed(() => pods.value.find(pod => pod.metadata.uid === podUid.value))
const containers = computed(() => podContainers(selectedPod.value || {}).filter(container => !props.terminal || container.running))

async function load() {
  controller?.abort()
  const request = new AbortController()
  controller = request
  const { clusterId, namespace, name, uid } = props.target
  const config = { signal: request.signal, silent: true }
  loading.value = true
  error.value = ''
  incomplete.value = false
  pods.value = []
  podUid.value = ''
  try {
    const deployment = await api.get('apps', 'v1', 'deployments', namespace, name, { ...config, params: { clusterId } })
    if (request.signal.aborted) return
    if (deployment.metadata?.uid !== uid || deployment.metadata.name !== name || deployment.metadata.namespace !== namespace) {
      throw new Error('部署已被替换，请关闭后刷新列表')
    }
    const list = (group, plural) => readResourcePages(cursor => api.list(group, 'v1', plural,
      { clusterId, namespace, limit: 200, continue: cursor }, config), request.signal)
    const [related, replicas] = await Promise.all([list('', 'pods'), list('apps', 'replicasets')])
    if (request.signal.aborted) return
    incomplete.value = related.incomplete || replicas.incomplete
    pods.value = ownedPods(deployment, related.items, replicas.items)
      .filter(pod => pod.metadata?.uid && pod.metadata.name)
      .filter(pod => !props.terminal || !pod.metadata.deletionTimestamp && podContainers(pod).some(container => container.running))
      .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
    podUid.value = pods.value[0]?.metadata.uid || ''
  } catch (cause) {
    if (request.signal.aborted) return
    error.value = cause.message || '无法读取所属容器组'
    request.abort()
  } finally {
    if (controller === request) loading.value = false
  }
}

watch(podUid, () => {
  const first = containers.value.find(container => container.type === 'Container') || containers.value[0]
  containerName.value = first?.name || ''
})
function select() {
  if (loading.value || !selectedPod.value || !containers.value.some(container => container.name === containerName.value)) return
  const { uid, name, namespace } = selectedPod.value.metadata
  emit('select', { uid, name, namespace, container: containerName.value })
}

watch(() => props.contextKey, () => emit('close'))
onMounted(load)
onUnmounted(() => controller?.abort())
</script>

<style scoped>
.pod-picker-context{margin:0 0 16px;color:var(--kp-text-2);font-weight:600;overflow-wrap:anywhere}
.el-form{margin-top:16px}
</style>
