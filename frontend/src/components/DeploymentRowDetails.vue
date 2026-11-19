<template>
  <div class="deployment-row-details" :aria-label="`${resource.metadata?.name || '部署'}的副本状态与条件`">
    <section class="deployment-detail-card">
      <div class="deployment-detail-heading">
        <h3>副本概览</h3>
        <span>{{ desired === 0 ? '已缩容至 0' : `${ready} / ${desired} 就绪` }}</span>
      </div>
      <dl class="deployment-replica-counts">
        <div><dt>期望</dt><dd>{{ desired }}</dd></div>
        <div><dt>就绪</dt><dd>{{ ready }}</dd></div>
        <div><dt>可用</dt><dd>{{ resource.status?.availableReplicas ?? 0 }}</dd></div>
        <div><dt>已更新</dt><dd>{{ resource.status?.updatedReplicas ?? 0 }}</dd></div>
      </dl>
      <div class="deployment-readiness" v-if="desired > 0">
        <span>就绪进度</span>
        <el-progress :percentage="readiness" :show-text="false" :stroke-width="7"
          :status="readiness === 100 ? 'success' : undefined" aria-label="就绪进度" />
        <span>{{ readiness }}%</span>
      </div>
    </section>

    <section class="deployment-detail-card">
      <div class="deployment-detail-heading"><h3>部署条件</h3><span>Conditions</span></div>
      <table v-if="conditions.length" class="deployment-condition-table" :aria-label="`${resource.metadata?.name} 的部署条件`">
        <thead>
          <tr><th scope="col">类型</th><th scope="col">状态</th><th scope="col">原因</th><th scope="col">说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="(condition, index) in conditions" :key="`${condition.type}-${index}`">
            <th scope="row">{{ condition.type || '—' }}</th>
            <td><el-tag :type="conditionType(condition)" size="small" effect="light" disable-transitions>{{ condition.status || 'Unknown' }}</el-tag></td>
            <td>{{ condition.reason || '—' }}</td>
            <td class="deployment-condition-message">{{ condition.message || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="deployment-condition-empty">尚无条件状态</p>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({ resource: { type: Object, required: true } })
const desired = computed(() => props.resource.spec?.replicas ?? 1)
const ready = computed(() => props.resource.status?.readyReplicas ?? 0)
const readiness = computed(() => desired.value ? Math.min(100, Math.round(ready.value / desired.value * 100)) : 0)
const conditions = computed(() => props.resource.status?.conditions || [])

function conditionType(condition) {
  if (condition.status === 'True') return condition.type === 'ReplicaFailure' ? 'danger' : 'success'
  return condition.status === 'False' ? 'warning' : 'info'
}
</script>

<style scoped>
.deployment-row-details {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  gap: 12px;
  padding: 14px;
  background: var(--kp-surface-2);
}
.deployment-detail-card {
  min-width: 0;
  padding: 14px;
  overflow: hidden;
  border: 1px solid var(--kp-border);
  border-radius: 8px;
  background: var(--kp-surface);
}
.deployment-detail-heading, .deployment-readiness {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: var(--kp-muted);
}
.deployment-detail-heading { margin-bottom: 12px; }
.deployment-detail-heading h3 { margin: 0; color: var(--kp-text); font-size: 14px; }
.deployment-replica-counts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0 0 16px; }
.deployment-replica-counts div { padding-inline-start: 9px; border-inline-start: 2px solid var(--kp-border); }
.deployment-replica-counts dt { color: var(--kp-muted); font-size: 12px; }
.deployment-replica-counts dd { margin: 2px 0 0; color: var(--kp-text); font-size: 20px; font-weight: 600; }
.deployment-readiness .el-progress { flex: 1; min-width: 0; }
.deployment-condition-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.deployment-condition-table th, .deployment-condition-table td {
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
  border-block-end: 1px solid var(--kp-border);
}
.deployment-condition-table thead th { background: var(--kp-surface-2); color: var(--kp-text-2); font-weight: 500; }
.deployment-condition-table tbody th { font-weight: 500; }
.deployment-condition-table tbody tr:last-child > * { border: 0; }
.deployment-condition-message { white-space: pre-wrap; }
.deployment-condition-empty { margin: 0; color: var(--kp-muted); }
@media (max-width: 1150px) {
  .deployment-row-details { grid-template-columns: minmax(0, 1fr); }
}
</style>
