<template>
  <section class="associated-pods-section" aria-label="关联 Pod">
    <div class="associated-pods-heading">
      <h2>关联 Pod <span class="associated-pods-count" aria-live="polite">{{ loading ? '读取中' : error ? '读取失败' : loaded ? pods.length : '—' }}</span></h2>
      <el-button size="small" :loading="loading" @click="emit('refresh')">刷新</el-button>
    </div>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="associated-pods-error" />
    <el-table :key="contextKey" :data="pods" :row-key="podKey" :expand-row-keys="expandedPodKeys"
      class="associated-pod-table" size="small" border stripe v-loading="loading"
      @row-click="togglePodFromRow" @row-dblclick="openPodFromRow" @expand-change="syncPodExpansion">
      <el-table-column type="expand" width="44">
        <template #default="{ row: pod }"><PodRowDetails :pod="pod" /></template>
      </el-table-column>
      <el-table-column prop="metadata.name" label="名称" min-width="220">
        <template #default="{ row: pod }"><el-link class="associated-pod-name" type="primary" underline="never" @click.stop="emit('open-pod',pod)">{{ pod.metadata.name }}</el-link></template>
      </el-table-column>
      <el-table-column label="状态" width="130"><template #default="{ row: pod }"><el-tag disable-transitions :type="statusTag(phaseOf('Pod',pod))" size="small">{{ phaseOf('Pod',pod) }}</el-tag></template></el-table-column>
      <el-table-column prop="status.podIP" label="Pod IP" width="140" />
      <el-table-column prop="spec.nodeName" label="节点" width="160" />
      <el-table-column label="创建时间" width="110"><template #default="{ row: pod }">{{ ago(pod.metadata.creationTimestamp) }}</template></el-table-column>
      <el-table-column label="操作" width="112" align="center">
        <template #default="{ row: pod }">
          <div class="associated-pod-actions" @click.stop @dblclick.stop>
            <PodQuickActions :key="`${contextKey}/${podKey(pod)}`" :pod="pod" :cluster-id="clusterId" :context-key="contextKey" />
          </div>
        </template>
      </el-table-column>
      <template #empty>
        <div class="kp-empty">{{ error ? '关联 Pod 读取失败，请点击刷新重试' : '当前资源没有关联 Pod' }}</div>
      </template>
    </el-table>
  </section>
</template>
<script setup>
import { ref, watch } from 'vue'
import { statusTag } from '../config/resources'
import { phaseOf, ago } from '../config/columns'
import PodRowDetails from './PodRowDetails.vue'
import PodQuickActions from './PodQuickActions.vue'

const props = defineProps({
  pods: { type: Array, default: () => [] },
  loading: Boolean,
  loaded: Boolean,
  error: String,
  clusterId: String,
  contextKey: String,
})
const emit = defineEmits(['open-pod', 'refresh'])
const expandedPodKeys = ref([])

function podKey(pod) {
  return pod.metadata?.uid || `${pod.metadata?.namespace || ''}/${pod.metadata?.name || ''}`
}
function interactive(column, event) {
  return column?.type === 'expand' || event?.target?.closest?.(
    'a,button,input,select,textarea,label,[role="button"],[role="link"],.el-dropdown,.el-popover,.el-table__expanded-cell',
  )
}
function togglePodFromRow(pod, column, event) {
  if (interactive(column, event)) return
  const key = podKey(pod)
  expandedPodKeys.value = expandedPodKeys.value.includes(key)
    ? expandedPodKeys.value.filter(value => value !== key)
    : [...expandedPodKeys.value, key]
}
function openPodFromRow(pod, column, event) {
  if (!interactive(column, event)) emit('open-pod', pod)
}
function syncPodExpansion(_pod, rows) {
  if (Array.isArray(rows)) expandedPodKeys.value = rows.map(podKey)
}
watch(() => props.contextKey, () => { expandedPodKeys.value = [] }, { flush: 'sync' })
watch(() => props.pods.map(podKey), keys => {
  expandedPodKeys.value = expandedPodKeys.value.filter(key => keys.includes(key))
}, { flush: 'sync' })
</script>
<style scoped>
.associated-pods-section { min-width: 0; padding: 16px 18px; background: var(--kp-surface); border: 1px solid var(--kp-border); border-radius: var(--kp-r); }
.associated-pods-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.associated-pods-heading h2 { display: flex; align-items: center; gap: 9px; margin: 0; font-size: 15px; line-height: 1.5; font-weight: 600; }
.associated-pods-count { padding: 1px 8px; border-radius: 5px; background: var(--kp-surface-2); color: var(--kp-text-2); font-size: 13px; font-weight: 400; font-variant-numeric: tabular-nums; }
.associated-pods-error { margin-bottom: 12px; }
.associated-pod-name { overflow-wrap: anywhere; }
.associated-pod-table :deep(.el-table__expanded-cell) { padding: 0; }
.associated-pod-table :deep(.el-table__row) { cursor: pointer; }
@media (max-width: 760px) {
  .associated-pods-section { padding: 14px 12px; }
  .associated-pods-heading h2 { font-size: 14px; }
}
</style>
