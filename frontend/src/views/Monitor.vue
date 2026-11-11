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
            按环境（测试 / 预发 / 生产 …）管理多个 Grafana 实例，左侧选择实例后，仪表盘以嵌入方式展示；
            未接入 Grafana 时，下方「内置指标」直接读 metrics-server，同样能看到 CPU / 内存。
          </p>
        </div>
      </div>

      <el-tabs v-model="tab" class="mon-tabs">
        <el-tab-pane label="Grafana 仪表盘" name="grafana">
          <el-row :gutter="16">
            <el-col :xs="24" :lg="9">
              <!-- 多实例 / 多环境管理 -->
              <div class="kp-card">
                <div class="kp-section-title">
                  Grafana 实例
                  <el-tag disable-transitions size="small" type="info" effect="plain" round>{{ instances.length }} 个</el-tag>
                  <span style="flex:1" />
                  <el-button link type="primary" size="small" :disabled="!canCreate" @click="openCreate">
                    <el-icon><Plus /></el-icon><span style="margin-left:3px">添加</span>
                  </el-button>
                </div>

                <div v-if="!instances.length" class="kp-empty" style="padding:18px 6px;text-align:center;line-height:1.7">
                  还没有接入任何 Grafana。<br />点击「添加」把测试 / 预发 / 生产等环境的 Grafana 逐个接入。
                </div>

                <div v-for="g in groups" :key="g.env" class="env-group">
                  <div class="env-head">
                    <el-icon><Collection /></el-icon>
                    <span>{{ g.env }}</span>
                    <span class="kp-muted env-count">{{ g.items.length }} 个</span>
                  </div>
                  <div v-for="it in g.items" :key="it.id" class="inst-item"
                    :class="{ active: activeId === it.id, 'is-off': !it.enabled }"
                    @click="selectInstance(it)">
                    <el-icon class="inst-ic"><Monitor /></el-icon>
                    <div class="inst-text">
                      <div class="inst-name">
                        <span class="nm">{{ it.name }}</span>
                        <el-tag disable-transitions v-if="!it.enabled" size="small" type="info" effect="plain">已停用</el-tag>
                        <el-tag disable-transitions v-else-if="it.hasToken" size="small" type="success" effect="plain">已配 Token</el-tag>
                      </div>
                      <div class="inst-sub">{{ it.url }}</div>
                    </div>
                    <el-icon v-if="activeId === it.id" class="inst-check"><CircleCheck /></el-icon>
                    <el-dropdown trigger="click" @command="c => onInstCommand(c, it)">
                      <span class="inst-more" @click.stop><el-icon><MoreFilled /></el-icon></span>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item command="edit" :disabled="!canUpdate">
                            <el-icon><EditPen /></el-icon> 编辑 / 测试
                          </el-dropdown-item>
                          <el-dropdown-item command="test" :disabled="!canTest">
                            <el-icon><Connection /></el-icon> 测试连接
                          </el-dropdown-item>
                          <el-dropdown-item command="delete" :disabled="!canDelete" divided>
                            <el-icon><Delete /></el-icon> 删除
                          </el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                </div>
              </div>

              <!-- 当前实例的仪表盘 -->
              <div class="kp-card" style="margin-top:16px">
                <div class="kp-section-title">仪表盘
                  <el-button link type="primary" size="small" :loading="dashLoading" @click="loadDashboards">刷新</el-button>
                </div>
                <div v-if="!activeInstance" class="kp-empty">先在上方选择或添加一个 Grafana 实例</div>
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
                  <template v-if="activeInstance">
                    <el-tag disable-transitions size="small" effect="plain" round>{{ activeInstance.environment }}</el-tag>
                    <span>{{ activeInstance.name }}</span>
                    <span class="kp-muted frame-url">{{ activeInstance.url }}</span>
                  </template>
                  <span v-else>Grafana 仪表盘预览</span>
                  <span style="flex:1" />
                  <el-button v-if="current" link type="primary" size="small" @click="openNewTab">新窗口打开</el-button>
                </div>
                <iframe v-if="current" :src="current.embedUrl" class="frame" frameborder="0" />
                <div v-else class="frame-empty">
                  <el-icon style="font-size: 25px;color:var(--kp-faint)"><TrendCharts /></el-icon>
                  <div>选择左侧实例与仪表盘后在此嵌入预览</div>
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

    <!-- 添加 / 编辑 Grafana 实例 -->
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑 Grafana 实例' : '添加 Grafana 实例'"
      width="540px" :close-on-click-modal="false">
      <el-form label-position="top" size="small" @submit.prevent>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="例如：生产主集群 Grafana" />
        </el-form-item>
        <el-form-item label="环境">
          <el-select v-model="form.environment" filterable allow-create default-first-option
            placeholder="选择或输入环境名" style="width:100%">
            <el-option v-for="e in envOptions" :key="e" :label="e" :value="e" />
          </el-select>
          <div class="kp-muted" style="font-size:11.5px;margin-top:4px;line-height:1.5">
            多个实例会按环境分组展示（测试 / 预发 / 生产 …），也可直接输入自定义环境名。
          </div>
        </el-form-item>
        <el-form-item label="地址" required>
          <el-input v-model="form.url" placeholder="http://192.168.56.101:30020" />
        </el-form-item>
        <el-form-item label="服务账号 Token">
          <el-input v-model="form.token" type="password" show-password :disabled="form.clearToken"
            :placeholder="form.clearToken ? '保存后将清除已保存的 Token' : (editing && editing.hasToken ? '已保存，留空表示不修改' : 'glsa_xxx（用于读取仪表盘列表）')" />
          <div class="kp-muted" style="font-size:11.5px;margin-top:4px;line-height:1.5">
            Grafana → Administration → Service accounts → Add token，权限给 Viewer 即可。
          </div>
          <div v-if="editing && editing.hasToken" style="margin-top:6px">
            <el-button link type="danger" size="small" :disabled="!canUpdate" @click="form.clearToken = !form.clearToken">
              {{ form.clearToken ? '取消清除' : '清除已保存的 Token' }}
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="信任 CA（PEM，可选）"><el-input v-model="form.ca" type="textarea" :rows="4" placeholder="自签证书请提供 CA；编辑时留空保留" /></el-form-item>
        <el-form-item><el-checkbox v-model="form.insecure">跳过 TLS 校验（仅在明确了解风险时开启）</el-checkbox></el-form-item>
        <el-form-item>
          <el-switch v-model="form.enabled" active-text="启用该实例" />
        </el-form-item>
        <div v-if="editing" class="kp-muted" style="font-size:11.5px;margin-top:-6px">
          上次保存：{{ fmtTime(editing.updatedAt) }}
        </div>
      </el-form>
      <template #footer>
        <div class="dlg-footer">
          <el-button size="small" :loading="testing" :disabled="!canTest" @click="testDraft">测试连接</el-button>
          <span style="flex:1" />
          <el-button size="small" @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" size="small" :loading="saving" :disabled="!canSave" @click="saveInstance">保存</el-button>
        </div>
      </template>
    </el-dialog>
  </PlatformLayout>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Refresh, DataLine, TopRight, TrendCharts, Cpu, Coin, Odometer, Histogram,
  Plus, MoreFilled, CircleCheck, Monitor, Collection, Delete, EditPen, Connection,
} from '@element-plus/icons-vue'
import { can } from '../utils/perm'
import PlatformLayout from '../layout/PlatformLayout.vue'
import api from '../api'

const ACTIVE_KEY = 'kp_monitor_active'
const envOptions = ['生产', '预发', '测试', '开发', '灾备', '默认']
const envOrder = ['生产', '预发', '测试', '开发', '灾备', '默认']

const canCreate = computed(() => can('monitor:create'))
const canUpdate = computed(() => can('monitor:update'))
const canDelete = computed(() => can('monitor:delete'))
const canTest = computed(() => can('monitor:create') || can('monitor:update') || can('monitor:detail'))
const canSave = computed(() => editing.value ? canUpdate.value : canCreate.value)

const tab = ref('grafana')
const loading = ref(false)
const saving = ref(false)
const testing = ref(false)

const instances = ref([])
const activeId = ref(localStorage.getItem(ACTIVE_KEY) || '')

const dialogVisible = ref(false)
const editing = ref(null) // 正在编辑的实例视图；null = 新建
const form = reactive({ name: '', environment: '生产', url: '', token: '', enabled: true, clearToken: false, insecure:false,ca:'' })

// 按环境分组；常见环境在前，其余按拼音排序
const groups = computed(() => {
  const map = new Map()
  for (const it of instances.value) {
    const env = it.environment || '默认'
    if (!map.has(env)) map.set(env, [])
    map.get(env).push(it)
  }
  const rank = e => {
    const i = envOrder.indexOf(e)
    return i === -1 ? envOrder.length : i
  }
  return [...map.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], 'zh'))
    .map(([env, items]) => ({ env, items }))
})

const activeInstance = computed(() => instances.value.find(x => x.id === activeId.value) || null)

const dashboards = ref([])
const current = ref(null)
const dashLoading = ref(false)
const dashError = ref('')

const metricsLoading = ref(false)
const metrics = reactive({
  nodes: { available: false, items: [], message: '' },
  pods: { available: false, items: [], message: '' },
  nodeCpu: 0, nodeMem: 0, podCpu: 0, podMem: 0,
})

function persistActive(id) {
  activeId.value = id || ''
  if (id) localStorage.setItem(ACTIVE_KEY, id)
  else localStorage.removeItem(ACTIVE_KEY)
}

// 校正当前选中的实例：id 仍存在就沿用，否则选第一个启用（或第一个）实例
function resolveActive() {
  let id = activeId.value
  if (!instances.value.some(x => x.id === id)) id = ''
  if (!id) {
    const first = instances.value.find(x => x.enabled) || instances.value[0]
    id = first?.id || ''
  }
  persistActive(id)
  return id
}

function applyView(c) {
  instances.value = Array.isArray(c?.instances) ? c.instances : []
  resolveActive()
}

async function loadConfig() {
  try {
    const c = await api.monitor()
    applyView(c)
    await loadDashboards()
  } catch (e) { /* 拦截器已提示 */ }
}

async function loadDashboards() {
  const inst = activeInstance.value
  if (!inst) { dashboards.value = []; current.value = null; return }
  dashLoading.value = true
  dashError.value = ''
  try {
    dashboards.value = await api.dashboards(inst.id)
    if (!current.value && dashboards.value.length) current.value = dashboards.value[0]
  } catch (e) {
    dashError.value = e.message || '读取失败'
    dashboards.value = []
  } finally { dashLoading.value = false }
}

function selectInstance(it) {
  if (activeId.value === it.id) return
  persistActive(it.id)
  dashboards.value = []
  current.value = null
  dashError.value = ''
  loadDashboards()
}

function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', environment: '生产', url: '', token: '', enabled: true, clearToken: false, insecure:false,ca:'' })
  dialogVisible.value = true
}

function openEdit(it) {
  editing.value = it
  Object.assign(form, {
    name: it.name, environment: it.environment, url: it.url,
    token: '', enabled: it.enabled, clearToken: false, insecure:!!it.insecure, ca:'',
  })
  dialogVisible.value = true
}

function onInstCommand(cmd, it) {
  if (cmd === 'edit') openEdit(it)
  else if (cmd === 'test') testSaved(it)
  else if (cmd === 'delete') removeInstance(it)
}

async function saveInstance() {
  if (!form.name.trim()) { ElMessage.warning('请填写实例名称'); return }
  if (!form.url.trim()) { ElMessage.warning('请填写 Grafana 地址'); return }
  const before = new Set(instances.value.map(x => x.id))
  saving.value = true
  try {
    const payload = {
      name: form.name.trim(),
      environment: form.environment || '默认',
      url: form.url.trim(),
      token: form.token,
      enabled: form.enabled, insecure:form.insecure, ...(form.ca.trim() ? {ca:form.ca.trim()} : {}),
    }
    let c
    if (editing.value) {
      if (form.clearToken) payload.clearToken = true
      c = await api.updateMonitor(editing.value.id, payload)
      ElMessage.success('已保存')
    } else {
      c = await api.createMonitor(payload)
      ElMessage.success('已添加')
      const created = (c.instances || []).find(x => !before.has(x.id))
      if (created) persistActive(created.id) // 新建后直接切到它
    }
    applyView(c)
    dialogVisible.value = false
    dashboards.value = []
    current.value = null
    loadDashboards()
  } catch (e) { /* 拦截器已提示 */ }
  finally { saving.value = false }
}

async function testDraft() {
  const payload = editing.value
    ? { id: editing.value.id, token: form.token, clearToken: form.clearToken, url:form.url.trim(),insecure:form.insecure,...(form.ca.trim() ? {ca:form.ca.trim()} : {}) }
    : { url: form.url.trim(), token: form.token,insecure:form.insecure,...(form.ca.trim() ? {ca:form.ca.trim()} : {}) }
  if (!editing.value && !payload.url) { ElMessage.warning('请先填写地址'); return }
  testing.value = true
  try {
    const r = await api.testMonitor(payload)
    if (!r.ok) { ElMessage.error(`连接失败：${r.message || '未知原因'}`); return }
    const authNote = r.authMode === 'anonymous' ? ' · 匿名访问' : ''
    ElMessage.success(`连接正常 · Grafana ${r.version || ''} · ${r.dashboards} 个仪表盘${authNote} · ${r.ms}ms`)
  } catch (e) {
    ElMessage.error(e.message || '连接失败')
  } finally { testing.value = false }
}

async function testSaved(it) {
  testing.value = true
  try {
    const r = await api.testMonitor({ id: it.id })
    if (!r.ok) { ElMessage.error(`连接失败：${r.message || '未知原因'}`); return }
    const authNote = r.authMode === 'anonymous' ? ' · 匿名访问' : ''
    ElMessage.success(`${it.name} · Grafana ${r.version || ''} · ${r.dashboards} 个仪表盘${authNote} · ${r.ms}ms`)
  } catch (e) {
    ElMessage.error(e.message || '连接失败')
  } finally { testing.value = false }
}

async function removeInstance(it) {
  try {
    await ElMessageBox.confirm(
      `确定删除 Grafana 实例「${it.name}」吗？该实例的连接配置（含 Token）将被移除。`,
      '删除实例', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch (e) { return }
  try {
    const c = await api.removeMonitor(it.id)
    applyView(c)
    ElMessage.success('已删除')
    dashboards.value = []
    current.value = null
    loadDashboards()
  } catch (e) { /* 拦截器已提示 */ }
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
  loading.value = false
}

onMounted(reload)
</script>

<style scoped>
.plat-page { min-height: 100vh; background: var(--kp-bg); }
.plat-main { max-width: 1280px; margin: 0 auto; padding: 24px 22px 48px; }
.page-head { margin-bottom: 12px; }
.page-head h1 { margin: 0; font-size: 21px; font-weight: 650; letter-spacing: -.02em; }
.page-head p { margin: 6px 0 0; font-size: 12px; max-width: 820px; line-height: 1.6; }
.mon-tabs :deep(.el-tabs__nav-wrap::after) { display: none; }
.env-group { margin-top: 6px; }
.env-group:first-child { margin-top: 0; }
.env-head {
  display: flex; align-items: center; gap: 6px; padding: 9px 6px 5px;
  font-size: 11.5px; font-weight: 600; color: var(--kp-muted); letter-spacing: .02em;
  border-bottom: 1px solid var(--kp-border); margin-bottom: 4px;
}
.env-head .el-icon { font-size: 12px; }
.env-count { margin-left: auto; font-weight: 400; }
.inst-item {
  display: flex; align-items: center; gap: 9px; padding: 8px 10px;
  border-radius: var(--kp-r-sm); cursor: pointer; transition: background .14s;
  color: var(--kp-text-2);
}
.inst-item:hover { background: #f8fafc; }
.inst-item.active { background: var(--kp-brand-soft); }
.inst-item.is-off { opacity: .55; }
.inst-ic { font-size: 15px; color: var(--kp-muted); flex: none; }
.inst-item.active .inst-ic { color: var(--kp-brand); }
.inst-text { min-width: 0; flex: 1; }
.inst-name { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12.8px; }
.inst-name .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--kp-text); }
.inst-sub { font-size: 11px; color: var(--kp-muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.inst-check { font-size: 14px; color: var(--kp-brand); flex: none; }
.inst-more {
  display: inline-flex; align-items: center; padding: 2px; border-radius: 4px;
  color: var(--kp-muted); font-size: 13px; flex: none;
}
.inst-more:hover { background: rgba(0, 0, 0, .05); color: var(--kp-text); }
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
.frame-url { font-size: 11.5px; margin-left: 2px; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.frame { width: 100%; height: 560px; display: block; background: #fff; }
.frame-empty {
  height: 560px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; color: var(--kp-muted); font-size: 12px; text-align: center; padding: 0 30px; line-height: 1.7;
}
.bar-row { display: flex; align-items: center; gap: 8px; }
.bar-row :deep(.el-progress) { flex: 1; }
.bar-text { font-size: 11px; color: var(--kp-muted); width: 104px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.unit { font-size: 12px; color: var(--kp-muted); margin-left: 2px; font-weight: 400; }
.dlg-footer { display: flex; align-items: center; gap: 8px; }
</style>
