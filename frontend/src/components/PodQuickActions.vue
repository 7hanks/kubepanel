<template>
  <el-popover v-if="actionLabel" ref="popover" v-model:visible="visible" trigger="click" placement="bottom-end"
    width="min(600px, calc(100vw - 28px))" popper-class="kp-pod-quick-popover" :persistent="false"
    @after-enter="panel?.focus({ preventScroll: true })">
    <template #reference>
      <ResourceActionButton ref="triggerButton" class="pod-quick-trigger" aria-haspopup="dialog" :aria-expanded="visible" @click.stop>
        {{ actionLabel }}
      </ResourceActionButton>
    </template>
    <section ref="panel" class="pod-quick-panel" role="dialog" :aria-label="`${pod.metadata.name} 的容器快捷操作`"
      tabindex="-1" @keydown.esc.stop="closeAndFocus">
      <header class="pod-quick-header">
        <el-icon aria-hidden="true"><Box /></el-icon>
        <div><strong>{{ pod.metadata.name }}</strong><span>{{ pod.metadata.namespace }}</span></div>
        <el-button text circle size="small" :icon="Close" aria-label="关闭容器快捷操作" @click="closeAndFocus" />
      </header>
      <p v-if="loading" class="pod-quick-message" role="status">正在读取容器…</p>
      <p v-else-if="error" class="pod-quick-message" role="alert">{{ error }}</p>
      <ul v-else-if="containers.length" class="pod-quick-containers">
        <li v-for="container in containers" :key="container.key">
          <div class="pod-quick-container-heading">
            <strong>{{ container.name }}</strong>
            <span v-if="container.type==='Init'">初始化</span>
            <span v-else-if="container.type==='Ephemeral'">临时容器</span>
            <el-tag :type="container.running ? 'success' : 'info'" size="small" effect="light">
              {{ container.running ? '运行中' : container.state }}
            </el-tag>
          </div>
          <code v-if="container.image" class="pod-quick-image">{{ container.image }}</code>
          <div class="pod-quick-buttons">
            <el-button v-if="canFiles" size="small" color="#147564" plain :disabled="!running(container)"
              :icon="FolderOpened" @click="openFiles(container)">文件浏览器</el-button>
            <el-button v-if="canTerminal" size="small" color="#a35412" plain :disabled="!running(container) || !container.startedAt"
              @click="openBatch(container)">批量执行</el-button>
            <el-button v-if="canLogs" size="small" color="#6d40b7" plain :icon="Download" :loading="downloads.has(container.key)"
              @click="downloadLogs(container, clusterId)">下载日志</el-button>
            <el-button v-if="canLogs" size="small" type="primary" plain :icon="Document"
              @click="openPodView('logs', container)">追踪日志</el-button>
            <el-dropdown v-if="canTerminal" split-button size="small" type="primary" :disabled="!running(container)"
              @click="openPodView('terminal', container, '/bin/sh')" @command="shell => openPodView('terminal', container, shell)">
              终端
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="/bin/sh">sh</el-dropdown-item>
                  <el-dropdown-item command="/bin/bash">bash</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </li>
      </ul>
      <p v-else class="pod-quick-message">该 Pod 没有可操作的容器</p>
    </section>
  </el-popover>
  <ContainerFilesDialog v-if="fileTarget" :model-value="filesVisible" :target="fileTarget" append-to-body
    @update:model-value="value => { if (!value) { filesVisible = false; fileTarget = null } }" />
  <ContainerBatchDialog v-if="batch" :workload="batch.workload" :entries="batch.entries"
    :initial-key="batch.key" @close="batch = null" />
</template>

<script setup>
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Box, Close, Document, Download, FolderOpened } from '@element-plus/icons-vue'
import api from '../api'
import { store } from '../store'
import { can, canResource } from '../utils/perm'
import { podContainers } from '../utils/container-targets'
import { useContainerLogDownload } from '../utils/container-log-download'
import ResourceActionButton from './ResourceActionButton.vue'
import ContainerFilesDialog from './ContainerFilesDialog.vue'
import ContainerBatchDialog from './ContainerBatchDialog.vue'

const props = defineProps({
  pod: { type: Object, required: true },
  clusterId: { type: String, required: true },
  contextKey: String,
})
const router = useRouter()
const podMeta = { group: '', plural: 'pods', namespaced: true }
const visible = ref(false)
const popover = ref(null)
const panel = ref(null)
const triggerButton = ref(null)
const loading = ref(false)
const error = ref('')
const freshPod = shallowRef(null)
const fileTarget = shallowRef(null)
const filesVisible = ref(false)
const batch = shallowRef(null)
let controller

const identity = computed(() => {
  const { namespace, name, uid } = props.pod.metadata || {}
  return { namespace, name, uid, clusterId: props.clusterId, kind: 'Pod' }
})
function allowed(permission) {
  const { clusterId, namespace, name, uid } = identity.value
  return !!(clusterId && clusterId === store.currentClusterId && namespace && name && uid && can(permission)
    && canResource(podMeta, 'detail', namespace, clusterId))
}
const canFiles = computed(() => allowed('pod:files:read'))
const canLogs = computed(() => allowed('pod:logs'))
const canTerminal = computed(() => allowed('pod:exec'))
const actionLabel = computed(() => {
  if (canLogs.value && canTerminal.value) return '日志 / 终端'
  if (canLogs.value) return '日志'
  if (canTerminal.value) return '终端'
  return canFiles.value ? '文件浏览器' : ''
})
const containers = computed(() => freshPod.value ? podContainers(freshPod.value) : [])
const { downloads, downloadLogs } = useContainerLogDownload((container, clusterId) =>
  allowed('pod:logs') && clusterId === props.clusterId && identity.value.uid === container.uid)

async function load() {
  const request = new AbortController()
  controller = request
  const { clusterId, namespace, name, uid } = identity.value
  loading.value = true
  error.value = ''
  try {
    const pod = await api.get('', 'v1', 'pods', namespace, name, { signal: request.signal, params: { clusterId }, silent: true })
    if (request.signal.aborted) return
    if (pod?.metadata?.uid !== uid || pod.metadata.namespace !== namespace || pod.metadata.name !== name) {
      error.value = 'Pod 已被替换，请刷新列表后重新选择'
      return
    }
    freshPod.value = pod
  } catch (cause) {
    if (!request.signal.aborted) error.value = cause.message || '无法读取容器'
  } finally {
    if (controller === request) loading.value = false
  }
}
function running(container) {
  return container.running && !freshPod.value?.metadata?.deletionTimestamp
}
function closeAndFocus() {
  visible.value = false
  triggerButton.value?.$el?.focus({ preventScroll: true })
}
async function openFiles(container) {
  if (!allowed('pod:files:read') || !running(container)) return
  const selected = { namespace: container.namespace, pod: container.pod, uid: container.uid,
    container: container.name, startedAt: container.startedAt, clusterId: props.clusterId }
  fileTarget.value = selected
  visible.value = false
  await nextTick()
  if (fileTarget.value === selected) filesVisible.value = true
}
function openBatch(container) {
  if (!allowed('pod:exec') || !running(container) || !container.startedAt) return
  batch.value = { workload: identity.value, key: container.key, entries: containers.value.filter(item => running(item) && item.startedAt) }
  visible.value = false
}
function openPodView(mode, container, shell) {
  if (mode === 'terminal') {
    if (!allowed('pod:exec') || !running(container) || !['/bin/sh', '/bin/bash'].includes(shell)) return
  } else if (!allowed('pod:logs')) return
  const { clusterId, namespace, name, uid } = identity.value
  visible.value = false
  return router.push({
    name: mode === 'terminal' ? 'pod-terminal' : 'pod-logs',
    params: { clusterId, namespace, name },
    query: { uid, container: container.name, ...(shell ? { shell } : {}) },
  })
}

watch(visible, open => {
  controller?.abort()
  freshPod.value = null
  if (open) load()
})
watch(loading, () => {
  if (visible.value) popover.value?.popperRef?.popperInstanceRef?.update()
}, { flush: 'post' })
watch(() => [props.contextKey, props.clusterId, identity.value.uid], () => {
  controller?.abort()
  visible.value = false
  filesVisible.value = false
  fileTarget.value = null
  batch.value = null
})
onUnmounted(() => controller?.abort())
</script>

<style scoped>
.pod-quick-trigger.kp-resource-action { inline-size: 80px; }
.pod-quick-panel { outline: none; min-width: 0; text-align: left; }
.pod-quick-header { display: flex; align-items: center; gap: 10px; padding: 3px 2px 12px; border-bottom: 1px solid var(--kp-border); }
.pod-quick-header > .el-icon { color: var(--kp-brand); font-size: 17px; }
.pod-quick-header > div { display: grid; gap: 2px; flex: 1; min-width: 0; }
.pod-quick-header strong, .pod-quick-container-heading strong { color: var(--kp-text); font-size: 14px; font-weight: 650; overflow-wrap: anywhere; }
.pod-quick-header span, .pod-quick-container-heading > span:not(.el-tag) { color: var(--kp-muted); font-size: 12px; }
.pod-quick-containers { max-height: min(54vh, 440px); overflow-y: auto; margin: 0; padding: 0; list-style: none; }
.pod-quick-containers > li { padding: 11px 2px; }
.pod-quick-containers > li + li { border-top: 1px solid var(--kp-border); }
.pod-quick-containers > li:last-child { padding-bottom: 2px; }
.pod-quick-container-heading, .pod-quick-buttons { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
.pod-quick-image { display: block; margin-top: 4px; font: 12px/1.5 'Cascadia Mono', Consolas, ui-monospace, monospace; color: var(--kp-muted); overflow-wrap: anywhere; }
.pod-quick-buttons { margin-top: 9px; }
.pod-quick-buttons .el-button { margin: 0; }
.pod-quick-message { margin: 10px 2px 4px; color: var(--kp-muted); }
</style>
