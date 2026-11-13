<template>
  <div v-loading="loading">
    <div class="kp-toolbar">
      <el-button :icon="ArrowLeft" @click="$router.back()">返回</el-button>
      <span style="font-size: 15px;font-weight:600">{{ resourceTitle(meta) }} / {{ name }}</span>
      <el-tag disable-transitions :type="statusTag(row.status)" size="small">{{ row.status }}</el-tag>
      <span class="spacer" />
      <el-button v-if="meta.kind === 'Pod' && canUpdateRes && canDeleteRes" type="warning" plain :loading="restarting" @click="doRestartPod">重启 Pod</el-button>
      <el-button v-if="meta.kind === 'Pod' && can('pod:logs')" type="primary" plain @click="goLogs">查看日志</el-button>
      <el-button v-if="meta.kind === 'Pod' && can('pod:exec')" type="primary" plain @click="goTerminal">进入终端</el-button>
      <el-button v-if="['Pod','Deployment','StatefulSet','DaemonSet','ReplicaSet','Job','CronJob'].includes(meta.kind) && can('pod:files:read')" @click="filesVisible=true">文件浏览器</el-button>
      <el-button v-if="scalable && canUpdateRes" @click="doScale">扩缩容</el-button>
      <el-button v-if="restartable && canUpdateRes" @click="doRestart">重启</el-button>
      <el-button v-if="canUpdateRes&&policy.edit!=='none'" :disabled="meta.kind==='Secret'&&!can('secret:read')" @click="editForm">编辑</el-button>
      <el-button v-if="canDeleteRes" type="danger" plain @click="doDelete">删除</el-button>
    </div>

    <el-alert v-if="loadError" type="error" show-icon :closable="false" style="margin-bottom:14px">
      <template #title>加载资源失败：{{ resourceTitle(meta) }} / {{ name }}</template>
      <template #default>
        {{ loadError }}
        <el-button link type="primary" @click="load">重试</el-button>
        <el-button link type="primary" @click="$router.back()">返回列表</el-button>
      </template>
    </el-alert>

    <ResourceOperations v-if="!loadError && obj.metadata" :resource="obj" @changed="load" />
    <el-tabs v-if="!loadError" v-model="tab" type="border-card">
      <!-- 概览 -->
      <el-tab-pane label="概览" name="overview">
        <StorageDetails v-if="isStorage&&obj.metadata" :resource="obj" :cluster-id="store.currentClusterId" :cluster-name="store.currentCluster?.name" :events="events" :events-loading="eventsLoading" :events-error="eventsError"/>
        <div v-else class="kp-card" style="border:0">
          <div class="kp-section-title">基本信息</div>
          <table class="kp-kv"><tbody>
            <tr><td>名称</td><td class="kp-mono">{{ obj.metadata?.name }}</td></tr>
            <tr><td>命名空间</td><td>{{ obj.metadata?.namespace || '集群级' }}</td></tr>
            <tr><td>UID</td><td class="kp-mono">{{ obj.metadata?.uid }}</td></tr>
            <tr><td>创建时间</td><td>{{ fmtTime(obj.metadata?.creationTimestamp) }}（{{ ago(obj.metadata?.creationTimestamp) }}）</td></tr>
            <tr><td>API 版本</td><td class="kp-mono">{{ obj.apiVersion }} / {{ obj.kind }}</td></tr>
            <tr><td>资源版本</td><td class="kp-mono">{{ obj.metadata?.resourceVersion }}</td></tr>
            <tr v-if="meta.kind === 'Pod'"><td>Pod IP / 节点</td><td>{{ obj.status?.podIP || '-' }} / {{ obj.spec?.nodeName || '-' }}</td></tr>
            <tr v-if="meta.kind === 'Node'"><td>可调度</td><td>{{ obj.spec?.unschedulable ? '否（已封锁）' : '是' }}</td></tr>
            <tr v-if="meta.kind === 'Service'"><td>ClusterIP / 类型</td><td>{{ obj.spec?.clusterIP }} / {{ obj.spec?.type }}</td></tr>
          </tbody></table>

          <div class="kp-section-title" style="margin-top:22px">标签</div>
          <div class="kp-tag-row">
            <el-tag disable-transitions v-for="(v, k) in obj.metadata?.labels || {}" :key="k" size="small" effect="plain">{{ k }}={{ v }}</el-tag>
            <span v-if="!Object.keys(obj.metadata?.labels || {}).length" class="kp-muted">无</span>
          </div>

          <template v-if="Object.keys(obj.metadata?.annotations || {}).length">
            <div class="kp-section-title" style="margin-top:22px">注解</div>
            <table class="kp-kv"><tbody>
              <tr v-for="(v, k) in obj.metadata.annotations" :key="k"><td>{{ k }}</td><td class="kp-mono" style="word-break:break-all">{{ v }}</td></tr>
            </tbody></table>
          </template>

          <template v-if="containers.length">
            <div class="kp-section-title" style="margin-top:22px">容器</div>
            <el-table :data="containers" size="small" border>
              <el-table-column prop="name" label="容器名" min-width="140" />
              <el-table-column prop="image" label="镜像" min-width="240" show-overflow-tooltip />
              <el-table-column label="就绪" width="80">
                <template #default="{ row: c }"><el-tag disable-transitions :type="c.ready ? 'success' : 'danger'" size="small">{{ c.ready ? 'Yes' : 'No' }}</el-tag></template>
              </el-table-column>
              <el-table-column prop="restarts" label="重启次数" width="100" />
              <el-table-column prop="state" label="状态" min-width="130" />
            </el-table>
          </template>

          <template v-if="conditions.length">
            <div class="kp-section-title" style="margin-top:22px">条件 (Conditions)</div>
            <el-table :data="conditions" size="small" border>
              <el-table-column prop="type" label="类型" width="180" />
              <el-table-column label="状态" width="90">
                <template #default="{ row: c }"><el-tag disable-transitions :type="c.status === 'True' ? 'success' : 'warning'" size="small">{{ c.status }}</el-tag></template>
              </el-table-column>
              <el-table-column prop="reason" label="原因" width="180" />
              <el-table-column prop="message" label="说明" min-width="220" show-overflow-tooltip />
              <el-table-column prop="lastTransitionTime" label="变更时间" width="180" />
            </el-table>
          </template>
        </div>
      </el-tab-pane>

      <!-- 事件 -->
      <el-tab-pane label="事件" name="events">
        <el-table :data="events" size="small" border stripe v-loading="eventsLoading">
          <el-table-column label="类型" width="95">
            <template #default="{ row: e }"><el-tag disable-transitions :type="e.type === 'Warning' ? 'warning' : 'success'" size="small">{{ e.type }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="reason" label="原因" width="160" show-overflow-tooltip />
          <el-table-column prop="message" label="消息" min-width="300" show-overflow-tooltip />
          <el-table-column prop="count" label="次数" width="80" />
          <el-table-column label="时间" width="170"><template #default="{ row: e }">{{ fmtTime(e.lastTimestamp || e.eventTime) }}</template></el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 关联 Pod -->
      <el-tab-pane v-if="hasSelector" label="关联 Pod" name="pods">
        <el-table :data="childPods" size="small" border stripe v-loading="podsLoading" @row-dblclick="p => openPod(p)">
          <el-table-column prop="metadata.name" label="名称" min-width="220">
            <template #default="{ row: p }"><el-link type="primary" :underline="false" @click="openPod(p)">{{ p.metadata.name }}</el-link></template>
          </el-table-column>
          <el-table-column label="状态" width="130">
            <template #default="{ row: p }"><el-tag disable-transitions :type="statusTag(phaseOf('Pod', p))" size="small">{{ phaseOf('Pod', p) }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="status.podIP" label="Pod IP" width="140" />
          <el-table-column prop="spec.nodeName" label="节点" width="160" />
          <el-table-column label="创建时间" width="110"><template #default="{ row: p }">{{ ago(p.metadata.creationTimestamp) }}</template></el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Secret / ConfigMap 数据 -->
      <el-tab-pane v-if="isDataResource && (meta.kind !== 'Secret' || can('secret:read'))" label="数据" name="data">
        <el-alert v-if="meta.kind === 'Secret'" type="warning" :closable="false" style="margin-bottom:12px"
          title="Secret 默认遮蔽；仅拥有独立读取权限的账号可主动显示内容。" />
        <el-button v-if="meta.kind === 'Secret'" @click="secretRevealed = !secretRevealed">{{ secretRevealed ? '隐藏内容' : '显示 Secret 内容' }}</el-button>
        <table class="kp-kv"><tbody>
          <tr v-for="(v, k) in decodedData" :key="k">
            <td class="kp-mono">{{ k }}</td>
            <td><pre class="kp-mono" style="margin:0;white-space:pre-wrap;word-break:break-all">{{ meta.kind === 'Secret' && !secretRevealed ? '••••••••' : v }}</pre></td>
          </tr>
        </tbody></table>
        <div v-if="!Object.keys(decodedData).length" class="kp-empty">无数据</div>
      </el-tab-pane>
    </el-tabs>

    <SimpleResourceDialog v-model="simpleVisible" :meta="meta" :cluster-id="store.currentClusterId" :namespace="ns" :namespaces="store.namespaces" :target="{namespace:apiNs(),name}" @saved="load"/>
    <ContainerFilePicker v-model="filesVisible" :resource="obj" />
    <YamlDialog
      v-model="yamlDialogVisible" :title="`编辑 ${name}`" :content="yamlDialogText"
      :saving="yamlDialogSaving" :readonly="policy.yamlReadonly||!canUpdateRes" :preflight="preflightYaml" :target="yamlTarget" submit-label="保存"
      @save="saveYamlDialog"
    />

    <ScaleDialog
      v-model="scaleVisible" :name="name"
      :current="Number(obj.spec?.replicas ?? 0)" :saving="scaleSaving"
      @save="saveScale"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import * as yaml from 'js-yaml'
import api from '../api'
import { metaFromRoute, statusTag, CORE } from '../config/resources'
import { normalizeRow, phaseOf, ago, fmtTime } from '../config/columns'
import { cpath, nsPath } from '../utils/path'
import { can, canResource, canUpdate, canDelete } from '../utils/perm'
import { store } from '../store'
import { relatedPods, createRequestGate, targetDescription } from '../utils/resource'
import ResourceOperations from '../components/ResourceOperations.vue'
import ContainerFilePicker from '../components/ContainerFilePicker.vue'
import SimpleResourceDialog from '../components/SimpleResourceDialog.vue'
import {resourceUiPolicy} from '../utils/resource-policy'
import YamlDialog from '../components/YamlDialog.vue'
import ScaleDialog from '../components/ScaleDialog.vue'
import StorageDetails from '../components/StorageDetails.vue'
import {resourceTitle} from '../utils/resource-ui'

const route = useRoute()
const filesVisible=ref(false)
const router = useRouter()
const meta = computed(() => metaFromRoute(route.params, store.discovery))
const name = computed(() => route.params.name)
const ns = computed(() => route.params.namespace)
const scalable = computed(() => ['Deployment', 'StatefulSet', 'ReplicaSet'].includes(meta.value.kind))
const restartable = computed(() => ['Deployment', 'StatefulSet', 'DaemonSet'].includes(meta.value.kind))
const isDataResource = computed(() => ['Secret', 'ConfigMap'].includes(meta.value.kind))
const hasSelector = computed(() => ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'Service'].includes(meta.value.kind))

const isStorage=computed(()=>['PersistentVolumeClaim','PersistentVolume','StorageClass'].includes(meta.value.kind))
const eventsError=ref('')
const loading = ref(false)
const policy=computed(()=>resourceUiPolicy(meta.value)),simpleVisible=ref(false)
const canUpdateRes = computed(() => canResource(meta.value,'update',ns.value))
const canDeleteRes = computed(() => canResource(meta.value,'delete',ns.value))
const writable = computed(() => canUpdateRes.value)
const restarting = ref(false)
const yamlDialogVisible = ref(false)
const yamlDialogText = ref('')
const yamlDialogSaving = ref(false)
const scaleVisible = ref(false)
const scaleSaving = ref(false)
const obj = ref({})
const secretRevealed=ref(false)
const gate=createRequestGate()
const yamlTarget=computed(()=>targetDescription(store.currentCluster?.name || store.currentClusterId,ns.value,meta.value.kind,name.value))
const loadError = ref('')
const tab = ref('overview')
const events = ref([])
const eventsLoading = ref(false)
const childPods = ref([])
const podsLoading = ref(false)

const row = computed(() => normalizeRow(meta.value.kind, obj.value))
const containers = computed(() => {
  if (meta.value.kind !== 'Pod') return []
  const statuses = {}
  for (const c of obj.value.status?.containerStatuses || []) {
    const s = c.state || {}
    statuses[c.name] = {
      ready: !!c.ready, restarts: c.restartCount || 0,
      state: s.running ? 'Running' : s.waiting ? `Waiting(${s.waiting.reason})` : s.terminated ? `Terminated(${s.terminated.reason})` : 'Unknown',
    }
  }
  return (obj.value.spec?.containers || []).map(c => ({ name: c.name, image: c.image, ...(statuses[c.name] || { ready: false, restarts: 0, state: 'Unknown' }) }))
})
const conditions = computed(() => obj.value.status?.conditions || [])
const decodedData = computed(() => {
  const d = obj.value.data || {}
  const out = {}
  for (const [k, v] of Object.entries(d)) {
    if (meta.value.kind === 'Secret') {
      try {
        const bytes = Uint8Array.from(atob(v), c => c.charCodeAt(0))
        out[k] = new TextDecoder().decode(bytes)
      } catch (e) { out[k] = v }
    } else out[k] = v
  }
  for (const [k, v] of Object.entries(obj.value.stringData || {})) out[k] = v
  return out
})

function apiNs() { return nsPath(ns.value) }
function goLogs() { router.push(cpath(`/pods/${encodeURIComponent(ns.value)}/${encodeURIComponent(name.value)}/logs`)) }
function goTerminal() { router.push(cpath(`/pods/${encodeURIComponent(ns.value)}/${encodeURIComponent(name.value)}/terminal`)) }
function openPod(p) { router.push(cpath(`/r/${CORE}/v1/pods/${encodeURIComponent(p.metadata.namespace)}/${encodeURIComponent(p.metadata.name)}`)) }

async function load() {
  const request=gate.next()
  loading.value = true
  loadError.value = ''; obj.value={}; secretRevealed.value=false; childPods.value=[]; events.value=[]
  try {
    const data = await api.get(meta.value.group, meta.value.version, meta.value.plural, apiNs(), name.value)
    if (!gate.current(request)) return
    obj.value = data
    loadEvents(request)
    if (hasSelector.value) loadPods(request)
  } catch (e) {
    if (!gate.current(request)) return
    obj.value = {}
    loadError.value = e.status === 404
      ? '资源不存在或已被删除；也可能是命名空间/集群选择不正确。'
      : (e.message || '请求 API Server 失败')
  } finally { if (gate.current(request)) loading.value = false }
}

async function loadEvents(request) {
  eventsLoading.value = true;eventsError.value=''
  try {
    const params = { fieldSelector: `involvedObject.uid=${obj.value.metadata?.uid}` }
    const targetNs = obj.value.metadata?.namespace
    if (targetNs) params.namespace = targetNs
    const data = await api.list('', 'v1', 'events', params)
    if (!gate.current(request)) return
    events.value = (data.items || []).sort((a, b) => new Date(b.lastTimestamp || 0) - new Date(a.lastTimestamp || 0))
  } catch (e) { if (gate.current(request)) {events.value = [];eventsError.value=e.message||'事件加载失败'} }
  finally { eventsLoading.value = false }
}

async function listAll(group,version,plural,params) {
  let items=[],cursor=''
  do { const data=await api.list(group,version,plural,{...params,limit:500,...(cursor ? {continue:cursor} : {})}); items.push(...(data.items || [])); cursor=data.metadata?.continue || ''; } while(cursor)
  return items
}
async function loadPods(request) {
  podsLoading.value=true
  const resource=obj.value
  try {
    const params={namespace:resource.metadata?.namespace,clusterId:store.currentClusterId}
    const pods=await listAll('','v1','pods',params)
    const replicas=resource.kind==='Deployment' ? await listAll('apps','v1','replicasets',params) : []
    if (!gate.current(request)) return
    childPods.value=relatedPods(resource,pods,replicas)
  } catch(e) { if (gate.current(request)) { childPods.value=[]; ElMessage.error('关联 Pod 加载失败：'+e.message) } }
  finally { if (gate.current(request)) podsLoading.value=false }
}
async function preflightYaml(text) {
  const parsed=yaml.load(text)
  if (parsed?.metadata?.name!==name.value || (parsed.metadata.namespace || '_all')!==apiNs() || parsed.kind!==obj.value.kind || parsed.apiVersion!==obj.value.apiVersion) throw new Error('不能在编辑中更改目标资源身份')
  return api.update(meta.value.group,meta.value.version,meta.value.plural,apiNs(),name.value,parsed,{dryRun:true})
}

function editForm() { if(policy.value.edit==='none'||!canUpdateRes.value)return;if(policy.value.edit==='simple'){simpleVisible.value=true;return}if(policy.value.edit==='yaml'){editYaml();return}router.push(cpath(`/r/${route.params.group}/${route.params.version}/${route.params.plural}/${encodeURIComponent(apiNs())}/${encodeURIComponent(name.value)}/edit`)) }

/** 顶部「编辑 YAML」按钮：打开带导入/下载/全屏的编辑弹窗 */
function editYaml() {
  yamlDialogText.value = yaml.dump(obj.value, { noRefs: true, lineWidth: 120 })
  yamlDialogVisible.value = true
}
async function saveYamlDialog(text) {
  yamlDialogSaving.value = true
  try {
    const parsed = yaml.load(text)
    await api.update(meta.value.group, meta.value.version, meta.value.plural, apiNs(), name.value, parsed)
    ElMessage.success('保存成功')
    yamlDialogVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error(e.status===409 ? '资源已被其他操作修改。请保留编辑内容，重新读取最新版本并核对差异后提交。' : (e.message || '保存失败'))
  } finally { yamlDialogSaving.value = false }
}

async function doScale() {
  scaleVisible.value = true
}
async function saveScale(replicas) {
  scaleSaving.value = true
  try {
    await api.scale(meta.value.group, meta.value.version, meta.value.plural, apiNs(), name.value, replicas)
    ElMessage.success(`已扩缩容至 ${replicas} 副本`)
    scaleVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error(e.message || '扩缩容失败')
  } finally { scaleSaving.value = false }
}
async function doRestart() {
  try {
    await ElMessageBox.confirm('确定触发滚动重启吗？', '确认', { type: 'warning' })
    await api.restart(meta.value.group, meta.value.version, meta.value.plural, apiNs(), name.value)
    ElMessage.success('已触发重启'); await load()
  } catch (e) { if (e?.response) ElMessage.error(e.message) }
}
/** 重启 Pod：后端会检查 ownerReferences，确认由控制器重建后才删除 */
async function doRestartPod() {
  const target={clusterId:store.currentClusterId,namespace:ns.value,name:name.value,uid:obj.value.metadata?.uid,path:route.fullPath}
  const current=()=>store.currentClusterId===target.clusterId&&route.fullPath===target.path&&obj.value.metadata?.uid===target.uid
  if(!target.uid||!canUpdateRes.value||!canDeleteRes.value)return ElMessage.warning('请刷新资源并检查重启权限')
  try {
    await ElMessageBox.confirm(
      `重启 ${name.value} 将通过 Eviction 驱逐，并由有效控制器重建；PDB 或控制器状态可能阻止操作。确认继续？`,
      '重启 Pod', { type: 'warning', confirmButtonText: '确定重启' }
    )
  } catch (e) { return }
  if(!current()||!canUpdateRes.value||!canDeleteRes.value)return ElMessage.warning('资源或权限已变化，请重新选择')
  restarting.value = true
  try {
    const r = await api.restartPod(target.namespace,target.name,{uid:target.uid,clusterId:target.clusterId})
    if(r?.ok!==true)throw new Error('服务端未确认提交结果，请刷新核对')
    if(!current())return
    ElMessage.success(r.message || '已提交重启')
    // 删除后本详情页会变成 404，直接退回列表
    setTimeout(() => {if(current())router.back()}, 1000)
  } catch (e) {
    ElMessage.error(e.message || '重启失败')
  } finally { restarting.value = false }
}

async function doDelete() {
  try {
    await ElMessageBox.confirm(`确定删除 ${name.value} 吗？`, '危险操作', { type: 'warning', confirmButtonClass: 'el-button--danger' })
    await api.remove(meta.value.group, meta.value.version, meta.value.plural, apiNs(), name.value)
    ElMessage.success('删除成功'); router.back()
  } catch (e) { if (e?.response) ElMessage.error(e.message) }
}

watch(() => route.fullPath, load)
onMounted(load)
onUnmounted(()=>gate.invalidate())
</script>
