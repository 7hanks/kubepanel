<template>
  <div>
    <section class="kp-card resource-query-card">
      <el-form ref="filterFormRef" aria-label="资源查询" label-position="left" @submit.prevent="applyFilters">
        <div class="resource-query-row">
          <el-form-item label="名称" class="query-name"><el-input v-model="keyword" aria-label="资源名称" placeholder="请输入名称" clearable :prefix-icon="Search" /></el-form-item>
          <el-form-item label="创建时间" class="query-date"><el-date-picker v-model="creationRange" aria-label="创建时间范围" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" unlink-panels /></el-form-item>
          <div class="resource-query-actions">
            <el-button type="primary" :icon="Search" native-type="submit">查询</el-button>
            <el-button @click="resetFilters">重置</el-button>
            <el-button link type="primary" :aria-expanded="filterOpen" aria-controls="resource-advanced-filters" @click="filterOpen=!filterOpen">{{ filterOpen ? '收起' : '展开' }}<span v-if="activeCount" class="filter-count">({{ activeCount }})</span><el-icon><ArrowUp v-if="filterOpen"/><ArrowDown v-else/></el-icon></el-button>
          </div>
        </div>
          <div v-show="filterOpen" id="resource-advanced-filters" class="resource-filter-grid" role="group" aria-label="资源筛选">
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
        </el-form>
    </section>

    <el-alert v-if="loadError" type="error" :closable="false" show-icon style="margin-bottom:12px"><template #title>{{ loadError }}</template><el-button @click="load">重试</el-button></el-alert>
    <div class="kp-card resource-table-card">
      <div class="kp-toolbar resource-toolbar">
        <el-button v-if="canCreateRes" type="primary" :icon="Plus" :disabled="actionBusy" @click="openCreate">新建</el-button>
        <el-button v-if="canDeleteRes" type="danger" plain :disabled="!selected.length || actionBusy" @click="batchDelete">删除 ({{ selected.length }})</el-button>
        <el-button v-if="restartable && canUpdateRes" plain :disabled="!selected.length || actionBusy" :loading="actionBusy && batchOperation === 'restart'" @click="batchRestart">批量重启 ({{ selected.length }})</el-button>
        <span class="spacer" />
        <el-tooltip :content="nextContinue ? `已加载 ${items.length} 项；当前筛选仅覆盖已加载资源，可继续加载。标签选择器由 Kubernetes 服务端执行。` : `已加载 ${items.length} 项；标签选择器由 Kubernetes 服务端执行，其他条件筛选已加载资源。`"><span class="resource-count">{{ filtered.length }} 项<span v-if="nextContinue"> · 已加载 {{ items.length }}</span></span></el-tooltip>
        <el-button :icon="Refresh" :loading="loading" :disabled="actionBusy" @click="load">刷新</el-button>
      </div>
      <div v-if="batchResults.length" class="resource-batch-results" role="status" aria-label="批量操作结果">
        <div class="batch-results-heading"><strong>{{ batchResultTitle }}</strong><el-button link @click="batchResults=[]">清除结果</el-button></div>
        <div v-for="result in batchResults" :key="result.name"><el-tag :type="result.ok ? 'success' : 'danger'" size="small">{{ result.ok ? '成功' : '失败' }}</el-tag><span>{{ result.name }}</span><span>{{ result.message }}</span></div>
      </div>
      <el-table
        ref="tableRef" v-loading="loading" :data="paged" row-key="uid"
        style="width:100%" @sort-change="v => sort = v" @selection-change="v => selected = v" @row-dblclick="openDetail"
      >
        <el-table-column type="selection" width="42" :selectable="() => !actionBusy" />
        <el-table-column type="expand" width="36"><template #default="{ row }">
          <div class="resource-row-details">
            <div><span>创建时间</span>{{ row.created }}</div><div><span>UID</span>{{ row.uid }}</div>
            <div v-if="row.owner && row.owner !== '-'"><span>所属控制器</span>{{ row.owner }}</div>
            <div v-if="row.reason && row.reason !== '-'"><span>原因</span>{{ row.reason }}</div>
            <div class="detail-labels"><span>标签</span><template v-if="Object.keys(row._raw?.metadata?.labels || {}).length"><el-tag v-for="(value,key) in row._raw.metadata.labels" :key="key" size="small" effect="plain">{{ key }}={{ value }}</el-tag></template><template v-else>无</template></div>
          </div>
        </template></el-table-column>
        <el-table-column
          v-for="col in columns" :key="col.key" :prop="col.key" :label="col.label"
          :width="col.width" :min-width="col.minWidth" sortable="custom" show-overflow-tooltip
        >
          <template #default="{ row }">
            <router-link v-if="col.link" :to="detailPath(row)">{{ row[col.key] }}</router-link>
            <el-tag disable-transitions v-else-if="col.tag" :type="statusTag(row[col.key])" size="small" effect="light">{{ row[col.key] }}</el-tag>
            <span v-else>{{ display(row[col.key]) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" :width="actionWidth" fixed="right" align="center">
          <template #default="{ row }">
            <div class="kp-list-actions">
              <ResourceActionButton v-if="canAccessContainers" :disabled="actionBusy" @click="openAccess(row)">日志/终端</ResourceActionButton>
              <ResourceActionButton v-if="canUpdateRes" :disabled="actionBusy" @click="editYaml(row)">编辑</ResourceActionButton>
              <ResourceActionButton @click="viewYaml(row)">YAML</ResourceActionButton>
              <ResourceActionButton v-if="canDeleteRes" type="danger" :disabled="actionBusy" @click="deleteOne(row)">删除</ResourceActionButton>
              <!-- teleport 到 body 避免被表格 overflow/fixed 列裁剪；右对齐，接近视口底部时由 popper flip 自动上翻 -->
              <el-dropdown
                v-if="scalable || restartable || ['Node','Pod'].includes(meta.kind)"
                trigger="click" placement="bottom-end" :teleported="true" popper-class="kp-row-actions"
                :popper-options="{ modifiers: [{ name: 'flip', options: { fallbackPlacements: ['top-end'] } }] }"
                @command="cmd => onCommand(cmd, row)"
              >
                <ResourceActionButton aria-label="更多操作" title="更多操作"><el-icon aria-hidden="true"><MoreFilled /></el-icon></ResourceActionButton>
                <template #dropdown>
                  <el-dropdown-menu>
                    <!-- 普通操作：低频、非破坏性（行内四入口已覆盖的高频动作不在此重复） -->
                    <el-dropdown-item v-if="scalable" command="scale" :disabled="!canUpdateRes">扩缩容</el-dropdown-item>
                    <el-dropdown-item v-if="restartable" command="restart" :disabled="!canUpdateRes">重启工作负载</el-dropdown-item>
                    <el-dropdown-item v-if="meta.kind === 'Node'" command="cordon" :disabled="!can('node:maintain') || !canUpdateRes">
                      {{ row.unschedulable ? '解除封锁 (uncordon)' : '封锁节点 (cordon)' }}
                    </el-dropdown-item>
                    <!-- 破坏性操作：分隔线分组 + 警示色，且均保留二次确认 -->
                    <el-dropdown-item v-if="meta.kind === 'Pod'" command="restartPod" divided class="kp-dd-danger"
                      :disabled="!canUpdateRes || !canDeleteRes">重启 Pod（受控驱逐）</el-dropdown-item>
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

    <YamlDialog
      v-model="yamlVisible" :title="yamlTitle" :content="yamlText" :saving="saving"
      :readonly="!canUpdateRes && yamlMode !== 'create'" :creating="yamlMode === 'create'" :preflight="preflightYaml" :target="yamlTarget" :mode="yamlDialogMode" :submit-label="yamlMode === 'create' ? '创建' : '保存'" @save="saveYaml"
    />

    <ScaleDialog
      v-model="scaleVisible" :name="scaleRow?.name || ''"
      :current="Number(scaleRow?._raw?.spec?.replicas ?? 0)" :saving="scaleSaving"
      @save="saveScale"
    />
    <ContainerAccessDialog v-model="accessVisible" :resource="accessResource" />
  </div>
</template>

<script setup>
import { ref, shallowRef, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Refresh, MoreFilled, ArrowDown, ArrowUp } from '@element-plus/icons-vue'
import * as yaml from 'js-yaml'
import api from '../api'
import {registerUnsavedGuard} from '../utils/navigation'
import { store } from '../store'
import { metaFromRoute, statusTag } from '../config/resources'
import { normalizeRow, columnsFor, yamlTemplate } from '../config/columns'
import { cpath, nsPath } from '../utils/path'
import { can, canResource } from '../utils/perm'
import YamlDialog from '../components/YamlDialog.vue'
import ScaleDialog from '../components/ScaleDialog.vue'
import { filterRows, sortRows, createRequestGate, targetDescription } from '../utils/resource'
import { normalizeFilters, filterCapabilities, activeFilterCount, filterQuery, filterQueryKeys } from '../utils/resource-filters'
import ResourceActionButton from '../components/ResourceActionButton.vue'
import ContainerAccessDialog from '../components/ContainerAccessDialog.vue'

const route = useRoute()
const router = useRouter()
const meta = computed(() => metaFromRoute(route.params, store.discovery))
const columns = computed(() => columnsFor(meta.value.kind, meta.value.namespaced))
const scalable = computed(() => ['Deployment', 'StatefulSet', 'ReplicaSet'].includes(meta.value.kind))
const restartable = computed(() => ['Deployment', 'StatefulSet', 'DaemonSet'].includes(meta.value.kind))
const canAccessContainers = computed(() => ['Pod','Deployment','StatefulSet','DaemonSet','ReplicaSet','Job','CronJob'].includes(meta.value.kind) && ['pod:logs','pod:exec','pod:files:read','pod:files:write','pod:batch-exec'].some(permission=>can(permission)))
const actionWidth = computed(() => {
  const count=1 + Number(canUpdateRes.value) + Number(canDeleteRes.value)
  return 24 + count * 46 + (canAccessContainers.value ? 88 : 0) + ((scalable.value || restartable.value || ['Node','Pod'].includes(meta.value.kind)) ? 32 : 0)
})

const loading = ref(false)
const saving = ref(false)
const actionBusy=ref(false)
const batchOperation=ref('')
const batchResults=ref([])
const batchResultTitle=ref('')
const removeContextGuard=registerUnsavedGuard(()=>{if(saving.value || scaleSaving.value || actionBusy.value){ElMessage.warning('操作进行中，请稍后切换上下文');return false}return true})
const canCreateRes = computed(() => canResource(meta.value,'create',store.namespace))
const canUpdateRes = computed(() => canResource(meta.value,'update',store.namespace))
const canDeleteRes = computed(() => canResource(meta.value,'delete',store.namespace))
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
const filterFormRef = ref(null)
const creationRange = computed({
  get: () => draft.createdFrom && draft.createdTo ? [new Date(draft.createdFrom),new Date(draft.createdTo)] : null,
  set: value => {
    if (!value?.length) { draft.createdFrom=''; draft.createdTo=''; return }
    const from=new Date(value[0]); from.setHours(0,0,0,0)
    const to=new Date(value[1]); to.setHours(23,59,59,999)
    draft.createdFrom=from.toISOString(); draft.createdTo=to.toISOString()
  },
})
const capabilities = computed(() => filterCapabilities(meta.value.kind))
const activeCount = computed(() => activeFilterCount(filters))
const sort = ref({prop:'name',order:'ascending'})
const states = computed(()=>[...new Set([...(capabilities.value.pod ? ['Pending','Running','NotReady','CrashLoopBackOff','ImagePullBackOff','ErrImagePull','Succeeded','Failed','Evicted','Terminating','Unknown'] : []), ...rows.value.map(r=>r.status), filters.state, draft.state].filter(state => state && !['abnormal','active-abnormal'].includes(state)))])
const nodes = computed(()=>[...new Set(rows.value.map(r=>r.node).filter(node=>node && node!=='-'))].sort())
const yamlTarget = computed(()=>targetDescription(store.currentCluster?.name || store.currentClusterId, editingRow.value ? editingRow.value._raw?.metadata?.namespace : nsParam(), meta.value.kind, editingRow.value?.name))
const keyword = ref(filters.keyword)
const selected = ref([])
const page = ref(1)
const pageSize = ref(20)
const scaleVisible = ref(false)
const scaleRow = ref(null)
const scaleSaving = ref(false)

const yamlVisible = ref(false)
const accessVisible = ref(false)
const accessResource = shallowRef(null)
const yamlText = ref('')
const yamlTitle = ref('')
const yamlMode = ref('create')
const yamlDialogMode = ref('edit')
const editingRow = shallowRef(null)

const rows = computed(() => items.value.map(i => normalizeRow(meta.value.kind, i)))
const filtered = computed(() => sortRows(filterRows(rows.value, {...filters,keyword:keyword.value}),sort.value.prop,sort.value.order))
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

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
function syncQuery() {
  const query={...route.query}
  for(const key of filterQueryKeys) delete query[key]
  Object.assign(query, filterQuery({...filters,keyword:keyword.value}))
  if(JSON.stringify(query)!==JSON.stringify(route.query)) router.replace({query})
}
function setFilters(next) {
  const labelsChanged=next.labels!==filters.labels
  Object.assign(filters,next)
  Object.assign(draft,next)
  keyword.value=next.keyword
  page.value=1; clearSelection()
  if(labelsChanged) load()
}
function applyFilters() {
  setFilters(normalizeFilters(meta.value.kind,{...draft,keyword:keyword.value}))
  syncQuery()
}
function resetFilters() {
  const empty=normalizeFilters(meta.value.kind,{})
  Object.assign(draft,empty)
  setFilters(empty)
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
function openAccess(row) {
  accessResource.value={...row._raw,kind:row._raw?.kind || meta.value.kind,apiVersion:row._raw?.apiVersion || (meta.value.group ? `${meta.value.group}/${meta.value.version}` : meta.value.version)}
  accessVisible.value=true
}

function openCreate() {
  yamlMode.value = 'create'
  yamlDialogMode.value = 'edit'
  editingRow.value = null
  yamlTitle.value = `新建 ${meta.value.kind}`
  yamlText.value = yamlTemplate(meta.value, store.namespace)
  yamlVisible.value = true
}

/** 点「YAML」默认只读查看；要改必须再点弹窗里的「编辑」 */
async function openYaml(row, mode) {
  yamlMode.value = 'edit'
  yamlDialogMode.value = mode
  yamlTitle.value = `${mode === 'view' ? '查看' : '编辑'} ${row.name}`
  // 列表中的对象可能已过期，打开前重新拉最新版本，避免保存时撞上 K8s 乐观锁 409
  let latest = row._raw
  try {
    const m = meta.value
    latest = await api.get(m.group, m.version, m.plural, nsPath(row.namespace), row.name)
  } catch (e) { ElMessage.error('无法读取最新版本，请重试：' + e.message); return }
  editingRow.value = { ...row, _raw: latest }
  yamlText.value = yaml.dump(latest, { noRefs: true, lineWidth: 120 })
  yamlVisible.value = true
}
function viewYaml(row) { return openYaml(row, 'view') }
function editYaml(row) { return openYaml(row, 'edit') }

async function preflightYaml(text) {
  const obj=yaml.load(text); const m=meta.value
  if (!obj || !obj.metadata?.name) throw new Error('metadata.name 必填')
  if (obj.kind!==m.kind || obj.apiVersion!==(m.group ? `${m.group}/${m.version}` : m.version)) throw new Error('YAML 的 kind/apiVersion 与当前目标不一致')
  if (yamlMode.value==='create') return api.create(m.group,m.version,m.plural,obj.metadata.namespace || nsParam(),obj,{dryRun:true})
  if (obj.metadata.name!==editingRow.value.name || (obj.metadata.namespace || '_all')!==nsPath(editingRow.value.namespace)) throw new Error('不能在编辑中更改资源名称或命名空间')
  return api.update(m.group,m.version,m.plural,nsPath(editingRow.value.namespace),editingRow.value.name,obj,{dryRun:true})
}
async function saveYaml(text) {
  saving.value = true
  try {
    const obj = yaml.load(text)
    if (!obj || typeof obj !== 'object') throw new Error('YAML 内容不是一个对象')
    if (yamlMode.value === 'create') {
      const m = meta.value
      await api.create(m.group,m.version,m.plural,obj.metadata?.namespace || nsParam(),obj)
      ElMessage.success('已提交创建')
    } else {
      const m = meta.value
      await api.update(m.group, m.version, m.plural, editingRow.value.namespace === '-' ? '_all' : editingRow.value.namespace, editingRow.value.name, obj)
      ElMessage.success('保存成功')
    }
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
  const m = meta.value
  const ns = nsPath(row.namespace)
  if (cmd==='cordon' ? !can('node:maintain') || !canUpdateRes.value : !writable.value) return ElMessage.warning('当前账号只有查看权限，不能执行该操作')
  try {
    if (cmd === 'editYaml') return editYaml(row)
    if (cmd === 'restartPod') {
      await ElMessageBox.confirm(
        `重启 Pod ${row.name} 会通过 Eviction 驱逐，由有效控制器重建；PDB 或控制器状态可能阻止操作。确认继续？`,
        '重启 Pod', { type: 'warning', confirmButtonText: '确定重启' }
      )
      const r = await api.restartPod(row.namespace, row.name)
      ElMessage.success(r.message || '已提交重启')
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

async function batchRestart() {
  if (!restartable.value || !selected.value.length || actionBusy.value) return
  const targets=[...selected.value]
  const m={...meta.value}
  actionBusy.value=true; batchOperation.value='restart'; batchResults.value=[]
  try {
    batchResultTitle.value='批量重启 · 服务端预检'
    for (const row of targets) {
      const name=`${row.namespace}/${row.name}`
      try {
        if (!canResource(m,'update',row.namespace,store.currentClusterId)) throw new Error('没有此资源的更新权限')
        await api.restart(m.group,m.version,m.plural,nsPath(row.namespace),row.name,{dryRun:true})
        batchResults.value.push({name,ok:true,message:'服务端预检通过'})
      } catch (e) { batchResults.value.push({name,ok:false,message:e?.message || '预检失败'}) }
    }
    if (batchResults.value.some(result=>!result.ok)) {
      ElMessage.warning('批量重启预检未全部通过，请查看逐项结果后重试')
      return
    }
    await ElMessageBox.confirm(`选中的 ${targets.length} 个 ${m.kind} 已通过服务端预检。确定触发滚动重启？`, '批量重启', {type:'warning',confirmButtonText:'确定重启'})
    batchResultTitle.value='批量重启 · 执行结果'; batchResults.value=[]
    for (const row of targets) {
      const name=`${row.namespace}/${row.name}`
      try {
        if (!canResource(m,'update',row.namespace,store.currentClusterId)) throw new Error('没有此资源的更新权限')
        await api.restart(m.group,m.version,m.plural,nsPath(row.namespace),row.name)
        batchResults.value.push({name,ok:true,message:'已提交滚动重启，请查看工作负载状态'})
      } catch (e) { batchResults.value.push({name,ok:false,message:e?.message || '重启失败'}) }
    }
    const failed=batchResults.value.filter(result=>!result.ok).length
    ElMessage[failed ? 'warning' : 'success'](`批量重启：已提交 ${targets.length-failed}，失败 ${failed}`)
    await load()
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e?.message || '批量重启失败')
  } finally { actionBusy.value=false; batchOperation.value='' }
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
let listPath=route.path
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
  listPath=route.path
  clearTimeout(queryTimer)
  filterOpen.value=false
  accessVisible.value=false; accessResource.value=null; batchResults.value=[]
  Object.assign(filters,normalizeFilters(meta.value.kind,route.query))
  keyword.value=filters.keyword
  Object.assign(draft,filters)
  page.value=1; clearSelection(); load()
})
onMounted(() => {
  load()
  window.addEventListener('kp:refresh', load)
})
onUnmounted(() => { clearTimeout(queryTimer); removeContextGuard(); gate.invalidate(); controller?.abort(); window.removeEventListener('kp:refresh', load) })
</script>

<style scoped>
.resource-query-card { margin-bottom:16px; padding:20px 22px; }
.resource-query-row { display:flex; flex-wrap:wrap; align-items:center; gap:14px 24px; }
.resource-query-row :deep(.el-form-item) { margin:0; }
.query-name { flex:1 1 240px; max-width:370px; }
.query-date { flex:1 1 360px; max-width:470px; }
.query-date :deep(.el-date-editor) { width:100%; min-width:0; }
.resource-query-actions { display:flex; gap:10px; align-items:center; margin-left:auto; }
.resource-query-actions .el-button + .el-button { margin-left:0; }
.resource-table-card { padding:0; }
.resource-toolbar { padding:16px 18px; margin:0; gap:10px; }
.resource-toolbar .el-button + .el-button { margin-left:0; }
.resource-count { color:var(--el-text-color-secondary); font-size:14px; white-space:nowrap; cursor:help; margin-right:4px; }
.filter-count { margin-left:3px; }
.resource-filter-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:0 24px; padding-top:20px; margin-top:20px; border-top:1px solid var(--kp-border); }
.resource-filter-grid .filter-wide { grid-column:1/-1; }
.resource-filter-grid :deep(.el-select),.resource-filter-grid :deep(.el-input-number) { width:100%; }
.resource-filter-grid :deep(.el-form-item) { align-items:flex-start; }
.resource-filter-grid :deep(.el-form-item__label) { min-width:90px; }
.resource-row-details { padding:18px 30px; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:14px 28px; font-size:14px; }
.resource-row-details > div { display:flex; gap:12px; align-items:baseline; overflow-wrap:anywhere; }
.resource-row-details > div > span:first-child { min-width:84px; color:var(--el-text-color-secondary); flex-shrink:0; }
.resource-row-details .detail-labels { grid-column:1/-1; flex-wrap:wrap; gap:8px; }
.resource-batch-results { margin:0 18px 16px; padding:14px; border:1px solid var(--kp-border); border-radius:var(--kp-r-sm); }
.batch-results-heading { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.resource-batch-results > div:not(.batch-results-heading) { display:flex; align-items:baseline; gap:12px; margin-top:8px; overflow-wrap:anywhere; }
@media (max-width:1100px) { .resource-query-actions { margin-left:0; } .resource-filter-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:700px) { .resource-query-card { padding:16px; } .query-name,.query-date { max-width:none; flex-basis:100%; } .resource-query-actions { flex-wrap:wrap; } .resource-filter-grid,.resource-row-details { grid-template-columns:minmax(0,1fr); } .resource-toolbar { padding:14px; } }
</style>
