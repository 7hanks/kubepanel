<template>
  <PlatformLayout active="monitor">
    <template #actions>
      <el-button size="small" :loading="loading" circle @click="reload"><el-icon><Refresh /></el-icon></el-button>
    </template>

    <main class="plat-main">
      <div class="page-head">
        <div>
          <h1>监控</h1>
          <p class="kp-muted">
            对接已有的 Grafana（地址 + 服务账号 Token），仪表盘以嵌入方式展示；
            未接入 Grafana 时，下方「内置指标」直接读 metrics-server，同样能看到 CPU / 内存。
          </p>
        </div>
      </div>

      <el-tabs v-model="tab" class="mon-tabs">
        <el-tab-pane label="Grafana 仪表盘" name="grafana">
          <el-row :gutter="16">
            <el-col :xs="24" :lg="9">
              <div class="kp-card">
                <div class="kp-section-title">
                  Grafana 连接
                  <el-tag v-if="cfg.enabled && cfg.url" type="success" size="small" effect="light">已启用</el-tag>
                  <el-tag v-else type="info" size="small" effect="plain">未启用</el-tag>
                </div>
                <el-form label-position="top" size="small">
                  <el-form-item label="地址">
                    <el-input v-model="form.url" placeholder="http://192.168.56.101:30020" />
                  </el-form-item>
                  <el-form-item label="服务账号 Token">
                    <el-input v-model="form.token" type="password" show-password
                      :placeholder="cfg.hasToken ? '已保存，留空表示不修改' : 'glsa_xxx（用于读取仪表盘列表）'" />
                    <div class="kp-muted" style="font-size:11.5px;margin-top:4px;line-height:1.5">
                      Grafana → Administration → Service accounts → Add token，权限给 Viewer 即可。
                    </div>
                  </el-form-item>
                  <el-form-item>
                    <el-switch v-model="form.enabled" active-text="启用监控入口" />
                  </el-form-item>
                </el-form>
                <div style="display:flex;gap:8px">
                  <el-button type="primary" size="small" :loading="saving" :disabled="!writable" @click="save">保存</el-button>
                  <el-button size="small" :loading="testing" :disabled="!writable" @click="test">测试连接</el-button>
                  <el-button size="small" :disabled="!writable" @click="clearToken">清除 Token</el-button>
                </div>
                <div v-if="cfg.updatedAt" class="kp-muted" style="font-size:11.5px;margin-top:10px">
                  上次保存：{{ fmtTime(cfg.updatedAt) }}
                </div>
              </div>

              <div class="kp-card" style="margin-top:16px">
                <div class="kp-section-title">仪表盘
                  <el-button link type="primary" size="small" :loading="dashLoading" @click="loadDashboards">刷新</el-button>
                </div>
                <div v-if="!cfg.url" class="kp-empty">先填写并保存 Grafana 地址</div>
                <div v-else-if="dashError" class="kp-danger" style="font-size:12.5px">{{ dashError }}</div>
                <div v-else-if="!dashboards.length" class="kp-empty">没有读到仪表盘（可能需要 Token 或权限）</div>
                <div v-for="d in dashboards" :key="d.uid" class="dash-item"
                  :class="{ active: current?.uid === d.uid }" @click="current = d">
                  <el-icon><DataLine /></el-icon>
                  <div class="dash-text">
                    <div class="dash-title">{{ d.title }}</div>
                    <div class="dash-sub">{{ d.folder || 'General' }}<span v-if="d.tags?.length"> · {{ d.tags.join(', ') }}</span></div>
                  </div>
                  <el-icon class="dash-go"><TopRight /></el-icon>
                </div>
              </div>
            </el-col>

            <el-col :xs="24" :lg="15">
              <div class="kp-card" style="padding:0;overflow:hidden">
                <div class="frame-head">
                  <span>{{ current ? current.title : '仪表盘预览' }}</span>
                  <span style="flex:1" />
                  <el-button v-if="current" link type="primary" size="small" @click="openNewTab">新窗口打开</el-button>
                </div>
                <iframe v-if="current" :src="current.embedUrl" class="frame" frameborder="0" />
                <div v-else class="frame-empty">
                  <el-icon style="font-size:26px;color:var(--kp-faint)"><TrendCharts /></el-icon>
                  <div>选择左侧仪表盘后在嵌入预览</div>
                  <div class="kp-muted" style="font-size:12px">
                    嵌入使用 <code>?kiosk&amp;theme=light</code>，需要 Grafana 允许被 iframe 嵌入
                    （<code>allow_embedding = true</code>）。
                  </div>
                </div>
              </div>
            </el-col>
          </el-row>
        </el-tab-pane>

        <el-tab-pane label="内置指标" name="builtin">
          <el-alert v-if="!metrics.nodes.available" type="warning" :closable="false" style="margin-bottom:14px">
            未读到 metrics-server 数据：{{ metrics.nodes.message || '请确认集群里装了 metrics-server' }}
          </el-alert>

          <div class="kp-stat-grid" style="margin-bottom:16px">
            <div class="kp-stat"><div class="label">节点 CPU 用量</div>
              <div class="value">{{ metrics.nodeCpu.toFixed(0) }}<span class="unit">m</span></div>
              <el-icon class="icon"><Cpu /></el-icon></div>
            <div class="kp-stat"><div class="label">节点内存用量</div>
              <div class="value">{{ fmtBytes(metrics.nodeMem) }}</div>
              <el-icon class="icon"><Coin /></el-icon></div>
            <div class="kp-stat"><div class="label">Pod CPU 合计</div>
              <div class="value">{{ metrics.podCpu.toFixed(0) }}<span class="unit">m</span></div>
              <el-icon class="icon"><Odometer /></el-icon></div>
            <div class="kp-stat"><div class="label">Pod 内存合计</div>
              <div class="value">{{ fmtBytes(metrics.podMem) }}</div>
              <el-icon class="icon"><Histogram /></el-icon></div>
          </div>

          <el-row :gutter="16">
            <el-col :xs="24" :lg="11">
              <div class="kp-card">
                <div class="kp-section-title">节点用量</div>
                <el-table :data="nodeRows" size="small" v-loading="metricsLoading">
                  <el-table-column prop="name" label="节点" min-width="120" show-overflow-tooltip />
                  <el-table-column label="CPU" min-width="180">
                    <template #default="{ row }">
                      <div class="bar-row">
                        <el-progress :percentage="row.cpuPct" :show-text="false" :stroke-width="7" :color="barColor(row.cpuPct)" />
                        <span class="bar-text">{{ row.cpuText }}</span>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column label="内存" min-width="210">
                    <template #default="{ row }">
                      <div class="bar-row">
                        <el-progress :percentage="row.memPct" :show-text="false" :stroke-width="7" :color="barColor(row.memPct)" />
                        <span class="bar-text">{{ row.memText }}</span>
                      </div>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </el-col>
            <el-col :xs="24" :lg="13">
              <div class="kp-card">
                <div class="kp-section-title">Pod 用量 Top 20
                  <span class="kp-muted" style="font-size:11.5px;font-weight:400">按 CPU 排序</span>
                </div>
                <el-table :data="podRows" size="small" v-loading="metricsLoading" max-height="420">
                  <el-table-column label="Pod" min-width="200" show-overflow-tooltip>
                    <template #default="{ row }">
                      <span style="font-size:12.5px">{{ row.name }}</span>
                      <span class="kp-muted" style="font-size:11px;margin-left:6px">{{ row.namespace }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column prop="cpuText" label="CPU" width="90" align="right" />
                  <el-table-column prop="memoryText" label="内存" width="100" align="right" />
                  <template #empty><div class="kp-empty">没有指标数据</div></template>
                </el-table>
              </div>
            </el-col>
          </el-row>
        </el-tab-pane>
      </el-tabs>
    </main>
  </PlatformLayout>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Refresh, DataLine, TopRight, TrendCharts, Cpu, Coin, Odometer, Histogram,
} from '@element-plus/icons-vue'
import { can } from '../utils/perm'
import PlatformLayout from '../layout/PlatformLayout.vue'
import api from '../api'

const writable = computed(() => can('monitor:update') || can('monitor:create'))
const tab = ref('grafana')
const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const dashLoading = ref(false)
const dashError = ref('')
const cfg = reactive({ url: '', enabled: false, hasToken: false, updatedAt: null })
const form = reactive({ url: '', token: '', enabled: false })
const dashboards = ref([])
const current = ref(null)

const metricsLoading = ref(false)
const metrics = reactive({
  nodes: { available: false, items: [], message: '' },
  pods: { available: false, items: [], message: '' },
  nodeCpu: 0, nodeMem: 0, podCpu: 0, podMem: 0,
})

async function loadConfig() {
  try {
    const c = await api.monitor()
    Object.assign(cfg, c)
    form.url = c.url
    form.enabled = c.enabled
    form.token = ''
  } catch (e) { /* 拦截器已提示 */ }
}

async function save() {
  saving.value = true
  try {
    const r = await api.saveMonitor({ url: form.url, token: form.token, enabled: form.enabled })
    Object.assign(cfg, r)
    form.token = ''
    ElMessage.success('已保存')
    if (cfg.url) loadDashboards()
  } catch (e) { /* 拦截器已提示 */ }
  finally { saving.value = false }
}

async function test() {
  testing.value = true
  try {
    const r = await api.testMonitor({ url: form.url, token: form.token })
    ElMessage.success(`连接正常 · Grafana ${r.version || ''} · ${r.dashboards} 个仪表盘 · ${r.ms}ms`)
  } catch (e) {
    ElMessage.error(e.message || '连接失败')
  } finally { testing.value = false }
}

async function clearToken() {
  try {
    const r = await api.saveMonitor({ token: '', clearToken: true })
    Object.assign(cfg, r)
    ElMessage.success('Token 已清除')
  } catch (e) { /* ignore */ }
}

async function loadDashboards() {
  if (!cfg.url) return
  dashLoading.value = true
  dashError.value = ''
  try {
    dashboards.value = await api.dashboards()
    if (!current.value && dashboards.value.length) current.value = dashboards.value[0]
  } catch (e) {
    dashError.value = e.message || '读取失败'
    dashboards.value = []
  } finally { dashLoading.value = false }
}

function openNewTab() {
  if (current.value) window.open(current.value.url, '_blank', 'noopener')
}

function parseCpu(v) {
  const s = String(v || '0')
  if (s.endsWith('n')) return Number(s.slice(0, -1)) / 1e6
  if (s.endsWith('u')) return Number(s.slice(0, -1)) / 1e3
  if (s.endsWith('m')) return Number(s.slice(0, -1))
  return Number(s) * 1000 || 0
}
function parseMem(v) {
  const s = String(v || '0')
  const units = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, K: 1e3, M: 1e6, G: 1e9 }
  const m = s.match(/^([\d.]+)([A-Za-z]*)$/)
  return m ? Number(m[1]) * (units[m[2]] || 1) : 0
}
function fmtBytes(n) {
  if (!n) return '0'
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GiB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MiB`
  return `${Math.round(n / 1024)} KiB`
}
function fmtTime(v) {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function barColor(pct) { return pct >= 85 ? '#dc2626' : pct >= 65 ? '#d97706' : '#2563eb' }

const nodeRows = computed(() => {
  const items = metrics.nodes.items || []
  const maxCpu = Math.max(1, ...items.map(n => parseCpu(n.usage?.cpu)))
  const maxMem = Math.max(1, ...items.map(n => parseMem(n.usage?.memory)))
  return items.map(n => {
    const cpu = parseCpu(n.usage?.cpu)
    const mem = parseMem(n.usage?.memory)
    const capCpu = n.capacity?.cpu ? parseCpu(n.capacity.cpu) : 0
    const capMem = n.capacity?.memory ? parseMem(n.capacity.memory) : 0
    // 有容量就按真实容量算占比；没有就退化成「相对最大节点」的相对值
    const cpuPct = Math.min(100, Math.round(capCpu ? cpu / capCpu * 100 : cpu / maxCpu * 100))
    const memPct = Math.min(100, Math.round(capMem ? mem / capMem * 100 : mem / maxMem * 100))
    return {
      name: n.metadata?.name,
      cpuPct, memPct,
      cpuText: capCpu ? `${cpu.toFixed(0)}m / ${(capCpu / 1000).toFixed(1)}c` : `${cpu.toFixed(0)}m`,
      memText: capMem ? `${fmtBytes(mem)} / ${fmtBytes(capMem)}` : fmtBytes(mem),
    }
  })
})
const podRows = computed(() => (metrics.pods.items || []).slice(0, 20))

async function loadMetrics() {
  metricsLoading.value = true
  try {
    const [n, p] = await Promise.all([
      api.nodeMetrics().catch(() => ({ available: false, items: [] })),
      api.podMetrics('all').catch(() => ({ available: false, items: [] })),
    ])
    metrics.nodes = n
    metrics.pods = p
    metrics.nodeCpu = (n.items || []).reduce((a, x) => a + parseCpu(x.usage?.cpu), 0)
    metrics.nodeMem = (n.items || []).reduce((a, x) => a + parseMem(x.usage?.memory), 0)
    metrics.podCpu = p.totalCpu || 0
    metrics.podMem = p.totalMemory || 0
  } finally { metricsLoading.value = false }
}

async function reload() {
  loading.value = true
  await Promise.all([loadConfig(), loadMetrics()])
  if (cfg.url) loadDashboards()
  loading.value = false
}

onMounted(reload)
</script>

<style scoped>
.plat-page { min-height: 100vh; background: var(--kp-bg); }
.plat-main { max-width: 1280px; margin: 0 auto; padding: 24px 22px 48px; }
.page-head { margin-bottom: 12px; }
.page-head h1 { margin: 0; font-size: 22px; font-weight: 650; letter-spacing: -.02em; }
.page-head p { margin: 6px 0 0; font-size: 13px; max-width: 820px; line-height: 1.6; }
.mon-tabs :deep(.el-tabs__nav-wrap::after) { display: none; }
.dash-item {
  display: flex; align-items: center; gap: 9px; padding: 8px 10px; border-radius: var(--kp-r-sm);
  cursor: pointer; transition: background .14s; color: var(--kp-text-2);
}
.dash-item:hover { background: #f8fafc; }
.dash-item.active { background: var(--kp-brand-soft); color: var(--kp-brand); }
.dash-text { min-width: 0; flex: 1; }
.dash-title { font-size: 12.8px; color: var(--kp-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dash-sub { font-size: 11px; color: var(--kp-muted); margin-top: 2px; }
.dash-go { font-size: 12px; opacity: .5; }
.frame-head {
  display: flex; align-items: center; gap: 8px; padding: 9px 14px;
  border-bottom: 1px solid var(--kp-border); font-size: 12.5px; color: var(--kp-text);
}
.frame { width: 100%; height: 560px; display: block; background: #fff; }
.frame-empty {
  height: 560px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; color: var(--kp-muted); font-size: 13px; text-align: center; padding: 0 30px; line-height: 1.7;
}
.bar-row { display: flex; align-items: center; gap: 8px; }
.bar-row :deep(.el-progress) { flex: 1; }
.bar-text { font-size: 11px; color: var(--kp-muted); width: 104px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.unit { font-size: 12px; color: var(--kp-muted); margin-left: 2px; font-weight: 400; }
</style>
