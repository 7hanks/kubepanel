<template>
  <div class="resource-list-page">
    <header class="resource-page-heading"><div class="resource-heading-title"><h1>{{resourceTitle(meta)}}</h1><el-tag size="small" effect="plain" type="info">{{filtered.length}} 项</el-tag></div><div class="resource-scope"><el-icon><component :is="'OfficeBuilding'"/></el-icon><span>{{store.currentCluster?.name||store.currentClusterId}}</span><span class="resource-scope-divider">/</span><el-icon><component :is="'Collection'"/></el-icon><span>{{store.namespace==='all'?'全部命名空间':store.namespace}}</span></div></header>
    <div class="resource-query-card"><div class="resource-query-field"><label>名称</label><el-input v-model="keyword" placeholder="按名称搜索" aria-label="资源名称筛选" clearable :prefix-icon="Search" @keyup.enter="load"/></div><div class="resource-query-field resource-query-date"><label>创建时间</label><el-date-picker v-model="createdRange" type="daterange" unlink-panels start-placeholder="开始日期" end-placeholder="结束日期" range-separator="至" aria-label="创建时间范围" clearable/></div><div class="resource-query-actions"><el-button type="primary" :icon="Search" :loading="loading" @click="load">查询</el-button><el-button @click="clearQuery">清空条件</el-button></div></div>
    <div class="resource-table-panel">
    <div v-if="meta.kind==='Service'" class="resource-type-tabs"><button type="button" :class="{active:!serviceType}" @click="serviceType=''">全部服务 <span>{{rows.length}}</span></button><button v-for="type in serviceTypes" :key="type" type="button" :class="{active:serviceType===type}" @click="serviceType=serviceType===type?'':type">{{type}} <span>{{rows.filter(row=>row.type===type).length}}</span></button></div>
    <div class="kp-toolbar resource-toolbar">
      <el-popover v-model:visible="filterOpen" trigger="click" placement="bottom-start" popper-class="resource-filter-popover" :width="560" :popper-style="{maxWidth:'calc(100vw - 32px)'}" @show="beginFilters">
        <template #reference><el-button :icon="Filter" :type="activeCount ? 'primary' : 'default'" :plain="!!activeCount" aria-label="筛选">筛选<span v-if="activeCount" class="filter-count">{{ activeCount }}</span></el-button></template>
        <el-form ref="filterFormRef" aria-label="资源筛选" label-position="top" @submit.prevent="applyFilters">
          <div class="filter-heading"><strong>资源筛选</strong><el-button text aria-label="关闭筛选" @click="filterOpen=false">关闭</el-button></div>
          <div class="resource-filter-grid">
            <el-form-item class="filter-wide" label="标签选择器">
              <el-input v-model="draft.labels" clearable aria-label="标签选择器" placeholder="app=nginx,env in (prod,qa),!debug" />
            </el-form-item>
            <el-form-item v-if="capabilities.state" :label="capabilities.pod ? '运行状态' : '状态'">
              <el-select v-model="draft.state" :append-to="filterFormRef?.$el || 'body'" :persistent="false" clearable aria-label="按状态筛选" placeholder="全部状态">
                <el-option v-if="capabilities.pod" label="活跃异常" value="active-abnormal" />
                <el-option label="全部异常（含历史）" value="abnormal" />
                <el-option v-for="state in states" :key="state" :label="state" :value="state" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="capabilities.pod" label="就绪状态">
              <el-select v-model="draft.ready" :append-to="filterFormRef?.$el || 'body'" :persistent="false" clearable aria-label="按就绪状态筛选" placeholder="全部就绪状态"><el-option label="Ready" value="ready"/><el-option label="未就绪" value="not-ready"/></el-select>
            </el-form-item>
            <el-form-item v-if="capabilities.reason" label="原因"><el-input v-model="draft.reason" clearable placeholder="原因包含" aria-label="按原因筛选" /></el-form-item>
            <el-form-item v-if="capabilities.node" label="节点">
              <el-select v-model="draft.node" :append-to="filterFormRef?.$el || 'body'" :persistent="false" filterable allow-create default-first-option clearable aria-label="按节点筛选" placeholder="选择或输入完整节点名"><el-option v-for="node in nodes" :key="node" :label="node" :value="node" /></el-select>
            </el-form-item>
            <el-form-item v-if="capabilities.owner" label="所属控制器"><el-input v-model="draft.owner" clearable placeholder="如 ReplicaSet/nginx" aria-label="按所属控制器筛选" /></el-form-item>
            <el-form-item v-if="capabilities.pod" label="最少重启次数"><el-input-number v-model="draft.minRestarts" :min="0" :precision="0" aria-label="最少重启次数" /></el-form-item>
            <el-form-item v-if="capabilities.image" label="镜像"><el-input v-model="draft.image" clearable placeholder="镜像名称或版本包含" aria-label="按镜像筛选" /></el-form-item>
            <el-form-item v-if="capabilities.pod" label="Pod 阶段"><el-select v-model="draft.phase" :append-to="filterFormRef?.$el || 'body'" :persistent="false" clearable aria-label="按阶段筛选" placeholder="全部阶段"><el-option v-for="phase in ['Pending','Running','Succeeded','Failed','Unknown']" :key="phase" :label="phase" :value="phase" /></el-select></el-form-item>
          </div>
          <div class="filter-footer"><el-button @click="resetFilters">重置</el-button><el-button type="primary" native-type="submit">应用筛选</el-button></div>
        </el-form>
      </el-popover>
      <el-button @click="load" :loading="loading"><el-icon><Refresh /></el-icon><span style="margin-left:5px">刷新</span></el-button>
      <div v-if="meta.kind==='Pod'" class="pod-list-summary"><span><i class="summary-dot running"/>运行中 <strong>{{rows.filter(row=>row.status==='Running').length}}</strong></span><span><i class="summary-dot warning"/>异常 <strong>{{rows.filter(row=>isAbnormal(row.status)&&!['Succeeded','Failed'].includes(row._raw?.status?.phase)).length}}</strong></span></div>
      <span class="spacer" />
      <el-tooltip :content="nextContinue ? `已加载 ${items.length} 项；当前筛选仅覆盖已加载资源，可继续加载。标签选择器由 Kubernetes 服务端执行。` : `已加载 ${items.length} 项；标签选择器由 Kubernetes 服务端执行，其他条件筛选已加载资源。`"><span class="resource-count">{{ filtered.length }} 项<span v-if="nextContinue"> · 已加载 {{ items.length }}</span></span></el-tooltip>
      <el-tooltip content="切换列表密度"><el-button aria-label="切换列表密度" @click="compactRows=!compactRows"><el-icon><component :is="'Operation'"/></el-icon></el-button></el-tooltip>
      <el-dropdown v-if="canCreateRes" split-button type="primary" trigger="click" @click="openCreate('form')" @command="openCreate">
        <el-icon aria-hidden="true"><Plus /></el-icon><span style="margin-left:5px">新建</span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="form">从表单创建</el-dropdown-item>
            <el-dropdown-item command="yaml">从 YAML 创建</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-button v-if="canBulkRestart" type="warning" plain :disabled="!selected.length" @click="openBulkRestart">批量重启 ({{ selected.length }})</el-button>
      <el-button v-if="canDeleteRes" type="danger" plain :disabled="!selected.length" @click="batchDelete">删除 ({{ selected.length }})</el-button>
    </div>

    <el-alert v-if="loadError" type="error" :closable="false" show-icon style="margin-bottom:12px"><template #title>{{ loadError }}</template><el-button @click="load">重试</el-button></el-alert>
    <div class="kp-card" style="padding:0">
      <el-table
        ref="tableRef" v-loading="loading" :data="paged" border stripe :size="compactRows?'small':'default'" row-key="uid"
        :expand-row-keys="isDeployment ? visibleDeploymentExpandedUids : undefined" :row-class-name="isDeployment ? 'deployment-expandable-row' : ''"
        style="width:100%" @sort-change="v => sort = v" @selection-change="v => selected = v"
        @row-click="toggleDeploymentDetails" @row-dblclick="openDetail" @expand-change="onDeploymentExpandChange"
      >
        <el-table-column type="selection" width="42" />
        <el-table-column v-if="isDeployment" type="expand" width="36" class-name="deployment-expand-column">
          <template #default="{ row }"><DeploymentRowDetails :resource="row._raw"/></template>
        </el-table-column>
        <el-table-column
          v-for="col in columns" :key="col.key" :prop="col.key" :label="col.label"
          :width="col.width" :min-width="col.minWidth" :class-name="col.key==='ports'&&meta.kind==='Service'?'resource-ports-column':''" sortable="custom" :show-overflow-tooltip="col.key!=='ports'&&col.key!=='images'"
        >
          <template #default="{ row }">
            <div v-if="col.link" class="resource-name-cell"><router-link :to="detailPath(row)">{{ row[col.key] }}</router-link></div>
            <el-tag v-else-if="meta.kind==='Service'&&col.key==='type'" :type="row.type==='NodePort'?'success':row.type==='LoadBalancer'?'warning':row.type==='ExternalName'?'info':'primary'" effect="light" size="small" class="service-type-tag">{{row.type}}</el-tag>
            <div v-else-if="meta.kind==='Service'&&col.key==='ports'" class="resource-port-chips"><span v-for="(port,index) in row._raw?.spec?.ports||[]" :key="index">{{servicePortLabel(port)}}</span></div>
            <div v-else-if="col.key==='images'" class="resource-image-cell"><span v-for="(name,index) in String(row.images||'—').split(', ')" :key="index">{{name}}</span></div>
            <el-tag disable-transitions v-else-if="col.tag" :type="statusTag(row[col.key])" size="small" effect="light">{{ row[col.key] }}</el-tag>
            <span v-else>{{ display(row[col.key]) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" :width="actionWidth" fixed="right" align="center">
          <template #default="{ row }">
            <div class="kp-list-actions">
              <ResourceActionButton @click="viewYaml(row)">YAML</ResourceActionButton>
              <ResourceActionButton v-if="canEditRes" :disabled="meta.kind==='Secret'&&!can('secret:read')" @click="editForm(row)">编辑</ResourceActionButton>
              <ResourceActionButton v-if="podActionLabel(row.namespace)"
                :class="{'pod-actions-combined': podActionLabel(row.namespace).length > 2}"
                @click="openRowPodAction(row)">{{ podActionLabel(row.namespace) }}</ResourceActionButton>
              <!-- teleport 到 body 避免被表格 overflow/fixed 列裁剪；右对齐，接近视口底部时由 popper flip 自动上翻 -->
              <el-dropdown
                trigger="click" placement="bottom-end" :teleported="true" popper-class="kp-row-actions"
                :popper-options="{ modifiers: [{ name: 'flip', options: { fallbackPlacements: ['top-end'] } }] }"
                @command="cmd => onCommand(cmd, row)"
              >
                <ResourceActionButton aria-label="更多操作" title="更多操作"><el-icon aria-hidden="true"><MoreFilled /></el-icon></ResourceActionButton>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-if="fileSupported&&can('pod:files:read')" command="files">文件浏览器</el-dropdown-item>
                    <el-dropdown-item v-if="isPod&&can('cluster:update')" command="scalePod" :disabled="!!podScaleAvailability(row)" :title="podScaleAvailability(row)">扩缩容</el-dropdown-item>
                    <el-dropdown-item v-if="scalable" command="scale" :disabled="!canUpdateRes">扩缩容</el-dropdown-item>
                    <el-dropdown-item v-if="restartable" command="restart" :disabled="!canUpdateRes">重启工作负载</el-dropdown-item>
                    <el-dropdown-item v-if="meta.kind === 'Node'" command="cordon" :disabled="!can('node:maintain') || !canUpdateRes">
                      {{ row.unschedulable ? '解除封锁 (uncordon)' : '封锁节点 (cordon)' }}
                    </el-dropdown-item>
                    <!-- 破坏性操作：分隔线分组 + 警示色，且均保留二次确认 -->
                    <el-dropdown-item v-if="meta.kind === 'Pod'" command="restartPod" divided class="kp-dd-danger"
                      :disabled="!canUpdateRes || !canDeleteRes">重启 Pod（受控驱逐）</el-dropdown-item>
                    <el-dropdown-item command="delete" :divided="meta.kind !== 'Pod'" class="kp-dd-danger"
                      :disabled="!canDeleteRes">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
        <template #empty><div class="kp-empty">{{ loadError ? '资源加载失败，请重试' : loading ? '正在加载资源…' : '当前筛选下没有资源' }}</div></template>
      </el-table>

      <div style="display:flex;justify-content:flex-end;gap:12px;padding:12px">
        <el-button v-if="nextContinue" :loading="loading" @click="loadMore">加载更多（已加载 {{ items.length }} 项）</el-button>
        <el-pagination
          v-model:current-page="page" v-model:page-size="pageSize" :total="filtered.length"
          :page-sizes="[20, 50, 100, 200]" layout="total, sizes, prev, pager, next" background
        />
      </div>
    </div>

    <SimpleResourceDialog v-model="simpleVisible" :meta="meta" :cluster-id="store.currentClusterId" :namespace="store.namespace==='all'?(store.namespaces[0]||'default'):store.namespace" :namespaces="store.namespaces" :target="simpleTarget" @saved="load"/>
    <PodScaleDialog v-model="podScaleVisible" :target="podScaleTarget" :context-key="bulkContextKey" @saved="load"/>
    <WorkloadPodPicker v-if="workloadPodTarget" :target="workloadPodTarget"
      :context-key="bulkContextKey" @close="workloadPodTarget=null" @select="openWorkloadPod" @update-image="openImageUpdate" />
    <DeploymentImageDialog v-if="imageTarget" :target="imageTarget" :context-key="bulkContextKey"
      @close="imageTarget=null" @saved="imageTarget=null; workloadPodTarget=null; load()" />
    <ContainerFilePicker v-model="filesVisible" :resource="filesResource" />
    <BulkPodRestartDialog v-model="bulkRestartVisible" :targets="bulkRestartTargets" :cluster-id="store.currentClusterId" :cluster-name="store.currentCluster?.name" :context-key="bulkContextKey" :can-restart="canRestartTarget" @submitted="load" />
    </div>
    <YamlDialog
      v-model="yamlVisible" :title="yamlTitle" :content="yamlText" :saving="saving"
      :readonly="(policy.yamlReadonly||!canUpdateRes) && yamlMode !== 'create'" :creating="yamlMode === 'create'" :preflight="preflightYaml" :target="yamlTarget" :mode="yamlDialogMode" :submit-label="yamlMode === 'create' ? '创建' : '保存'" @save="saveYaml"
    />

    <ScaleDialog
      v-model="scaleVisible" :name="scaleRow?.name || ''"
      :current="Number(scaleRow?._raw?.spec?.replicas ?? 0)" :saving="scaleSaving"
      @save="saveScale"
    />
  </div>
</template>

<script setup>
import { ref, shallowRef, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Filter, Plus, Refresh, MoreFilled } from '@element-plus/icons-vue'
import * as yaml from 'js-yaml'
import api from '../api'
import {registerUnsavedGuard} from '../utils/navigation'
import { store } from '../store'
import { metaFromRoute, statusTag } from '../config/resources'
import { normalizeRow, columnsFor, yamlTemplate } from '../config/columns'
import { cpath, nsPath } from '../utils/path'
import { can, canResource, canCreate, canUpdate, canDelete } from '../utils/perm'
import YamlDialog from '../components/YamlDialog.vue'
import ScaleDialog from '../components/ScaleDialog.vue'
import { filterRows, sortRows, createRequestGate, targetDescription, isAbnormal } from '../utils/resource'
import { normalizeFilters, filterCapabilities, activeFilterCount, filterQuery, filterQueryKeys } from '../utils/resource-filters'
import ResourceActionButton from '../components/ResourceActionButton.vue'
import ContainerFilePicker from '../components/ContainerFilePicker.vue'
import BulkPodRestartDialog from '../components/BulkPodRestartDialog.vue'
import {MAX_BULK_POD_RESTART} from '../utils/bulk-pod-restart'
import SimpleResourceDialog from '../components/SimpleResourceDialog.vue'
import {resourceUiPolicy} from '../utils/resource-policy'
import PodScaleDialog from '../components/PodScaleDialog.vue'
import DeploymentImageDialog from '../components/DeploymentImageDialog.vue'
import WorkloadPodPicker from '../components/WorkloadPodPicker.vue'
import DeploymentRowDetails from '../components/DeploymentRowDetails.vue'
import {resourceTitle,filterResourceRows,servicePortLabel,podScaleAvailability} from '../utils/resource-ui'

const route = useRoute()
const router = useRouter()
const meta = computed(() => metaFromRoute(route.params, store.discovery))
const policy=computed(()=>resourceUiPolicy(meta.value)),simpleVisible=ref(false),simpleTarget=shallowRef(null)
const columns = computed(() => columnsFor(meta.value.kind, meta.value.namespaced))
const scalable = computed(() => ['Deployment', 'StatefulSet', 'ReplicaSet'].includes(meta.value.kind))
const restartable = computed(() => ['Deployment', 'StatefulSet', 'DaemonSet'].includes(meta.value.kind))
const isDeployment = computed(() => meta.value.group === 'apps' && meta.value.version === 'v1' && meta.value.plural === 'deployments')
const isPod = computed(() => !meta.value.group && meta.value.version === 'v1' && meta.value.plural === 'pods')
const showPodActions = computed(() => isPod.value || isDeployment.value)
const showPodLogs = computed(() => showPodActions.value && can('pod:logs'))
const showPodTerminal = computed(() => showPodActions.value && can('pod:exec'))
const imageUpdateSupported = computed(() => isDeployment.value && (!meta.value.verbs || meta.value.verbs.includes('patch')))
const imageTarget = shallowRef(null)
const workloadPodTarget = shallowRef(null)
function canUpdateImages(namespace, clusterId = store.currentClusterId) {
  return imageUpdateSupported.value && canResource(meta.value, 'update', namespace, clusterId)
}
function openImageUpdate(container) {
  const selected = workloadPodTarget.value
  if (!selected?.imageUpdate || selected.context !== bulkContextKey.value || !canUpdateImages(selected.namespace, selected.clusterId)) return
  const { uid, name, namespace, clusterId, clusterName } = selected
  imageTarget.value = Object.freeze({ uid, name, namespace, clusterId, clusterName, container })
}
const fileSupported=computed(()=>['Pod','Deployment','StatefulSet','DaemonSet','ReplicaSet','Job','CronJob'].includes(meta.value.kind))
const filesVisible=ref(false),filesResource=shallowRef(null)
function openFiles(row){if(!can('pod:files:read'))return;const m=meta.value;filesResource.value={...row._raw,kind:m.kind,apiVersion:m.group?`${m.group}/${m.version}`:m.version};filesVisible.value=true}
const actionWidth = computed(() => showPodActions.value
  ? 132 + (canEditRes.value ? 56 : 0) + podActionWidth.value
  : canUpdateRes.value ? 200 : 135)
const podActionWidth = computed(() => {
  if (showPodLogs.value && showPodTerminal.value || imageUpdateSupported.value && can('cluster:update')) return 88
  return showPodLogs.value || showPodTerminal.value ? 56 : 0
})
const createdRange=ref([]),serviceType=ref(''),compactRows=ref(true),podScaleVisible=ref(false),podScaleTarget=shallowRef(null)
const serviceTypes=['ClusterIP','NodePort','LoadBalancer','ExternalName']
function openPodScale(row){if(!can('cluster:update')||podScaleAvailability(row))return;const md=row._raw?.metadata;if(!md?.uid)return ElMessage.warning('缺少 Pod UID，请刷新后重试');podScaleTarget.value={clusterId:store.currentClusterId,namespace:md.namespace,name:md.name,uid:md.uid};podScaleVisible.value=true}
function clearQuery(){keyword.value='';createdRange.value=[];serviceType.value='';resetFilters()}

const loading = ref(false)
const saving = ref(false)
const actionBusy=ref(false)
const removeContextGuard=registerUnsavedGuard(()=>{if(saving.value || scaleSaving.value || actionBusy.value){ElMessage.warning('操作进行中，请稍后切换上下文');return false}return true})
const canCreateRes = computed(() => policy.value.create!=='none'&&(!meta.value.verbs||meta.value.verbs.includes('create'))&&canResource(meta.value,'create',store.namespace,store.currentClusterId))
const canUpdateRes = computed(() => canResource(meta.value,'update',store.namespace))
const canEditRes = computed(() => canUpdateRes.value && policy.value.edit !== 'none')
const canDeleteRes = computed(() => canResource(meta.value,'delete',store.namespace))
const canBulkRestart = computed(() => meta.value.kind === 'Pod' && canUpdateRes.value && canDeleteRes.value)
const bulkRestartVisible=ref(false),bulkRestartTargets=shallowRef([])
const bulkContextKey=computed(()=>JSON.stringify([route.path,store.currentClusterId,store.namespace]))
function canRestartTarget(target){return canResource({group:'',plural:'pods',namespaced:true},'update',target.namespace,target.clusterId) && canResource({group:'',plural:'pods',namespaced:true},'delete',target.namespace,target.clusterId)}
function openBulkRestart(){
  if(!canBulkRestart.value || !selected.value.length)return
  if(selected.value.length>MAX_BULK_POD_RESTART)return ElMessage.warning(`一次最多重启 ${MAX_BULK_POD_RESTART} 个已选 Pod，请缩小选择范围`)
  bulkRestartTargets.value=selected.value.slice()
  bulkRestartVisible.value=true
}
const writable = computed(() => canCreateRes.value || canUpdateRes.value || canDeleteRes.value)
const items = ref([])
const tableRef = ref(null)
const loadError = ref('')
const nextContinue = ref('')
const gate = createRequestGate()
let controller
const filters = reactive(normalizeFilters(meta.value.kind, route.query))
const draft = reactive({...filters})
const filterOpen = ref(false)
// Keep nested dropdowns inside the popover but outside its scrolling grid.
// Tooltip Teleports mount before the form ref exists, so initially use body.
const filterFormRef = ref(null)
const capabilities = computed(() => filterCapabilities(meta.value.kind))
const activeCount = computed(() => activeFilterCount(filters))
const sort = ref({prop:'name',order:'ascending'})
const states = computed(()=>[...new Set([...(capabilities.value.pod ? ['Pending','Running','NotReady','CrashLoopBackOff','ImagePullBackOff','ErrImagePull','Succeeded','Failed','Evicted','Terminating','Unknown'] : []), ...rows.value.map(r=>r.status), filters.state, draft.state].filter(state => state && !['abnormal','active-abnormal'].includes(state)))])
const nodes = computed(()=>[...new Set(rows.value.map(r=>r.node).filter(node=>node && node!=='-'))].sort())
const yamlTarget = computed(()=>yamlContext.value?yamlContext.value.clusterId+' · '+targetDescription(yamlContext.value.clusterName,yamlContext.value.namespace,yamlContext.value.meta.kind,yamlContext.value.name):'')
const keyword = ref(filters.keyword)
const selected = ref([])
const page = ref(1)
const pageSize = ref(20)
const scaleVisible = ref(false)
const scaleRow = ref(null)
const scaleSaving = ref(false)

const yamlContext=shallowRef(null);let yamlReadEpoch=0,yamlReadController
const yamlVisible = ref(false)
const yamlText = ref('')
const yamlTitle = ref('')
const yamlMode = ref('create')
const yamlDialogMode = ref('edit')
const editingRow = shallowRef(null)

const rows = computed(() => items.value.map(i => normalizeRow(meta.value.kind, i)))
const filtered = computed(() => sortRows(filterResourceRows(filterRows(rows.value, {...filters,keyword:keyword.value}),{type:serviceType.value,createdRange:createdRange.value}),sort.value.prop,sort.value.order))
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const deploymentExpandedUids = ref([])
const visibleDeploymentExpandedUids = computed(() => paged.value.filter(row => deploymentExpandedUids.value.includes(row.uid)).map(row => row.uid))

function onDeploymentExpandChange(row, expandedRows) {
  if (!isDeployment.value || !Array.isArray(expandedRows)) return
  const expanded = new Set(deploymentExpandedUids.value)
  if (expandedRows.some(item => item.uid === row.uid)) expanded.add(row.uid)
  else expanded.delete(row.uid)
  deploymentExpandedUids.value = [...expanded]
}
function toggleDeploymentDetails(row, column, event) {
  if (!isDeployment.value || loading.value || !row.uid || ['selection','expand'].includes(column?.type)) return
  if (event?.target?.closest?.('a,button,input,select,textarea,label,[role="button"],[role="checkbox"],.el-dropdown,.kp-list-actions,.el-checkbox')) return
  tableRef.value?.toggleRowExpansion(row, !deploymentExpandedUids.value.includes(row.uid))
}
watch(bulkContextKey, () => { deploymentExpandedUids.value = [] }, { flush: 'sync' })

function display(v) {
  if (v === undefined || v === null || v === '') return '-'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
function nsParam() {
  if (!meta.value.namespaced) return undefined
  return store.namespace && store.namespace !== 'all' ? store.namespace : undefined
}

function clearSelection() { selected.value=[]; tableRef.value?.clearSelection() }
function beginFilters() { Object.assign(draft, filters) }
function syncQuery() {
  if (route.path !== listPath || route.params.clusterId !== store.currentClusterId) return
  const query={...route.query}
  for(const key of filterQueryKeys) delete query[key]
  Object.assign(query, filterQuery({...filters,keyword:keyword.value}))
  if(JSON.stringify(query)!==JSON.stringify(route.query)) router.replace({query})
}
function setFilters(next) {
  const labelsChanged=next.labels!==filters.labels
  Object.assign(filters,next)
  keyword.value=next.keyword
  page.value=1; clearSelection()
  if(labelsChanged) load()
}
function applyFilters() {
  setFilters(normalizeFilters(meta.value.kind,{...draft,keyword:keyword.value}))
  filterOpen.value=false
  syncQuery()
}
function resetFilters() {
  const empty=normalizeFilters(meta.value.kind,{keyword:keyword.value})
  Object.assign(draft,empty)
  setFilters(empty)
  filterOpen.value=false
  syncQuery()
}
async function fetchList(append=false) {
  controller?.abort(); controller=new AbortController()
  const request=gate.next()
  const m={...meta.value}
  const params={limit:200,clusterId:store.currentClusterId}
  const ns=nsParam(); if (ns) params.namespace=ns
  if (filters.labels) params.labelSelector=filters.labels
  if (append) params.continue=nextContinue.value
  loading.value=true; loadError.value=''; clearSelection(); if(!append)page.value=1
  if (!append) { items.value=[]; nextContinue.value='' }
  try {
    const data=await api.list(m.group,m.version,m.plural,params,{signal:controller.signal})
    if (!gate.current(request)) return
    items.value=append ? [...items.value,...(data.items || [])] : data.items || []
    if (isDeployment.value) {
      const existing = new Set(rows.value.map(row => row.uid))
      deploymentExpandedUids.value = deploymentExpandedUids.value.filter(uid => existing.has(uid))
    }
    nextContinue.value=data.metadata?.continue || data.continue || ''
  } catch(e) {
    if (gate.current(request) && !e.cancelled) loadError.value=e.status===403 ? '没有权限读取当前范围，请选择已授权命名空间。' : (e.message || '资源加载失败')
  } finally { if (gate.current(request)) loading.value=false }
}
function load() { return fetchList(false) }
function loadMore() { return fetchList(true) }

function detailPath(row) {
  const m = meta.value
  return cpath(`/r/${m.group || '_core'}/${m.version}/${m.plural}/${encodeURIComponent(nsPath(row.namespace))}/${encodeURIComponent(row.name)}`)
}
function openDetail(row) { router.push(detailPath(row)) }
const podMeta = { group: '', plural: 'pods', namespaced: true }
const replicaSetMeta = { group: 'apps', plural: 'replicasets', namespaced: true }
function canOpenPodView(mode, namespace, clusterId = store.currentClusterId) {
  return showPodActions.value && can(mode === 'terminal' ? 'pod:exec' : 'pod:logs') && canResource(podMeta, 'detail', namespace, clusterId)
    && (!isDeployment.value || canResource(replicaSetMeta, 'list', namespace, clusterId))
}
function podActionLabel(namespace) {
  const labels = [canOpenPodView('logs', namespace) && '日志', canOpenPodView('terminal', namespace) && '终端'].filter(Boolean)
  if (labels.length) return labels.join(' / ')
  return canUpdateImages(namespace) ? '更新镜像' : ''
}
function openPodView(mode, { clusterId, namespace, name, uid, container, shell }) {
  if (clusterId !== store.currentClusterId || !canOpenPodView(mode, namespace, clusterId)) return
  return router.push({
    name: mode === 'terminal' ? 'pod-terminal' : 'pod-logs',
    params: { clusterId, namespace, name },
    query: { uid, ...(container ? { container } : {}), ...(mode === 'terminal' && ['/bin/sh','/bin/bash'].includes(shell) ? { shell } : {}) },
  })
}
function openRowPodAction(row) {
  if (!showPodActions.value) return
  const { uid, name, namespace } = row._raw?.metadata || {}
  const clusterId = route.params.clusterId
  if (clusterId !== store.currentClusterId || route.path !== listPath) return
  if (!uid || !name || !namespace || !clusterId) return ElMessage.warning('资源信息不完整，请刷新列表后重试')
  const logs = canOpenPodView('logs', namespace, clusterId)
  const terminal = canOpenPodView('terminal', namespace, clusterId)
  const imageUpdate = canUpdateImages(namespace, clusterId)
  if (!logs && !terminal && !imageUpdate) return ElMessage.warning('当前账号没有可用的容器操作权限')
  workloadPodTarget.value = Object.freeze({ uid, name, namespace, clusterId, logs, terminal, imageUpdate,
    clusterName: store.currentCluster?.name || clusterId,
    kind: isPod.value ? 'Pod' : 'Deployment', context: bulkContextKey.value })
}
function openWorkloadPod({ mode, ...pod }) {
  const selected = workloadPodTarget.value
  if (selected?.context !== bulkContextKey.value || pod.namespace !== selected.namespace) return
  if (!canOpenPodView(mode, pod.namespace, selected.clusterId)) return
  workloadPodTarget.value = null
  return openPodView(mode, { ...pod, clusterId: selected.clusterId })
}

function openCreate(mode) {
  if (!canCreateRes.value) return
  yamlReadEpoch++
  yamlReadController?.abort()
  if (mode === 'yaml') {
    const namespace = nsParam()
    yamlContext.value = {
      context: bulkContextKey.value,
      clusterId: store.currentClusterId,
      clusterName: store.currentCluster?.name || store.currentClusterId,
      meta: { ...meta.value }, namespace, creating: true,
    }
    yamlMode.value = 'create'
    yamlDialogMode.value = 'edit'
    yamlTitle.value = '新建 ' + resourceTitle(meta.value)
    yamlText.value = yamlTemplate(meta.value, namespace)
    editingRow.value = null
    yamlVisible.value = true
    return
  }
  if (policy.value.create === 'simple') {
    simpleTarget.value = null
    simpleVisible.value = true
    return
  }
  router.push(cpath(`/r/${route.params.group}/${route.params.version}/${route.params.plural}/new`))
}
function editForm(row) { if(policy.value.edit==='none'||!canUpdateRes.value)return;if(policy.value.edit!=='yaml'){yamlReadEpoch++;yamlReadController?.abort()}if(policy.value.edit==='simple'){simpleTarget.value={namespace:nsPath(row.namespace),name:row.name};simpleVisible.value=true;return}if(policy.value.edit==='yaml')return openYaml(row,'edit');router.push(cpath(`/r/${route.params.group}/${route.params.version}/${route.params.plural}/${encodeURIComponent(row.namespace==='-'?'_all':row.namespace)}/${encodeURIComponent(row.name)}/edit`)) }

/** 点「YAML」默认只读查看；要改必须再点弹窗里的「编辑」 */
async function openYaml(row, mode) {
  const epoch=++yamlReadEpoch,context=bulkContextKey.value,m={...meta.value},clusterId=store.currentClusterId,namespace=nsPath(row.namespace),name=row.name
  yamlReadController?.abort();yamlReadController=new AbortController()
  try {
    const latest=await api.get(m.group,m.version,m.plural,namespace,name,{params:{clusterId},signal:yamlReadController.signal})
    if(epoch!==yamlReadEpoch||context!==bulkContextKey.value)return
    yamlContext.value={context,clusterId,clusterName:store.currentCluster?.name||clusterId,meta:m,namespace,name,uid:latest.metadata?.uid,resourceVersion:latest.metadata?.resourceVersion,creating:false}
    yamlMode.value='edit';yamlDialogMode.value=mode;yamlTitle.value=`${mode==='view'?'查看':'编辑'} ${name}`
    editingRow.value={...row,_raw:latest};yamlText.value=yaml.dump(latest,{noRefs:true,lineWidth:120});yamlVisible.value=true
  } catch(e){if(epoch===yamlReadEpoch&&!e.cancelled)ElMessage.error('无法读取最新版本，请重试：'+e.message)}
}
function viewYaml(row) { return openYaml(row, 'view') }

function yamlSubmission(text){
 const t=yamlContext.value,obj=yaml.load(text)
 if(!t||t.context!==bulkContextKey.value)throw new Error('目标上下文已变化，请重新打开资源')
 const m=t.meta
 if(!obj||!obj.metadata?.name)throw new Error('metadata.name 必填')
 if(obj.kind!==m.kind||obj.apiVersion!==(m.group?`${m.group}/${m.version}`:m.version))throw new Error('YAML 的 kind/apiVersion 与当前目标不一致')
 if(!t.creating&&(obj.metadata.name!==t.name||nsPath(obj.metadata.namespace)!==t.namespace))throw new Error('不能在编辑中更改资源名称或命名空间')
 if(!canResource(m,t.creating?'create':'update',obj.metadata.namespace,t.clusterId)||resourceUiPolicy(m).yamlReadonly)throw new Error('当前账号或资源不允许此操作')
 if(!t.creating){obj.metadata.uid=t.uid;obj.metadata.resourceVersion=t.resourceVersion}
 return {t,obj}
}
async function preflightYaml(text){const {t,obj}=yamlSubmission(text),m=t.meta;return t.creating?api.create(m.group,m.version,m.plural,obj.metadata.namespace,obj,{dryRun:true,clusterId:t.clusterId}):api.update(m.group,m.version,m.plural,t.namespace,t.name,obj,{dryRun:true,clusterId:t.clusterId})}
async function saveYaml(text) {
  saving.value = true
  try {
    const {t,obj}=yamlSubmission(text),m=t.meta
    if(t.creating)await api.create(m.group,m.version,m.plural,obj.metadata.namespace,obj,{clusterId:t.clusterId})
    else await api.update(m.group,m.version,m.plural,t.namespace,t.name,obj,{clusterId:t.clusterId})
    ElMessage.success(t.creating?'已提交创建':'保存成功')
    yamlVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error(e.status===409 ? '资源已变化或同名资源已存在。请重新读取，核对差异后提交；当前编辑内容已保留。' : (e.message || '保存失败'))
  } finally { saving.value = false }
}

async function saveScale(replicas) {
  const row = scaleRow.value
  if (!row) return
  scaleSaving.value = true
  try {
    const m = meta.value
    await api.scale(m.group, m.version, m.plural, nsPath(row.namespace), row.name, replicas)
    ElMessage.success(`已扩缩容至 ${replicas} 副本`)
    scaleVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error(e.message || '扩缩容失败')
  } finally { scaleSaving.value = false }
}

async function onCommand(cmd, row) {
  if(cmd==='files')return openFiles(row)
  if(cmd==='scalePod')return openPodScale(row)
  const m = meta.value
  const ns = nsPath(row.namespace)
  if (cmd==='cordon' ? !can('node:maintain') || !canUpdateRes.value : !writable.value) return ElMessage.warning('当前账号只有查看权限，不能执行该操作')
  try {
    if (cmd === 'restartPod') {
      const clusterId=store.currentClusterId,context=bulkContextKey.value
      const target={clusterId,namespace:row._raw?.metadata?.namespace,name:row._raw?.metadata?.name,uid:row._raw?.metadata?.uid}
      if(!target.uid || !target.namespace || !target.name)return ElMessage.warning('缺少 Pod 原始 UID，请刷新后重试')
      if(!canRestartTarget(target))return ElMessage.warning('没有此命名空间的更新和删除权限')
      await ElMessageBox.confirm(
        `重启 Pod ${row.name} 会通过 Eviction 驱逐，由有效控制器重建；PDB 或控制器状态可能阻止操作。确认继续？`,
        '重启 Pod', { type: 'warning', confirmButtonText: '确定重启' }
      )
      if(context!==bulkContextKey.value || !canRestartTarget(target))return ElMessage.warning('上下文或权限已变化，请重新选择 Pod')
      actionBusy.value=true
      let r
      try { r = await api.restartPod(target.namespace,target.name,{uid:target.uid,clusterId}) }
      finally { actionBusy.value=false }
      ElMessage.success(r.message || '已提交驱逐，请刷新核对替代 Pod 的就绪状态')
      return load()
    }
    if (cmd === 'scale') {
      scaleRow.value = row
      scaleVisible.value = true
      return
    } else if (cmd === 'restart') {
      await ElMessageBox.confirm(`确定重启 ${row.name} 吗？将触发滚动更新。`, '确认', { type: 'warning' })
      await api.restart(m.group, m.version, m.plural, ns, row.name)
      ElMessage.success('已触发重启')
    } else if (cmd === 'cordon') {
      const next = !row.unschedulable
      await ElMessageBox.confirm(`确定${next ? '封锁' : '解除封锁'}节点 ${row.name} 吗？`, '确认', { type: 'warning' })
      await api.cordon(row.name, next)
      ElMessage.success(next ? '节点已封锁，新的 Pod 将不再调度到此节点' : '节点已恢复调度')
    } else if (cmd === 'delete') {
      return deleteOne(row)
    }
    await load()
  } catch (e) {
    // ElMessageBox 取消时抛 'cancel' / 'close'，不应弹错误提示
    const cancelled = e === 'cancel' || e === 'close' || /cancel|close/i.test(e?.message || '')
    if (!cancelled) ElMessage.error(e?.message || '操作失败')
  }
}

async function deleteOne(row) {
  try {
    await ElMessageBox.confirm(`确定删除 ${meta.value.kind}/${row.name} 吗？此操作不可撤销。`, '危险操作', {
      type: 'warning', confirmButtonText: '确定删除', confirmButtonClass: 'el-button--danger',
    })
    const m = meta.value
    await api.remove(m.group, m.version, m.plural, nsPath(row.namespace), row.name)
    ElMessage.success('删除成功')
    await load()
  } catch (e) {
    if (!/cancel|close/i.test(e?.message || '') && e !== 'cancel' && e !== 'close') ElMessage.error(e?.message || '删除失败')
  }
}

async function batchDelete() {
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.length} 个资源吗？此操作不可撤销。`, '危险操作', {
      type: 'warning', confirmButtonText: '确定删除', confirmButtonClass: 'el-button--danger',
    })
    actionBusy.value=true
    const m = meta.value
    let ok = 0, fail = 0
    for (const row of selected.value) {
      try {
        await api.remove(m.group, m.version, m.plural, nsPath(row.namespace), row.name)
        ok++
      } catch (e) { fail++ }
    }
    ElMessage[fail ? 'warning' : 'success'](`删除完成：成功 ${ok}，失败 ${fail}`)
    await load()
  } catch (e) {
    if (!/cancel|close/i.test(e?.message || '') && e !== 'cancel' && e !== 'close') ElMessage.error(e?.message || '删除失败')
  } finally { actionBusy.value=false }
}

let queryTimer
const listPath=route.path
watch([createdRange,serviceType],()=>{page.value=1;clearSelection()},{deep:true})
watch(keyword, () => {
  page.value=1; clearSelection()
  clearTimeout(queryTimer)
  queryTimer=setTimeout(syncQuery,250)
})
watch([filters, pageSize, sort], () => { page.value=1; clearSelection() }, {deep:true})
watch(() => route.query, () => {
  if(route.path!==listPath) return
  const next=normalizeFilters(meta.value.kind,route.query)
  if(JSON.stringify(next)!==JSON.stringify({...filters,keyword:keyword.value})) setFilters(next)
})
watch([() => route.path, () => store.currentClusterId, () => store.namespace], () => {
  if (route.path !== listPath || route.params.clusterId !== store.currentClusterId || !store.ready) return
  yamlReadEpoch++;yamlReadController?.abort();yamlVisible.value=false;yamlContext.value=null
  clearTimeout(queryTimer)
  filterOpen.value=false;createdRange.value=[];serviceType.value=''
  Object.assign(filters,normalizeFilters(meta.value.kind,route.query))
  keyword.value=filters.keyword
  Object.assign(draft,filters)
  page.value=1; clearSelection(); load()
})
onMounted(() => {
  load()
  window.addEventListener('kp:refresh', load)
})
onUnmounted(() => { yamlReadEpoch++;yamlReadController?.abort();clearTimeout(queryTimer); removeContextGuard(); gate.invalidate(); controller?.abort(); window.removeEventListener('kp:refresh', load) })
</script>

<style scoped>
.resource-table-panel :deep(.deployment-expandable-row) { cursor: pointer; }
.resource-table-panel :deep(.deployment-expand-column .cell) { padding: 0; text-align: center; }
.resource-table-panel :deep(.deployment-expand-column .el-table__expand-icon) { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; margin: 0; color: var(--kp-muted); }
.resource-table-panel :deep(.deployment-expand-column .el-table__expand-icon:focus-visible) { outline: 2px solid var(--kp-brand); outline-offset: 1px; border-radius: 4px; }
.resource-table-panel :deep(td.el-table__expanded-cell) { padding: 0!important; cursor: default; }
.pod-actions-combined.kp-resource-action { inline-size: 80px }
.resource-toolbar { flex-wrap:nowrap; }
.resource-search { width:240px; min-width:130px; flex-shrink:1; }
.resource-count { color:var(--el-text-color-secondary); font-size:12px; white-space:nowrap; cursor:help; }
.filter-count { margin-left:6px; font-size:12px; min-width:16px; }
.filter-heading,.filter-footer { display:flex; align-items:center; justify-content:space-between; }
.filter-heading { margin-bottom:12px; }
.filter-footer { justify-content:flex-end; gap:8px; border-top:1px solid var(--el-border-color-lighter); padding-top:14px; }
.filter-footer .el-button + .el-button { margin-left:0; }
.resource-filter-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:0 16px; max-height:min(480px,max(120px,calc(100dvh - 260px))); overflow-y:auto; overscroll-behavior:contain; padding-right:4px; }
.resource-filter-grid .filter-wide { grid-column:1/-1; }
.resource-filter-grid :deep(.el-select),.resource-filter-grid :deep(.el-input-number) { width:100%; }
@media (max-width:700px) { .resource-toolbar { flex-wrap:wrap; } .resource-search { flex:1; } .resource-filter-grid { grid-template-columns:minmax(0,1fr); } }

.resource-page-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px}.resource-heading-title{display:flex;align-items:center;gap:12px}.resource-heading-title h1{font-size:22px;color:#304d73;letter-spacing:.01em;margin:0;font-weight:650}.resource-scope{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--kp-muted)}.resource-scope>.el-icon{font-size:15px}.resource-scope-divider{padding:0 8px;color:var(--kp-faint)}.resource-query-card{display:flex;align-items:center;gap:28px;flex-wrap:wrap;padding:18px 22px;background:var(--kp-surface);border:1px solid var(--kp-border);border-radius:12px;box-shadow:0 2px 5px rgba(22,40,70,.025);margin-bottom:18px}.resource-query-field{display:flex;align-items:center;gap:14px;min-width:250px;flex:1}.resource-query-field>label{font-size:13px;color:var(--kp-text-2);white-space:nowrap}.resource-query-field>.el-input{flex:1}.resource-query-date{flex:1.2;min-width:330px}.resource-query-date :deep(.el-date-editor){width:100%;min-width:0}.resource-query-actions{display:flex;gap:8px;margin-left:auto}.resource-query-actions .el-button+.el-button{margin:0}.resource-table-panel{background:var(--kp-surface);border:1px solid var(--kp-border);border-radius:12px;padding:18px 18px 2px;box-shadow:0 2px 5px rgba(22,40,70,.025)}.resource-type-tabs{display:flex;gap:8px;flex-wrap:wrap;padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid var(--kp-border)}.resource-type-tabs>button{display:flex;align-items:center;gap:9px;background:transparent;border:1px solid transparent;color:var(--kp-text-2);font:inherit;font-size:13px;padding:8px 13px;border-radius:8px;cursor:pointer}.resource-type-tabs>button>span{font-size:12px;background:var(--kp-surface-2);padding:1px 7px;border-radius:5px}.resource-type-tabs>button.active{background:var(--kp-side-active);border-color:#dce7f6;color:var(--kp-brand);font-weight:600}.resource-type-tabs>button.active>span{background:var(--kp-surface)}.resource-table-panel>.kp-card{border-radius:8px;box-shadow:none;border:0}.pod-list-summary{display:flex;gap:16px;font-size:12px;color:var(--kp-muted);white-space:nowrap}.pod-list-summary>span{display:flex;align-items:center;gap:6px}.pod-list-summary strong{color:var(--kp-text);font-weight:600}.summary-dot{display:inline-block;width:6px;height:6px;border-radius:50%}.summary-dot.running{background:#16a36b}.summary-dot.warning{background:#d68b24}.resource-name-cell{display:flex;align-items:flex-start;flex-direction:column;gap:4px}.resource-port-chips{display:flex;flex-direction:column;align-items:flex-start;gap:6px;white-space:normal}.resource-port-chips>span{display:inline-block;background:var(--kp-success-bg);color:var(--el-color-success);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;padding:3px 7px;border-radius:5px;white-space:normal;overflow-wrap:anywhere;line-height:1.5}.service-type-tag{font-weight:600;letter-spacing:.01em}.resource-image-cell{display:flex;flex-wrap:wrap;align-items:center;gap:5px;min-width:0;font-size:inherit;line-height:inherit}.resource-image-cell>span{max-width:100%;white-space:normal;overflow-wrap:anywhere;background:var(--kp-success-bg);border:1px solid transparent;border-radius:4px;padding:2px 7px;color:var(--el-color-success)}.resource-table-panel :deep(.resource-ports-column .cell){white-space:normal;overflow:visible}.resource-toolbar{gap:9px;margin-bottom:16px}.resource-toolbar>.el-button+.el-button{margin:0}.resource-table-panel :deep(.el-table th.el-table__cell){background:#f7f9fc}.resource-table-panel :deep(.el-table--small td.el-table__cell){padding:8px 0}.resource-table-panel :deep(.el-table:not(.el-table--small) td.el-table__cell){padding:14px 0}
@media(max-width:1000px){.resource-query-card{gap:16px}.resource-query-field{min-width:220px}.resource-query-date{min-width:280px}.resource-query-actions{margin-left:0}.pod-list-summary{display:none}}
@media(max-width:700px){.resource-page-heading{margin-bottom:14px;gap:10px}.resource-heading-title h1{font-size:19px}.resource-scope{font-size:12px}.resource-query-card{padding:14px;gap:12px}.resource-query-field,.resource-query-date{min-width:0;flex:1 1 100%}.resource-query-field>label{width:56px;flex:none}.resource-query-actions{justify-content:flex-end;width:100%}.resource-table-panel{padding:12px 10px 2px}.resource-toolbar{flex-wrap:wrap}.resource-type-tabs{gap:3px}.resource-type-tabs>button{font-size:11px;padding:7px 8px}.resource-type-tabs>button>span{padding:0 5px}.resource-count{display:none}}
</style>
