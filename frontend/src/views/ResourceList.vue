<template>
  <div>
    <div class="kp-toolbar">
      <el-input v-model="keyword" placeholder="按名称搜索" clearable style="width:220px" :prefix-icon="Search" />
      <el-input v-model="labelSelector" placeholder="标签筛选，如 app=nginx" clearable @clear="load" style="width:230px" @keyup.enter="load">
        <template #prefix><el-icon><Filter /></el-icon></template>
      </el-input>
      <el-button @click="load" :loading="loading"><el-icon><Refresh /></el-icon><span style="margin-left:5px">刷新</span></el-button>
      <span class="spacer" />
      <el-tag disable-transitions type="info" size="small" effect="plain">共 {{ filtered.length }} 项</el-tag>
      <el-button v-if="canCreateRes" type="primary" :icon="Plus" @click="openCreate">新建</el-button>
      <el-button v-if="canDeleteRes" type="danger" plain :disabled="!selected.length" @click="batchDelete">删除 ({{ selected.length }})</el-button>
    </div>

    <div class="kp-toolbar" aria-label="资源筛选">
      <el-select v-model="filters.state" clearable aria-label="按状态筛选" placeholder="状态" style="width:160px"><el-option label="活跃异常" value="active-abnormal"/><el-option label="全部异常（含历史）" value="abnormal" /><el-option v-for="state in states" :key="state" :label="state" :value="state" /></el-select>
      <el-input v-model="filters.reason" clearable placeholder="原因" style="width:160px" aria-label="按原因筛选" />
      <el-input v-model="filters.node" clearable placeholder="节点" style="width:160px" aria-label="按节点筛选" />
      <el-input v-model="filters.owner" clearable placeholder="Owner" style="width:160px" aria-label="按所属控制器筛选" />
      <el-input-number v-if="meta.kind === 'Pod'" v-model="filters.minRestarts" :min="0" aria-label="最少重启次数" />
      <el-tag v-if="filters.phase" closable @close="filters.phase=''">阶段 {{filters.phase}}</el-tag>
      <span v-if="nextContinue" class="kp-muted">筛选仅覆盖已加载资源</span>
    </div>
    <el-alert v-if="loadError" type="error" :closable="false" show-icon style="margin-bottom:12px"><template #title>{{ loadError }}</template><el-button @click="load">重试</el-button></el-alert>
    <div class="kp-card" style="padding:0">
      <el-table
        ref="tableRef" v-loading="loading" :data="paged" border stripe size="small" row-key="uid"
        style="width:100%" @sort-change="v => sort = v" @selection-change="v => selected = v" @row-dblclick="openDetail"
      >
        <el-table-column type="selection" width="42" />
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
              <ResourceActionButton @click="viewYaml(row)">YAML</ResourceActionButton>
              <ResourceActionButton v-if="meta.kind === 'Pod' && can('pod:logs')" @click="goLogs(row)">日志</ResourceActionButton>
              <ResourceActionButton v-if="meta.kind === 'Pod' && can('pod:exec')" @click="goTerminal(row)">终端</ResourceActionButton>
              <!-- teleport 到 body 避免被表格 overflow/fixed 列裁剪；右对齐，接近视口底部时由 popper flip 自动上翻 -->
              <el-dropdown
                trigger="click" placement="bottom-end" :teleported="true" popper-class="kp-row-actions"
                :popper-options="{ modifiers: [{ name: 'flip', options: { fallbackPlacements: ['top-end'] } }] }"
                @command="cmd => onCommand(cmd, row)"
              >
                <ResourceActionButton aria-label="更多操作" title="更多操作"><el-icon aria-hidden="true"><MoreFilled /></el-icon></ResourceActionButton>
                <template #dropdown>
                  <el-dropdown-menu>
                    <!-- 普通操作：低频、非破坏性（行内四入口已覆盖的高频动作不在此重复） -->
                    <el-dropdown-item command="editYaml" :disabled="!canUpdateRes">编辑 YAML</el-dropdown-item>
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

    <YamlDialog
      v-model="yamlVisible" :title="yamlTitle" :content="yamlText" :saving="saving"
      :readonly="!canUpdateRes && yamlMode !== 'create'" :preflight="preflightYaml" :target="yamlTarget" :mode="yamlDialogMode" :tip="yamlTip" :submit-label="yamlMode === 'create' ? '创建' : '保存'" @save="saveYaml"
    />

    <ScaleDialog
      v-model="scaleVisible" :name="scaleRow?.name || ''"
      :current="Number(scaleRow?._raw?.spec?.replicas ?? 0)" :saving="scaleSaving"
      @save="saveScale"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
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
import { filterRows, sortRows, createRequestGate, targetDescription } from '../utils/resource'
import ResourceActionButton from '../components/ResourceActionButton.vue'

const route = useRoute()
const router = useRouter()
const meta = computed(() => metaFromRoute(route.params, store.discovery))
const columns = computed(() => columnsFor(meta.value.kind, meta.value.namespaced))
const scalable = computed(() => ['Deployment', 'StatefulSet', 'ReplicaSet'].includes(meta.value.kind))
const restartable = computed(() => ['Deployment', 'StatefulSet', 'DaemonSet'].includes(meta.value.kind))
const actionWidth = computed(() => {
  if (meta.value.kind === 'Pod') return 250
  if (scalable.value || restartable.value || meta.value.kind === 'Node') return 180
  return 140
})

const loading = ref(false)
const saving = ref(false)
const actionBusy=ref(false)
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
const filters = reactive({state:route.query.state || '',phase:route.query.phase || '',reason:'',node:'',owner:'',minRestarts:0})
const sort = ref({prop:'name',order:'ascending'})
const states = computed(()=>[...new Set(rows.value.map(r=>r.status))])
const yamlTarget = computed(()=>targetDescription(store.currentCluster?.name || store.currentClusterId, editingRow?.namespace || nsParam(), meta.value.kind, editingRow?.name))
const keyword = ref('')
const labelSelector = ref('')
const selected = ref([])
const page = ref(1)
const pageSize = ref(20)
const scaleVisible = ref(false)
const scaleRow = ref(null)
const scaleSaving = ref(false)

const yamlVisible = ref(false)
const yamlText = ref('')
const yamlTitle = ref('')
const yamlTip = ref('')
const yamlMode = ref('create')
const yamlDialogMode = ref('edit')
let editingRow = null

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
async function fetchList(append=false) {
  controller?.abort(); controller=new AbortController()
  const request=gate.next()
  const m={...meta.value}
  const params={limit:200,clusterId:store.currentClusterId}
  const ns=nsParam(); if (ns) params.namespace=ns
  if (labelSelector.value.trim()) params.labelSelector=labelSelector.value.trim()
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
function goLogs(row) { router.push(cpath(`/pods/${encodeURIComponent(row.namespace)}/${encodeURIComponent(row.name)}/logs`)) }
function goTerminal(row) { router.push(cpath(`/pods/${encodeURIComponent(row.namespace)}/${encodeURIComponent(row.name)}/terminal`)) }

function openCreate() {
  yamlMode.value = 'create'
  yamlDialogMode.value = 'edit'
  editingRow = null
  yamlTitle.value = `新建 ${meta.value.kind}`
  yamlTip.value = '填写完整 YAML 后提交，使用 POST 创建；同名资源已存在时会报冲突。metadata.name 必填。'
  yamlText.value = yamlTemplate(meta.value, store.namespace)
  yamlVisible.value = true
}

/** 点「YAML」默认只读查看；要改必须再点弹窗里的「编辑」 */
async function openYaml(row, mode) {
  yamlMode.value = 'edit'
  yamlDialogMode.value = mode
  yamlTitle.value = `${mode === 'view' ? '查看' : '编辑'} ${row.name}`
  yamlTip.value = mode === 'view'
    ? '只读预览：双击内容区或点右下角「编辑」即可修改，保存等价于 kubectl replace。'
    : '保存等价于 kubectl replace，会整体更新该资源；字段非法时 API Server 会拒绝并提示原因。'
  // 列表中的对象可能已过期，打开前重新拉最新版本，避免保存时撞上 K8s 乐观锁 409
  let latest = row._raw
  try {
    const m = meta.value
    latest = await api.get(m.group, m.version, m.plural, nsPath(row.namespace), row.name)
  } catch (e) { ElMessage.error('无法读取最新版本，请重试：' + e.message); return }
  editingRow = { ...row, _raw: latest }
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
  if (obj.metadata.name!==editingRow.name || (obj.metadata.namespace || '_all')!==nsPath(editingRow.namespace)) throw new Error('不能在编辑中更改资源名称或命名空间')
  return api.update(m.group,m.version,m.plural,nsPath(editingRow.namespace),editingRow.name,obj,{dryRun:true})
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
      await api.update(m.group, m.version, m.plural, editingRow.namespace === '-' ? '_all' : editingRow.namespace, editingRow.name, obj)
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

watch(labelSelector,()=>{nextContinue.value='';page.value=1;clearSelection()})
watch([keyword, filters, pageSize, sort], () => { page.value=1; clearSelection() }, {deep:true})
watch(() => store.namespace, () => { page.value = 1; clearSelection(); load() })
watch(() => route.fullPath, () => { keyword.value = ''; labelSelector.value = ''; page.value = 1; clearSelection(); load() })
onMounted(() => {
  load()
  window.addEventListener('kp:refresh', load)
})
onUnmounted(() => { removeContextGuard(); gate.invalidate(); controller?.abort(); window.removeEventListener('kp:refresh', load) })
</script>
