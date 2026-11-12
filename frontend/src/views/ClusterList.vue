<template>
  <component :is="embedded ? 'div' : PlatformLayout" active="clusters">
    <template #actions>
      <el-button size="small" :loading="loading" circle @click="load(true).catch(() => {})"><el-icon><Refresh /></el-icon></el-button>
    </template>

    <main class="cluster-main" :class="{ 'cluster-embedded': embedded }">
      <div class="cluster-toolbar">
        <h1>{{ embedded ? 'Kubernetes 集群' : '导入集群' }}</h1>
        <div class="cluster-toolbar-actions">
          <el-input v-if="embedded" v-model="search" placeholder="搜索集群名称" clearable :prefix-icon="Search" style="width:220px" />
          <el-button v-if="embedded" :loading="loading" :icon="Refresh" @click="load(true).catch(() => {})">刷新</el-button>
          <el-button v-if="canAdd" type="primary" :icon="Plus" @click="openAdd">导入集群</el-button>
        </div>
      </div>
      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" style="margin-bottom:16px" />
      <div v-loading="loading">
        <div v-if="!clusters.length && !loading && !loadError" class="kp-card" style="text-align:center;padding:56px 20px">
          <el-icon style="font-size:43px;color:#9ca3af"><OfficeBuilding /></el-icon>
          <p style="font-size:15px;font-weight:600;margin:14px 0 18px">还没有可访问的集群</p>
          <el-button v-if="canAdd" type="primary" @click="openAdd">导入第一个集群</el-button>
        </div>
        <el-table v-else :data="filteredClusters" stripe border empty-text="没有匹配的集群">
          <el-table-column label="集群名称" min-width="190" show-overflow-tooltip>
            <template #default="{ row: c }">
              <el-button link type="primary" @click="enter(c)">{{ c.name }}</el-button>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90"><template #default="{ row: c }"><el-tag :type="c.healthy ? 'success' : 'danger'" size="small">{{ c.healthy ? '正常' : '异常' }}</el-tag></template></el-table-column>
          <el-table-column prop="version" label="版本" min-width="115" />
          <el-table-column prop="server" label="API Server" min-width="210" show-overflow-tooltip />
          <el-table-column label="创建时间" min-width="180"><template #default="{ row: c }">{{ createdTime(c) }}</template></el-table-column>
          <el-table-column label="操作" width="135" fixed="right">
            <template #default="{ row: c }">
              <el-button link type="primary" @click="openDetail(c)">详情</el-button>
              <el-button v-if="canAdd" link type="primary" @click="openEdit(c)">编辑</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </main>

    <!-- 查看详情不会切换当前集群 -->
    <el-drawer v-model="detailVisible" :title="`集群详情 · ${detail?.name || ''}`" size="62%" destroy-on-close>
      <div v-loading="detailLoading">
        <el-alert v-if="['expiring','expired'].includes(detail?.credentialExpiry?.status)" :type="detail.credentialExpiry.status === 'expired' ? 'error':'warning'" :closable="false" :title="`客户端证书${detail.credentialExpiry.status === 'expired' ? '已到期' : `将在 ${detail.credentialExpiry.daysRemaining} 天后到期`} · ${detail.credentialExpiry.notAfter}`" style="margin-bottom:12px" />
        <el-alert v-if="detail?.error" type="error" show-icon :closable="false" :title="detail.error" />

        <template v-if="detail && !detail.error">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
            <span class="status-dot ok" />
            <strong style="font-size: 15px">{{ detail.name }}</strong>
            <el-tag disable-transitions type="success" size="small">连接正常</el-tag>
            <span class="kp-mono kp-muted" style="font-size:12px">{{ detail.server }}</span>
          </div>

          <div class="kp-stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(115px,1fr))">
            <div class="kp-stat"><div class="label">节点</div><div class="value">{{ detail.stat?.nodes ?? '-' }}</div></div>
            <div class="kp-stat"><div class="label">命名空间</div><div class="value">{{ detail.stat?.namespaces ?? '-' }}</div></div>
            <div class="kp-stat"><div class="label">Pod</div><div class="value">{{ detail.stat?.pods ?? '-' }}</div></div>
            <div class="kp-stat"><div class="label">Deployment</div><div class="value">{{ detail.stat?.deployments ?? '-' }}</div></div>
            <div class="kp-stat"><div class="label">Service</div><div class="value">{{ detail.stat?.services ?? '-' }}</div></div>
            <div class="kp-stat"><div class="label">异常 Pod</div><div class="value" :class="detail.stat?.unhealthyPods ? 'kp-danger' : 'kp-ok'">{{ detail.stat?.unhealthyPods ?? '-' }}</div></div>
          </div>

          <div class="kp-section-title">基本信息</div>
          <table class="kp-kv"><tbody>
            <tr><td>创建时间</td><td>{{ createdTime(detail) }}</td></tr>
            <tr><td>API Server</td><td class="kp-mono">{{ detail.server }}</td></tr>
            <tr><td>K8s 版本</td><td>{{ detail.version }}</td></tr>
            <tr><td>平台</td><td>{{ detail.platform }}</td></tr>
            <tr><td>Context</td><td class="kp-mono">{{ detail.context }}</td></tr>
            <tr><td>认证方式</td><td>{{ detail.authMode }}</td></tr>
            <tr><td>凭据来源</td><td class="kp-mono">{{ detail.source }}</td></tr>
            <tr><td>API 资源类型</td><td>{{ detail.resourceTypes }}</td></tr>
            <tr><td>可在界面移除</td><td>{{ detail.removable ? '是' : '否（环境变量 / ServiceAccount / 只读挂载）' }}</td></tr>
            <tr><td>metrics-server</td><td>{{ detail.metricsAvailable ? '已安装（显示实时用量）' : '不可用（实际用量显示未知）' }}</td></tr>
          </tbody></table>

          <div class="kp-section-title" style="margin-top:20px">命名空间（{{ detail.namespaces?.length || 0 }}）</div>
          <div class="kp-tag-row">
            <el-tag disable-transitions v-for="nsx in detail.namespaces || []" :key="nsx" size="small" effect="plain">{{ nsx }}</el-tag>
          </div>

          <div class="kp-section-title" style="margin-top:20px">节点状态</div>
          <el-table :data="detail.nodes || []" size="small" border stripe>
            <el-table-column prop="name" label="节点" min-width="120" />
            <el-table-column label="状态" width="95">
              <template #default="{ row: n }"><el-tag disable-transitions :type="n.ready ? 'success' : 'danger'" size="small">{{ n.ready ? 'Ready' : 'NotReady' }}</el-tag></template>
            </el-table-column>
            <el-table-column label="可调度" width="90"><template #default="{ row: n }">{{ n.unschedulable ? '否' : '是' }}</template></el-table-column>
            <el-table-column prop="version" label="Kubelet" width="110" />
            <el-table-column label="CPU 实际" width="110"><template #default="{row:n}">{{detail.metricsAvailable ? n.cpu : '—'}}</template></el-table-column><el-table-column label="CPU 容量 / 可分配" min-width="160"><template #default="{row:n}">{{n.capacity?.cpu || '—'}} / {{n.allocatable?.cpu || '—'}}</template></el-table-column>
            <el-table-column label="内存实际" width="110"><template #default="{row:n}">{{detail.metricsAvailable ? n.memory : '—'}}</template></el-table-column>
            <el-table-column label="授权范围内实际 Pod / 可分配" min-width="190"><template #default="{row:n}">{{n.pods ?? '—'}} / {{n.allocatable?.pods || '—'}}</template></el-table-column>
            <el-table-column prop="age" label="运行时间" width="100" />
          </el-table>

          <div class="kp-section-title" style="margin-top:20px">
            资源使用率 TOP 10
            <span v-if="top.timestamp" class="kp-muted" style="font-size:12px;font-weight:400;margin-left:8px">
              {{ clock(top.timestamp) }} 采样 · 共 {{ top.total }} 个 Pod 有指标
            </span>
          </div>
          <div v-loading="topLoading" style="min-height:72px">
            <el-alert v-if="!topLoading && !top.available" type="info" show-icon :closable="false"
              :title="top.message || '未安装 metrics-server，无法显示实时用量'" />
            <el-table v-else :data="top.items" size="small" border stripe empty-text="暂无指标数据">
              <el-table-column label="Pod" min-width="190" show-overflow-tooltip>
                <template #default="{ row: p }"><span class="kp-mono">{{ p.name }}</span></template>
              </el-table-column>
              <el-table-column prop="namespace" label="命名空间" width="135" show-overflow-tooltip />
              <el-table-column prop="cpuText" label="CPU 用量" width="105" align="right" />
              <el-table-column label="CPU 使用率" width="105" align="right">
                <template #default="{ row: p }">
                  <span :class="p.cpuPercent == null ? 'kp-muted' : p.cpuPercent >= 100 ? 'kp-danger' : 'kp-ok'">
                    {{ p.cpuPercent == null ? '—' : `${p.cpuPercent}%` }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column prop="memoryText" label="内存用量" width="105" align="right" />
              <el-table-column label="内存使用率" width="105" align="right">
                <template #default="{ row: p }">
                  <span :class="p.memoryPercent == null ? 'kp-muted' : p.memoryPercent >= 100 ? 'kp-danger' : 'kp-ok'">
                    {{ p.memoryPercent == null ? '—' : `${p.memoryPercent}%` }}
                  </span>
                </template>
              </el-table-column>
            </el-table>
            <p v-if="!topLoading && top.available && top.items.length" class="kp-muted" style="font-size:12px;margin:8px 0 0">
              用量来自 metrics-server（metrics.k8s.io）；使用率 = 用量 ÷ 该 Pod 声明的 requests，未声明 requests 显示「—」。
            </p>
          </div>

          <div class="kp-section-title" style="margin-top:20px">近期事件</div>
          <el-table :data="detail.events || []" size="small" border stripe max-height="240">
            <el-table-column label="类型" width="90">
              <template #default="{ row: ev }"><el-tag disable-transitions :type="ev.type === 'Warning' ? 'warning' : 'success'" size="small">{{ ev.type }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="namespace" label="命名空间" width="130" show-overflow-tooltip />
            <el-table-column prop="reason" label="原因" width="140" show-overflow-tooltip />
            <el-table-column prop="message" label="消息" min-width="220" show-overflow-tooltip />
            <el-table-column prop="age" label="时间" width="90" />
          </el-table>

          <div style="display:flex;gap:10px;margin-top:22px;flex-wrap:wrap">
            <el-button type="primary" @click="enter(detail)">进入控制台</el-button>
            <el-button @click="openDetail(detail)">刷新详情</el-button>
            <el-button @click="test(detail)">测试连接</el-button>
          </div>
        </template>
      </div>
      <template #footer><div class="cluster-detail-footer"><el-button v-if="detail?.removable && canRemove" type="danger" plain @click="remove(detail)">删除集群</el-button><span class="cluster-footer-spacer"/><el-button @click="detailVisible=false">关闭</el-button><el-button v-if="detail && canAdd" type="primary" @click="openEdit(detail)">编辑集群</el-button></div></template>
    </el-drawer>

    <el-dialog v-model="editVisible" title="编辑集群" width="min(720px,94vw)" top="6vh" destroy-on-close :close-on-click-modal="false" :close-on-press-escape="!editing" :show-close="!editing" @closed="editForm.kubeconfig=''">
      <el-form label-width="90px" @submit.prevent="submitEdit">
        <el-form-item label="集群名称"><el-input v-model="editForm.name" maxlength="120" :disabled="editing" /></el-form-item>
        <el-form-item label="连接配置"><el-input v-model="editForm.kubeconfig" type="textarea" :rows="12" spellcheck="false" :disabled="editing||!editTarget?.removable" :placeholder="editTarget?.removable?'留空保留现有连接配置；填写完整 kubeconfig 可替换凭据':'此集群的连接配置由外部管理'" /></el-form-item>
      </el-form>
      <p class="kp-muted">创建时间与集群授权保持不变；替换 kubeconfig 时须保留全部 context 名称。</p>
      <template #footer><el-button :disabled="editing" @click="editVisible=false">取消</el-button><el-button type="primary" :loading="editing" @click="submitEdit">保存修改</el-button></template>
    </el-dialog>

    <el-dialog v-model="addVisible" title="导入集群" width="720px" top="6vh" destroy-on-close>
      <el-alert type="info" :closable="false" style="margin-bottom:14px">
        <template #title>粘贴完整的 kubeconfig 内容</template>
        <template #default>
          支持内嵌证书 / Token / 单个或多个 context。内容会写入集群目录（权限 600），不会发送到任何第三方。
          使用 <code>exec:</code> 凭据插件的 kubeconfig 在容器内无法执行插件，请先转成 Token 形式。
        </template>
      </el-alert>
      <el-form label-width="90px">
        <el-form-item label="集群名称"><el-input v-model="form.name" placeholder="例如：生产集群 / prod-beijing" /></el-form-item>
        <el-form-item label="kubeconfig">
          <textarea v-model="form.kubeconfig" class="kp-yaml" style="min-height:280px" spellcheck="false"
            placeholder="apiVersion: v1&#10;kind: Config&#10;clusters:&#10;..." />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" :loading="adding" @click="submitAdd">校验并导入</el-button>
      </template>
    </el-dialog>
  </component>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Search, OfficeBuilding } from '@element-plus/icons-vue'
import api from '../api'
import { store } from '../store'
import { cpath } from '../utils/path'
import { can } from '../utils/perm'
import PlatformLayout from '../layout/PlatformLayout.vue'

const props = defineProps({ embedded: { type: Boolean, default: false } })
const router = useRouter()
const loading = ref(false)
const adding = ref(false)
const testing = ref('')
const addVisible = ref(false)
const clusters = ref([])
const canAdd = computed(() => can('cluster:import'))
const canRemove = computed(() => can('cluster:remove'))
const form = reactive({ name: '', kubeconfig: '' })
const editVisible = ref(false), editing = ref(false), editTarget = ref(null)
const editForm = reactive({ name: '', kubeconfig: '' })
const search = ref('')
const loadError = ref('')
const filteredClusters = computed(() => {
  const term = search.value.trim().toLowerCase()
  return clusters.value.filter(c => !term || [c.name, c.id].some(value => String(value || '').toLowerCase().includes(term)))
})
const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref(null)
const top = ref({ available: true, items: [], total: 0 })
const topLoading = ref(false)
let detailEpoch = 0
watch(detailVisible, visible => { if (!visible) detailEpoch++ }, { flush: 'sync' })

/** metrics-server 的时间戳转成本地时间 HH:mm:ss */
function clock(ts) {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('zh-CN', { hour12: false })
}

function createdTime(c) {
  const date = c.createdAt ? new Date(c.createdAt) : null
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '—'
}
function openEdit(c) { editTarget.value = { ...c }; editForm.name = c.name; editForm.kubeconfig = ''; editVisible.value = true }
async function submitEdit() {
  if (editing.value) return
  if (!editForm.name.trim()) return ElMessage.warning('请填写集群名称')
  const id = editTarget.value?.id
  if (!id) return
  editing.value = true
  try {
    const result = await api.updateCluster(id, { name: editForm.name.trim(), kubeconfig: editForm.kubeconfig })
    if ((result.affectedIds || [id]).includes(store.currentClusterId)) store.invalidateConnection()
    editVisible.value = false
    editForm.kubeconfig = ''
    if (detail.value?.id === id) detail.value.name = editForm.name.trim()
    ElMessage.success('集群已更新')
    await load(true)
    if (detailVisible.value && detail.value?.id === id) await openDetail(clusters.value.find(c => c.id === id) || detail.value)
  } catch (e) { /* 拦截器提示错误；失败时保留表单 */ }
  finally { editing.value = false }
}

async function load(force = false) {
  loading.value = true
  loadError.value = ''
  try {
    clusters.value = await store.loadClusters(force)
    return clusters.value
  } catch (e) {
    loadError.value = e.message || '加载集群列表失败'
    throw e
  }
  finally { loading.value = false }
}

function enter(c) {
  router.push(cpath('/overview', c.id))
}

/** 打开集群详情抽屉（平台级接口，不改变当前选中集群） */
async function openDetail(c) {
  const epoch = ++detailEpoch
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  top.value = { available: true, items: [], total: 0 }
  topLoading.value = true
  const topTask = api.topPods(c.id, 10)
    .then(r => { if (epoch === detailEpoch) top.value = r })
    .catch(e => { if (epoch === detailEpoch) top.value = { available: false, items: [], total: 0, message: e.message || '读取 metrics-server 失败' } })
    .finally(() => { if (epoch === detailEpoch) topLoading.value = false })
  try { const result = await api.clusterDetail(c.id); if (epoch === detailEpoch) detail.value = { ...c, ...result } }
  catch (e) { if (epoch === detailEpoch) detail.value = { ...c, error: e.message || '加载集群详情失败' } }
  finally { if (epoch === detailEpoch) detailLoading.value = false }
  await topTask
}

async function test(c) {
  testing.value = c.id
  try {
    const r = await api.testCluster(c.id)
    if (r.ok) ElMessage.success(`连接正常 · ${r.version}`)
    else ElMessage.error(`连接失败：${r.message}`)
    await load(true)
  } catch (e) { /* 拦截器已提示 */ }
  finally { testing.value = '' }
}

async function remove(c) {
  try {
    await ElMessageBox.confirm(
      `确定移除集群「${c.name}」吗？对应的 kubeconfig 文件也会被删除，此操作不可撤销。`,
      '危险操作', { type: 'warning', confirmButtonText: '确定移除', confirmButtonClass: 'el-button--danger' }
    )
    await api.removeCluster(c.id)
    detailVisible.value = false
    ElMessage.success('已移除')
    const wasCurrent = store.currentClusterId === c.id
    if (wasCurrent) store.setCluster('')
    try { await load(true) }
    catch (e) {
      if (wasCurrent) router.replace('/clusters')
      throw e
    }
    if (wasCurrent || !clusters.value.some(item => item.id === store.currentClusterId)) {
      const next = clusters.value[0]
      store.setCluster(next?.id || '')
      router.replace(next ? cpath('/overview', next.id) : '/clusters')
    }
  } catch (e) {
    if (e?.message && !/cancel|close/i.test(e.message)) ElMessage.error(e.message)
  }
}

function openAdd() { form.name = ''; form.kubeconfig = ''; addVisible.value = true }

async function submitAdd() {
  if (!form.name.trim()) return ElMessage.warning('请填写集群名称')
  if (!form.kubeconfig.trim()) return ElMessage.warning('请粘贴 kubeconfig 内容')
  adding.value = true
  try {
    const firstImport = !clusters.value.length
    const r = await api.addCluster(form.name.trim(), form.kubeconfig)
    ElMessage.success(`导入成功，新增 ${r.added} 个集群`)
    addVisible.value = false
    form.kubeconfig = ''
    await load(true)
    if (firstImport && clusters.value.length && !props.embedded) enter(clusters.value[0])
  } catch (e) { /* 拦截器已提示 */ }
  finally { adding.value = false }
}

onMounted(() => load(true).catch(() => {}))
</script>


<style scoped>
.cluster-detail-footer { display:flex;align-items:center;gap:10px;flex-wrap:wrap; }.cluster-footer-spacer { flex:1; }
.cluster-embedded { max-width: none; padding: 0; }
.cluster-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:18px; }
.cluster-toolbar h1 { margin:0; font-size:21px; font-weight:650; }
.cluster-toolbar-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
</style>
