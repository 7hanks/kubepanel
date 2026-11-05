<template>
  <PlatformLayout active="clusters">
    <template #actions>
      <el-button size="small" :loading="loading" circle @click="load(true)"><el-icon><Refresh /></el-icon></el-button>
    </template>

    <main class="cluster-main">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:18px">
        <div>
          <h1 style="margin:0;font-size:22px;font-weight:650">集群列表</h1>
          <p class="kp-muted" style="margin:6px 0 0;font-size:13px">选择一个集群进入控制台；也可以导入新的 kubeconfig 纳管更多集群</p>
        </div>
        <el-button type="primary" :icon="Plus" @click="openAdd">导入集群</el-button>
      </div>

      <div class="kp-stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <div class="kp-stat"><div class="label">集群总数</div><div class="value">{{ clusters.length }}</div></div>
        <div class="kp-stat"><div class="label">连接正常</div><div class="value kp-ok">{{ healthyCount }}</div></div>
        <div class="kp-stat"><div class="label">连接异常</div><div class="value" :class="clusters.length - healthyCount ? 'kp-danger' : ''">{{ clusters.length - healthyCount }}</div></div>
      </div>

      <div v-loading="loading">
        <div v-if="!clusters.length && !loading" class="kp-card" style="text-align:center;padding:56px 20px">
          <el-icon style="font-size:44px;color:#9ca3af"><OfficeBuilding /></el-icon>
          <p style="font-size:16px;font-weight:600;margin:14px 0 6px">还没有纳管任何集群</p>
          <p class="kp-muted" style="margin:0 0 18px;font-size:13px">
            点「导入集群」粘贴 kubeconfig，或把 kubeconfig 文件放进服务器的集群目录后刷新
          </p>
          <el-button type="primary" @click="openAdd">导入第一个集群</el-button>
        </div>

        <div v-else class="cluster-grid">
          <div v-for="c in clusters" :key="c.id" class="kp-card cluster-card">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
                <div style="min-width:0">
                  <div style="display:flex;align-items:center;gap:8px">
                    <span class="status-dot" :class="c.healthy ? 'ok' : 'bad'" />
                    <h3 class="cluster-name" style="margin:0;font-size:16px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" @click="openDetail(c)">{{ c.name }}</h3>
                  </div>
                  <div class="kp-mono kp-muted" style="margin-top:6px;font-size:12px;word-break:break-all">{{ c.server }}</div>
                </div>
                <el-tag :type="c.healthy ? 'success' : 'danger'" size="small" effect="light">{{ c.healthy ? '正常' : '异常' }}</el-tag>
              </div>

              <el-divider style="margin:14px 0" />

              <table class="kp-kv" style="font-size:12.5px">
                <tr><td>K8s 版本</td><td class="kp-mono">{{ c.version }}</td></tr>
                <tr><td>节点 / 命名空间</td><td>{{ c.nodes ?? '-' }} / {{ c.namespaces ?? '-' }}</td></tr>
                <tr><td>认证方式</td><td>{{ c.authMode }}</td></tr>
                <tr><td>Context</td><td class="kp-mono" style="word-break:break-all">{{ c.context || '-' }}</td></tr>
                <tr><td>来源</td><td class="kp-mono">{{ c.source }}</td></tr>
              </table>

              <div v-if="c.error" class="kp-danger" style="font-size:12px;margin-top:10px;word-break:break-all">{{ c.error }}</div>

              <div style="display:flex;gap:8px;margin-top:16px">
                <el-button type="primary" style="flex:1" :disabled="!c.healthy" @click="enter(c)">进入控制台</el-button>
                <el-button @click="openDetail(c)">详情</el-button>
                <el-button :loading="testing === c.id" @click="test(c)">测试</el-button>
                <el-button v-if="c.removable" type="danger" plain @click="remove(c)"><el-icon><Delete /></el-icon></el-button>
              </div>
            </div>
        </div>
      </div>

      <p class="kp-muted" style="font-size:12px;margin-top:8px">
        凭据保存在容器挂载目录 <code>{{ clustersDirHint }}</code>，界面导入的集群重启后不会丢失；只读挂载时只能查看，不能导入或删除。
      </p>
    </main>

    <!-- 集群详情抽屉：点卡片名称或「详情」按钮打开，不影响当前选中的集群 -->
    <el-drawer v-model="detailVisible" :title="`集群详情 · ${detail?.name || ''}`" size="62%" destroy-on-close>
      <div v-loading="detailLoading">
        <el-alert v-if="detail?.error" type="error" show-icon :closable="false" :title="detail.error" />

        <template v-if="detail && !detail.error">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
            <span class="status-dot ok" />
            <strong style="font-size:16px">{{ detail.name }}</strong>
            <el-tag type="success" size="small">连接正常</el-tag>
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
          <table class="kp-kv">
            <tr><td>集群 ID</td><td class="kp-mono">{{ detail.id }}</td></tr>
            <tr><td>API Server</td><td class="kp-mono">{{ detail.server }}</td></tr>
            <tr><td>K8s 版本</td><td>{{ detail.version }}</td></tr>
            <tr><td>平台</td><td>{{ detail.platform }}</td></tr>
            <tr><td>Context</td><td class="kp-mono">{{ detail.context }}</td></tr>
            <tr><td>认证方式</td><td>{{ detail.authMode }}</td></tr>
            <tr><td>凭据来源</td><td class="kp-mono">{{ detail.source }}</td></tr>
            <tr><td>API 资源类型</td><td>{{ detail.resourceTypes }}</td></tr>
            <tr><td>可在界面移除</td><td>{{ detail.removable ? '是' : '否（环境变量 / ServiceAccount / 只读挂载）' }}</td></tr>
            <tr><td>metrics-server</td><td>{{ detail.metricsAvailable ? '已安装（显示实时用量）' : '未安装（显示容量配额）' }}</td></tr>
          </table>

          <div class="kp-section-title" style="margin-top:20px">命名空间（{{ detail.namespaces?.length || 0 }}）</div>
          <div class="kp-tag-row">
            <el-tag v-for="nsx in detail.namespaces || []" :key="nsx" size="small" effect="plain">{{ nsx }}</el-tag>
          </div>

          <div class="kp-section-title" style="margin-top:20px">节点状态</div>
          <el-table :data="detail.nodes || []" size="small" border stripe>
            <el-table-column prop="name" label="节点" min-width="120" />
            <el-table-column label="状态" width="95">
              <template #default="{ row: n }"><el-tag :type="n.ready ? 'success' : 'danger'" size="small">{{ n.ready ? 'Ready' : 'NotReady' }}</el-tag></template>
            </el-table-column>
            <el-table-column label="可调度" width="90"><template #default="{ row: n }">{{ n.unschedulable ? '否' : '是' }}</template></el-table-column>
            <el-table-column prop="version" label="Kubelet" width="110" />
            <el-table-column prop="cpu" label="CPU" width="110" />
            <el-table-column prop="memory" label="内存" width="110" />
            <el-table-column prop="pods" label="Pod 配额" width="100" />
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
              <template #default="{ row: ev }"><el-tag :type="ev.type === 'Warning' ? 'warning' : 'success'" size="small">{{ ev.type }}</el-tag></template>
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
    </el-drawer>

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
  </PlatformLayout>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Delete, OfficeBuilding } from '@element-plus/icons-vue'
import api from '../api'
import { store } from '../store'
import { cpath } from '../utils/path'
import PlatformLayout from '../layout/PlatformLayout.vue'

const router = useRouter()
const loading = ref(false)
const adding = ref(false)
const testing = ref('')
const addVisible = ref(false)
const clusters = ref([])
const username = localStorage.getItem('kp_user') || 'admin'
const form = reactive({ name: '', kubeconfig: '' })
const clustersDirHint = '/app/kube/clusters'
const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref(null)
const top = ref({ available: true, items: [], total: 0 })
const topLoading = ref(false)

/** metrics-server 的时间戳转成本地时间 HH:mm:ss */
function clock(ts) {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('zh-CN', { hour12: false })
}

const healthyCount = computed(() => clusters.value.filter(c => c.healthy).length)

async function load(force = false) {
  loading.value = true
  try { clusters.value = await api.clusters(force) }
  catch (e) { clusters.value = [] }
  finally { loading.value = false }
}

function enter(c) {
  store.setCluster(c.id)
  router.push(cpath('/overview', c.id))
}

/** 打开集群详情抽屉（平台级接口，不改变当前选中集群） */
async function openDetail(c) {
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  top.value = { available: true, items: [], total: 0 }
  topLoading.value = true
  const topTask = api.topPods(c.id, 10)
    .then(r => { top.value = r })
    .catch(e => { top.value = { available: false, items: [], total: 0, message: e.message || '读取 metrics-server 失败' } })
    .finally(() => { topLoading.value = false })
  try { detail.value = await api.clusterDetail(c.id) }
  catch (e) { detail.value = { name: c.name, error: e.message || '加载集群详情失败' } }
  finally { detailLoading.value = false }
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
    ElMessage.success('已移除')
    if (store.currentClusterId === c.id) store.setCluster('')
    await load(true)
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
    const r = await api.addCluster(form.name.trim(), form.kubeconfig)
    ElMessage.success(`导入成功，新增 ${r.added} 个集群`)
    addVisible.value = false
    await load(true)
  } catch (e) { /* 拦截器已提示 */ }
  finally { adding.value = false }
}

onMounted(() => load(true))
</script>

