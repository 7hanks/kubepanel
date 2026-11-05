<template>
  <div v-loading="loading">
    <div class="kp-stat-grid">
      <div class="kp-stat clickable" @click="jump('nodes')">
        <div class="label">节点</div><div class="value">{{ stat.nodes || 0 }}</div>
        <el-icon class="icon"><Monitor /></el-icon>
      </div>
      <div class="kp-stat clickable" @click="jump('namespaces')">
        <div class="label">命名空间</div><div class="value">{{ stat.namespaces || 0 }}</div>
        <el-icon class="icon"><Collection /></el-icon>
      </div>
      <div class="kp-stat clickable" @click="jump('pods')">
        <div class="label">Pod</div><div class="value">{{ stat.pods || 0 }}</div>
        <el-icon class="icon"><Box /></el-icon>
      </div>
      <div class="kp-stat clickable" @click="jump('deployments')">
        <div class="label">Deployment</div><div class="value">{{ stat.deployments || 0 }}</div>
        <el-icon class="icon"><Grid /></el-icon>
      </div>
      <div class="kp-stat clickable" @click="jump('services')">
        <div class="label">Service</div><div class="value">{{ stat.services || 0 }}</div>
        <el-icon class="icon"><Connection /></el-icon>
      </div>
      <div class="kp-stat">
        <div class="label">异常 Pod</div>
        <div class="value" :class="stat.unhealthyPods ? 'kp-danger' : 'kp-ok'">{{ stat.unhealthyPods || 0 }}</div>
        <el-icon class="icon"><Warning /></el-icon>
      </div>
    </div>

    <div v-if="activeNs" class="kp-muted" style="margin:-4px 0 14px;font-size:12.5px">
      当前只统计命名空间 <el-tag size="small" type="info" effect="plain">{{ activeNs }}</el-tag> 的 Pod / Deployment / Service / 事件
      <el-button link type="primary" size="small" @click="store.setNamespace('all')">查看全部命名空间</el-button>
    </div>

    <el-row :gutter="16">
      <el-col :xs="24" :lg="14">
        <div class="kp-card" style="margin-bottom:16px">
          <div class="kp-section-title">节点状态</div>
          <el-table :data="data.nodes || []" size="small" border stripe @row-click="row => goNode(row)">
            <el-table-column prop="name" label="节点" min-width="110" show-overflow-tooltip />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.ready ? 'success' : 'danger'" size="small">{{ row.ready ? 'Ready' : 'NotReady' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="可调度" width="85">
              <template #default="{ row }">
                <el-tag :type="row.unschedulable ? 'warning' : 'info'" size="small">{{ row.unschedulable ? '已封锁' : '是' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="version" label="Kubelet" width="100" />
            <el-table-column prop="cpu" label="CPU" width="85" />
            <el-table-column prop="memory" label="内存" width="95" />
            <el-table-column prop="pods" label="Pod" width="60" />
            <el-table-column prop="age" label="运行时间" width="95" />
          </el-table>
          <div v-if="!data.metricsAvailable" class="kp-muted" style="margin-top:10px;font-size:12px">
            未检测到 metrics-server，CPU / 内存用量显示为容量配额。安装 metrics-server 后自动显示实时用量。
          </div>
        </div>

        <div class="kp-card">
          <div class="kp-section-title">近期事件
            <el-button link type="primary" size="small" @click="jump('events')">查看全部</el-button>
          </div>
          <el-table :data="data.events || []" size="small" border stripe max-height="330">
            <el-table-column label="类型" width="80">
              <template #default="{ row }">
                <el-tag :type="row.type === 'Warning' ? 'warning' : 'success'" size="small">{{ row.type }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="命名空间" width="145" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.namespace && row.namespace !== '-'" class="ns-link" @click.stop="pickNamespace(row.namespace)">{{ row.namespace }}</span>
                <span v-else class="kp-muted">-</span>
              </template>
            </el-table-column>
            <el-table-column prop="reason" label="原因" width="100" show-overflow-tooltip />
            <el-table-column prop="object" label="对象" width="115" show-overflow-tooltip />
            <el-table-column prop="message" label="消息" min-width="150" show-overflow-tooltip />
            <el-table-column prop="age" label="时间" width="80" />
          </el-table>
        </div>
      </el-col>

      <el-col :xs="24" :lg="10">
        <div class="kp-card" style="margin-bottom:16px">
          <div class="kp-section-title">集群信息</div>
          <table class="kp-kv">
            <tr><td>API Server</td><td class="kp-mono">{{ cluster?.server || '-' }}</td></tr>
            <tr><td>K8s 版本</td><td>{{ cluster?.version || '-' }}</td></tr>
            <tr><td>Context</td><td class="kp-mono">{{ cluster?.context || '-' }}</td></tr>
            <tr><td>认证方式</td><td>{{ cluster?.authMode || '-' }}</td></tr>
            <tr><td>平台</td><td>{{ cluster?.platform || '-' }}</td></tr>
            <tr><td>API 资源类型</td><td>{{ cluster?.resourceTypes || '-' }}</td></tr>
          </table>
        </div>

        <div class="kp-card">
          <div class="kp-section-title">
            Pod 状态分布
            <el-button link type="primary" size="small" @click="jump('pods')">Pod 列表</el-button>
          </div>
          <div v-if="!phaseRows.length" class="kp-empty">暂无 Pod</div>
          <div
            v-for="p in phaseRows" :key="p.name" class="phase-row"
            :class="{ 'is-open': expandedPhase === p.name }"
          >
            <div class="phase-head" @click="togglePhase(p.name)">
              <el-icon class="phase-caret"><CaretRight /></el-icon>
              <span class="phase-name">{{ p.name }}</span>
              <span class="phase-count">{{ p.value }}</span>
              <span class="kp-muted phase-pct">{{ p.percent }}%</span>
            </div>
            <el-progress :percentage="p.percent" :color="p.color" :show-text="false" :stroke-width="9" />

            <div v-if="expandedPhase === p.name" class="phase-detail">
              <div v-if="phaseLoading" class="kp-muted" style="padding:10px 0;font-size:12px">加载中…</div>
              <div v-else-if="phaseError" class="kp-danger" style="padding:10px 0;font-size:12px">{{ phaseError }}</div>
              <div v-else-if="!phasePods.length" class="kp-muted" style="padding:10px 0;font-size:12px">没有该状态的 Pod</div>
              <template v-else>
                <div class="phase-list">
                  <div
                    v-for="pod in phasePods" :key="`${pod.namespace}/${pod.name}`"
                    class="phase-pod" @click="goPod(pod)"
                  >
                    <div class="phase-pod-main">
                      <div class="phase-pod-name">{{ pod.name }}</div>
                      <div class="phase-pod-sub">{{ pod.namespace }} · {{ pod.node }}<template v-if="pod.restarts"> · 重启 {{ pod.restarts }}</template></div>
                    </div>
                    <span class="phase-pod-age">{{ pod.age }}</span>
                    <el-button link type="primary" size="small" @click.stop="goPodLogs(pod)">日志</el-button>
                  </div>
                </div>
                <div class="phase-foot">
                  <span class="kp-muted">点击某一行进入 Pod 详情</span>
                  <el-button link type="primary" size="small" @click="jump('pods')">在列表中查看全部</el-button>
                </div>
              </template>
            </div>
          </div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { CaretRight } from '@element-plus/icons-vue'
import api from '../api'
import { store } from '../store'
import { CORE } from '../config/resources'
import { normalizeRow } from '../config/columns'
import { cpath } from '../utils/path'

const router = useRouter()
const loading = ref(false)
const data = ref({})
const cluster = computed(() => store.cluster)
const stat = computed(() => data.value.stat || {})
const activeNs = computed(() => (store.namespace && store.namespace !== 'all' ? store.namespace : ''))

const phaseRows = computed(() => {
  const dist = data.value.podPhases || {}
  const total = Object.values(dist).reduce((a, b) => a + b, 0)
  const colors = { Running: '#16a34a', Pending: '#d97706', Succeeded: '#0ea5e9', Failed: '#dc2626', Unknown: '#6b7280' }
  return Object.entries(dist).map(([name, value]) => ({
    name, value, percent: total ? Math.round(value / total * 100) : 0, color: colors[name] || '#6b7280',
  }))
})

function jump(plural) {
  const map = {
    nodes: [CORE, 'v1'], namespaces: [CORE, 'v1'], pods: [CORE, 'v1'],
    services: [CORE, 'v1'], events: [CORE, 'v1'], deployments: ['apps', 'v1'],
  }
  const [g, v] = map[plural] || [CORE, 'v1']
  router.push(cpath(`/r/${g}/${v}/${plural}`))
}
function goNode(row) { router.push(cpath(`/r/${CORE}/v1/nodes/_all/${row.name}`)) }

/* ---- Pod 状态分布下钻：点开某个状态，列出该状态的具体 Pod ---- */
const expandedPhase = ref('')
const phaseLoading = ref(false)
const phaseError = ref('')
const phasePods = ref([])
const phaseCache = new Map()

async function fetchPhase(phase) {
  phaseLoading.value = true
  phasePods.value = []
  phaseError.value = ''
  try {
    const r = await api.list(CORE, 'v1', 'pods', { namespace: activeNs.value || 'all', fieldSelector: `status.phase=${phase}` })
    const rows = (r.items || []).map(i => normalizeRow('Pod', i))
    phaseCache.set(phase, rows)
    phasePods.value = rows
  } catch (e) {
    phaseError.value = e.message || '加载失败'
  } finally {
    phaseLoading.value = false
  }
}

async function togglePhase(phase) {
  if (expandedPhase.value === phase) { expandedPhase.value = ''; return }
  expandedPhase.value = phase
  if (phaseCache.has(phase)) { phasePods.value = phaseCache.get(phase); phaseError.value = ''; return }
  await fetchPhase(phase)
}
function goPod(row) {
  router.push(cpath(`/r/${CORE}/v1/pods/${encodeURIComponent(row.namespace)}/${encodeURIComponent(row.name)}`))
}
function goPodLogs(row) {
  router.push(cpath(`/pods/${encodeURIComponent(row.namespace)}/${encodeURIComponent(row.name)}/logs`))
}

async function load() {
  loading.value = true
  try { data.value = await api.overview(activeNs.value || 'all') }
  catch (e) { data.value = {} }
  finally { loading.value = false }
  // 分布数字变了，下钻缓存一并失效
  phaseCache.clear()
  if (expandedPhase.value) fetchPhase(expandedPhase.value).catch(() => {})
}

/** 点表格里的命名空间 → 切成全局命名空间过滤（顶部下拉框同步） */
function pickNamespace(ns) {
  if (!ns || ns === '-') return
  store.setNamespace(ns)
}

onMounted(() => {
  load()
  window.addEventListener('kp:refresh', load)
})
watch(() => store.namespace, () => load())
onUnmounted(() => window.removeEventListener('kp:refresh', load))
</script>

<style scoped>
.ns-link {
  color: var(--kp-brand);
  cursor: pointer;
  border-bottom: 1px dashed transparent;
}
.ns-link:hover { border-bottom-color: currentColor; }

.phase-row {
  margin-bottom: 10px; padding: 6px 8px; margin-left: -8px; margin-right: -8px;
  border-radius: var(--kp-r-sm); transition: background .14s;
}
.phase-row:hover { background: #f8fafc; }
.phase-row.is-open { background: #f8fafc; }
.phase-head {
  display: flex; align-items: center; gap: 7px; cursor: pointer;
  font-size: 12.5px; margin-bottom: 5px;
}
.phase-caret {
  font-size: 11px; color: var(--kp-faint); transition: transform .16s;
}
.phase-row.is-open .phase-caret { transform: rotate(90deg); color: var(--kp-brand); }
.phase-name { color: var(--kp-text); }
.phase-count { font-weight: 600; color: var(--kp-text); font-variant-numeric: tabular-nums; }
.phase-pct { margin-left: auto; }
.phase-detail { margin-top: 10px; padding-top: 4px; border-top: 1px dashed var(--kp-border); }
.phase-list { max-height: 250px; overflow-y: auto; margin: 0 -4px; }
.phase-pod {
  display: flex; align-items: center; gap: 8px; padding: 6px 6px; border-radius: 5px;
  cursor: pointer; transition: background .12s;
}
.phase-pod:hover { background: #eef4ff; }
.phase-pod-main { min-width: 0; flex: 1; }
.phase-pod-name {
  font-size: 12.5px; color: var(--kp-brand); overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.phase-pod-sub { font-size: 11px; color: var(--kp-muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.phase-pod-age { font-size: 11px; color: var(--kp-faint); white-space: nowrap; }
.phase-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding-top: 6px; font-size: 11.5px;
}
</style>
