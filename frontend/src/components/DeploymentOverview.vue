<template>
  <div class="deployment-overview">
    <section class="overview-card rollout-summary" aria-labelledby="deployment-rollout-heading">
      <div class="rollout-progress">
        <div class="overview-heading">
          <h2 id="deployment-rollout-heading">发布进度</h2>
          <el-tag :type="rolloutState.type" size="small" effect="light" disable-transitions>{{ rolloutState.label }}</el-tag>
        </div>
        <div v-if="desired > 0" class="progress-track">
          <el-progress :percentage="progress" :show-text="false" :stroke-width="8"
            :status="progressStyle" aria-label="副本更新进度" />
          <span class="progress-ratio">{{ updated }} / {{ desired }}</span>
        </div>
      </div>
      <dl class="replica-metrics">
        <div><dt>期望</dt><dd>{{ desired }}</dd></div>
        <div><dt>就绪</dt><dd>{{ ready }}</dd></div>
        <div><dt>可用</dt><dd>{{ available }}</dd></div>
        <div><dt>已更新</dt><dd>{{ updated }}</dd></div>
        <div><dt>不可用</dt><dd :class="{ 'metric-warning': unavailable > 0 }">{{ unavailable }}</dd></div>
      </dl>
    </section>

    <div class="overview-grid">
      <section class="overview-card" aria-labelledby="deployment-metadata-heading">
        <div class="overview-heading"><h2 id="deployment-metadata-heading">基本信息</h2></div>
        <dl class="deployment-fields">
          <div><dt>集群</dt><dd>{{ clusterName }}</dd></div>
          <div><dt>命名空间</dt><dd>{{ resource.metadata.namespace }}</dd></div>
          <div><dt>创建时间</dt><dd>{{ fmtTime(resource.metadata.creationTimestamp) }}</dd></div>
          <div><dt>API 版本</dt><dd>{{ resource.apiVersion }}</dd></div>
        </dl>
        <details class="metadata-details">
          <summary>更多信息</summary>
          <dl class="deployment-fields metadata-identifiers">
            <div><dt>UID</dt><dd>{{ resource.metadata.uid }}</dd></div>
            <div><dt>资源版本</dt><dd>{{ resource.metadata.resourceVersion }}</dd></div>
          </dl>
          <div v-if="Object.keys(resource.metadata.labels || {}).length" class="extra-metadata">
            <h3>标签</h3>
            <div class="deployment-labels">
              <el-tag v-for="(value, key) in resource.metadata.labels" :key="key" size="small" effect="plain">
                {{ key }}={{ value }}
              </el-tag>
            </div>
          </div>
          <div v-if="Object.keys(resource.metadata.annotations || {}).length" class="extra-metadata">
            <h3>注解</h3>
            <dl class="deployment-annotations">
              <div v-for="(value, key) in resource.metadata.annotations" :key="key">
                <dt>{{ key }}</dt><dd>{{ value }}</dd>
              </div>
            </dl>
          </div>
        </details>
      </section>

      <section class="overview-card" aria-labelledby="deployment-events-heading">
        <div class="overview-heading">
          <h2 id="deployment-events-heading">近期事件</h2>
          <el-button v-if="events.length" link type="primary" @click="emit('show-events')">查看全部</el-button>
        </div>
        <p v-if="eventsLoading" class="overview-empty" role="status">正在读取事件…</p>
        <p v-else-if="eventsError" class="overview-empty" role="status">{{ eventsError }}</p>
        <ul v-else-if="events.length" class="recent-events">
          <li v-for="(event, index) in events.slice(0, 3)" :key="event.metadata?.uid || index">
            <div class="recent-event-heading">
              <span :class="{ 'event-warning': event.type === 'Warning' }">{{ event.reason || event.type || '事件' }}</span>
              <time>{{ ago(event.lastTimestamp || event.eventTime || event.metadata?.creationTimestamp) }}</time>
            </div>
            <p>{{ event.message }}</p>
          </li>
        </ul>
        <p v-else class="overview-empty">暂无事件</p>
      </section>
    </div>

    <details v-if="conditions.length" class="overview-card deployment-conditions">
      <summary>部署条件 <span>{{ conditions.length }} 项</span></summary>
      <el-table :data="conditions" size="small" class="conditions-table">
        <el-table-column prop="type" label="类型" min-width="120" />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="conditionStyle(row)" size="small" effect="light">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="原因" min-width="150" />
        <el-table-column prop="message" label="说明" min-width="210" show-overflow-tooltip />
        <el-table-column label="变更时间" min-width="155">
          <template #default="{ row }">{{ fmtTime(row.lastTransitionTime) }}</template>
        </el-table-column>
      </el-table>
    </details>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ago, fmtTime } from '../config/columns'

const props = defineProps({
  resource: { type: Object, required: true },
  clusterName: String,
  events: { type: Array, required: true },
  eventsLoading: Boolean,
  eventsError: String,
})
const emit = defineEmits(['show-events'])
const status = computed(() => props.resource.status || {})
const desired = computed(() => props.resource.spec?.replicas ?? 1)
const ready = computed(() => status.value.readyReplicas ?? 0)
const available = computed(() => status.value.availableReplicas ?? 0)
const updated = computed(() => status.value.updatedReplicas ?? 0)
const unavailable = computed(() => status.value.unavailableReplicas ?? Math.max(0, desired.value - available.value))
const conditions = computed(() => status.value.conditions || [])
const progress = computed(() => desired.value > 0 ? Math.min(100, Math.round(updated.value / desired.value * 100)) : 0)

const rolloutState = computed(() => {
  if (props.resource.metadata.deletionTimestamp) return { label: '正在删除', type: 'warning' }
  if (props.resource.spec?.paused) return { label: '已暂停', type: 'warning' }
  if ((status.value.observedGeneration ?? 0) < (props.resource.metadata.generation ?? 0)) {
    return { label: '等待控制器同步', type: 'info' }
  }
  if (conditions.value.some(condition => condition.type === 'Progressing' && condition.status === 'False' && condition.reason === 'ProgressDeadlineExceeded')) {
    return { label: '发布超时', type: 'danger' }
  }
  const allUpdated = updated.value === desired.value && (status.value.replicas ?? 0) === desired.value
  if (allUpdated && available.value === desired.value) {
    return desired.value === 0 ? { label: '已缩容', type: 'info' } : { label: '已完成', type: 'success' }
  }
  return desired.value === 0 ? { label: '缩容中', type: 'primary' } : { label: '发布中', type: 'primary' }
})
const progressStyle = computed(() => {
  if (rolloutState.value.type === 'danger') return 'exception'
  return ['success', 'warning'].includes(rolloutState.value.type) ? rolloutState.value.type : undefined
})

function conditionStyle(condition) {
  if (condition.type === 'ReplicaFailure' && condition.status === 'True') return 'danger'
  if (condition.status === 'True') return 'success'
  return condition.status === 'False' ? 'warning' : 'info'
}
</script>

<style scoped>
.deployment-overview { display: grid; min-width: 0; gap: 14px; font-size: 14px; }
.overview-card {
  min-width: 0;
  padding: 18px 20px;
  border: 1px solid var(--kp-border);
  border-radius: var(--kp-r);
  background: var(--kp-surface);
}
.overview-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap; }
.overview-heading h2 { margin: 0; color: var(--kp-text); font-size: 15px; font-weight: 650; }
.rollout-summary {
  display: grid;
  grid-template-columns: minmax(185px, .8fr) minmax(0, 1.6fr);
  gap: 14px 24px;
  align-items: center;
}
.progress-track { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.progress-track .el-progress { flex: 1; min-width: 0; }
.progress-ratio { color: var(--kp-muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.replica-metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin: 0; }
.replica-metrics > div { padding-inline-start: 14px; border-inline-start: 1px solid var(--kp-border); }
.replica-metrics dt, .deployment-fields dt { color: var(--kp-muted); font-size: 13px; line-height: 1.45; }
.replica-metrics dd { margin: 3px 0 0; color: var(--kp-text); font-size: 21px; font-weight: 600; font-variant-numeric: tabular-nums; }
.replica-metrics .metric-warning, .event-warning { color: #984b13; }
.overview-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
.deployment-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin: 16px 0 0; }
.deployment-fields dd { margin: 4px 0 0; color: var(--kp-text); font-weight: 500; overflow-wrap: anywhere; }
.metadata-details { margin-top: 16px; }
.metadata-details summary, .deployment-conditions summary { cursor: pointer; color: var(--kp-text-2); font-weight: 600; }
.metadata-details summary { color: var(--kp-brand); font-size: 13px; }
.metadata-details summary:focus-visible, .deployment-conditions summary:focus-visible { outline: 2px solid var(--kp-brand); outline-offset: 4px; }
.metadata-identifiers { grid-template-columns: minmax(0, 1fr); gap: 12px; }
.extra-metadata { margin-top: 14px; }
.extra-metadata h3 { margin: 0 0 8px; color: var(--kp-text); font-size: 13px; font-weight: 600; }
.deployment-labels { display: flex; flex-wrap: wrap; gap: 6px; }
.deployment-labels .el-tag { max-width: 100%; height: auto; min-height: 24px; white-space: normal; overflow-wrap: anywhere; }
.deployment-annotations { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.deployment-annotations > div + div { margin-top: 8px; }
.deployment-annotations dt { color: var(--kp-muted); }
.deployment-annotations dd { margin: 2px 0 0; white-space: pre-wrap; }
.recent-events { margin: 2px 0 0; padding: 0; list-style: none; }
.recent-events li { padding: 9px 0; }
.recent-events li + li { border-top: 1px solid var(--kp-border); }
.recent-events li:last-child { padding-bottom: 0; }
.recent-event-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-weight: 600; overflow-wrap: anywhere; }
.recent-event-heading time { flex: none; color: var(--kp-muted); font-size: 12px; font-weight: 400; }
.recent-events p {
  display: -webkit-box;
  overflow: hidden;
  margin: 3px 0 0;
  color: var(--kp-muted);
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.overview-empty { margin: 14px 0 0; color: var(--kp-muted); font-size: 13px; }
.deployment-conditions summary span { margin-inline-start: 5px; color: var(--kp-muted); font-size: 12px; font-weight: 400; }
.conditions-table { margin-top: 12px; }
@media (max-width: 1000px) {
  .rollout-summary { grid-template-columns: 1fr; }
  .replica-metrics > div:first-child { padding-inline-start: 0; border-inline-start: 0; }
}
@media (max-width: 800px) {
  .overview-grid { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
  .overview-card { padding: 14px; }
  .replica-metrics > div { padding-inline-start: 6px; }
  .replica-metrics dd { font-size: 18px; }
  .replica-metrics dt { font-size: 12px; }
}
</style>
