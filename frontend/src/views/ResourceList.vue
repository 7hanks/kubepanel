<template>
  <div>
    <div class="kp-toolbar">
      <el-input v-model="keyword" placeholder="按名称搜索" clearable style="width:220px" :prefix-icon="Search" />
      <el-input v-model="labelSelector" placeholder="标签筛选，如 app=nginx" clearable style="width:230px" @keyup.enter="load">
        <template #prefix><el-icon><Filter /></el-icon></template>
      </el-input>
      <el-button @click="load" :loading="loading"><el-icon><Refresh /></el-icon><span style="margin-left:5px">刷新</span></el-button>
      <span class="spacer" />
      <el-tag type="info" size="small" effect="plain">共 {{ filtered.length }} 项</el-tag>
      <el-button v-if="canCreateRes" type="primary" :icon="Plus" @click="openCreate">新建</el-button>
      <el-button v-if="canDeleteRes" type="danger" plain :disabled="!selected.length" @click="batchDelete">删除 ({{ selected.length }})</el-button>
    </div>

    <div class="kp-card" style="padding:0">
      <el-table
        v-loading="loading" :data="paged" border stripe size="small" row-key="uid"
        style="width:100%" @selection-change="v => selected = v" @row-dblclick="openDetail"
      >
        <el-table-column type="selection" width="42" reserve-selection />
        <el-table-column
          v-for="col in columns" :key="col.key" :prop="col.key" :label="col.label"
          :width="col.width" :min-width="col.minWidth" show-overflow-tooltip
        >
          <template #default="{ row }">
            <el-link v-if="col.link" type="primary" :underline="false" @click="openDetail(row)">{{ row[col.key] }}</el-link>
            <el-tag v-else-if="col.tag" :type="statusTag(row[col.key])" size="small" effect="light">{{ row[col.key] }}</el-tag>
            <span v-else>{{ display(row[col.key]) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" :width="actionWidth" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="viewYaml(row)">YAML</el-button>
            <el-button v-if="meta.kind === 'Pod'" link type="primary" size="small" @click="goLogs(row)">日志</el-button>
            <el-button v-if="meta.kind === 'Pod' && canUpdateRes" link type="primary" size="small" @click="goTerminal(row)">终端</el-button>
            <el-dropdown trigger="click" @command="cmd => onCommand(cmd, row)">
              <el-button link type="primary" size="small">更多<el-icon><ArrowDown /></el-icon></el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="detail">查看详情</el-dropdown-item>
                  <el-dropdown-item command="yaml">查看 YAML</el-dropdown-item>
                  <el-dropdown-item command="editYaml" :disabled="!canUpdateRes">编辑 YAML</el-dropdown-item>
                  <el-dropdown-item v-if="scalable" command="scale" :disabled="!canUpdateRes">扩缩容</el-dropdown-item>
                  <el-dropdown-item v-if="restartable" command="restart" :disabled="!canUpdateRes">重启工作负载</el-dropdown-item>
                  <el-dropdown-item v-if="meta.kind === 'Node'" command="cordon" :disabled="!canUpdateRes">
                    {{ row.unschedulable ? '解除封锁 (uncordon)' : '封锁节点 (cordon)' }}
                  </el-dropdown-item>
                  <el-dropdown-item v-if="meta.kind === 'Pod'" command="terminal" :disabled="!canUpdateRes">进入容器</el-dropdown-item>
                  <el-dropdown-item v-if="meta.kind === 'Pod'" command="restartPod" divided :disabled="!canUpdateRes && !canDeleteRes">重启 Pod（删除并重建）</el-dropdown-item>
                  <el-dropdown-item command="delete" divided :disabled="!canDeleteRes">删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
        <template #empty><div class="kp-empty">没有找到资源</div></template>
      </el-table>

      <div style="display:flex;justify-content:flex-end;padding:12px">
        <el-pagination
          v-model:current-page="page" v-model:page-size="pageSize" :total="filtered.length"
          :page-sizes="[20, 50, 100, 200]" layout="total, sizes, prev, pager, next" background
        />
      </div>
    </div>

    <YamlDialog
      v-model="yamlVisible" :title="yamlTitle" :content="yamlText" :saving="saving"
      :mode="yamlDialogMode" :tip="yamlTip" :submit-label="yamlMode === 'create' ? '创建' : '保存'" @save="saveYaml"
    />

    <ScaleDialog
      v-model="scaleVisible" :name="scaleRow?.name || ''"
      :current="Number(scaleRow?._raw?.spec?.replicas ?? 0)" :saving="scaleSaving"
      @save="saveScale"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Filter, Plus, Refresh, ArrowDown } from '@element-plus/icons-vue'
import * as yaml from 'js-yaml'
import api from '../api'
import { store } from '../store'
import { metaFromRoute, statusTag } from '../config/resources'
import { normalizeRow, columnsFor, yamlTemplate } from '../config/columns'
import { cpath, nsPath } from '../utils/path'
import { canCreate, canUpdate, canDelete } from '../utils/perm'
import YamlDialog from '../components/YamlDialog.vue'
import ScaleDialog from '../components/ScaleDialog.vue'

const route = useRoute()
const router = useRouter()
const meta = computed(() => metaFromRoute(route.params))
const columns = computed(() => columnsFor(meta.value.kind, meta.value.namespaced))
const scalable = computed(() => ['Deployment', 'StatefulSet', 'ReplicaSet'].includes(meta.value.kind))
const restartable = computed(() => ['Deployment', 'StatefulSet', 'DaemonSet'].includes(meta.value.kind))
const actionWidth = computed(() => {
  if (meta.value.kind === 'Pod') return 230
  if (scalable.value || restartable.value || meta.value.kind === 'Node') return 180
  return 110
})

const loading = ref(false)
const saving = ref(false)
const canCreateRes = computed(() => canCreate('cluster'))
const canUpdateRes = computed(() => canUpdate('cluster'))
const canDeleteRes = computed(() => canDelete('cluster'))
const writable = computed(() => canCreateRes.value || canUpdateRes.value || canDeleteRes.value)
const items = ref([])
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
const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return rows.value
  return rows.value.filter(r => r.name.toLowerCase().includes(k) || r.namespace.toLowerCase().includes(k))
})
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

async function load() {
  loading.value = true
  try {
    const params = {}
    const ns = nsParam()
    if (ns) params.namespace = ns
    if (labelSelector.value.trim()) params.labelSelector = labelSelector.value.trim()
    const data = await api.list(meta.value.group, meta.value.version, meta.value.plural, params)
    items.value = data.items || []
  } catch (e) { items.value = [] }
  finally { loading.value = false }
}

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
  yamlTip.value = '填写完整 YAML 后提交，等价于 kubectl apply。metadata.name 必填。'
  yamlText.value = yamlTemplate(meta.value, store.namespace)
  yamlVisible.value = true
}

/** 点「YAML」默认只读查看；要改必须再点弹窗里的「编辑」 */
async function openYaml(row, mode) {
  yamlMode.value = 'edit'
  yamlDialogMode.value = mode
  yamlTitle.value = `${mode === 'view' ? '查看' : '编辑'} ${row.name}`
  yamlTip.value = mode === 'view'
    ? '只读预览：需要修改时点右下角「编辑」，保存等价于 kubectl replace。'
    : '保存等价于 kubectl replace，会整体更新该资源；字段非法时 API Server 会拒绝并提示原因。'
  // 列表中的对象可能已过期，打开前重新拉最新版本，避免保存时撞上 K8s 乐观锁 409
  let latest = row._raw
  try {
    const m = meta.value
    latest = await api.get(m.group, m.version, m.plural, nsPath(row.namespace), row.name)
  } catch (e) {
    ElMessage.warning('未能获取最新版本，已使用列表缓存；若保存报冲突请刷新后重试')
  }
  editingRow = { ...row, _raw: latest }
  yamlText.value = yaml.dump(latest, { noRefs: true, lineWidth: 120 })
  yamlVisible.value = true
}
function viewYaml(row) { return openYaml(row, 'view') }
function editYaml(row) { return openYaml(row, 'edit') }

async function saveYaml(text) {
  saving.value = true
  try {
    const obj = yaml.load(text)
    if (!obj || typeof obj !== 'object') throw new Error('YAML 内容不是一个对象')
    if (yamlMode.value === 'create') {
      await api.apply(text)
      ElMessage.success('已提交创建')
    } else {
      const m = meta.value
      await api.update(m.group, m.version, m.plural, editingRow.namespace === '-' ? '_all' : editingRow.namespace, editingRow.name, obj)
      ElMessage.success('保存成功')
    }
    yamlVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message || '保存失败')
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
  const readOnly = cmd === 'detail' || cmd === 'yaml'
  if (!readOnly && !writable.value) return ElMessage.warning('当前账号只有查看权限，不能执行该操作')
  try {
    if (cmd === 'detail') return openDetail(row)
    if (cmd === 'yaml') return viewYaml(row)
    if (cmd === 'editYaml') return editYaml(row)
    if (cmd === 'terminal') return goTerminal(row)
    if (cmd === 'restartPod') {
      await ElMessageBox.confirm(
        `重启 Pod ${row.name} 会先删除该 Pod，再由其控制器（Deployment / ReplicaSet / DaemonSet 等）自动拉起新实例，等同于 kubectl delete pod。会有短暂中断；没有控制器的裸 Pod 会被拒绝。确认继续？`,
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
  }
}

watch(() => store.namespace, () => { page.value = 1; load() })
watch(() => route.fullPath, () => { keyword.value = ''; labelSelector.value = ''; page.value = 1; load() })
onMounted(() => {
  load()
  window.addEventListener('kp:refresh', load)
})
onUnmounted(() => window.removeEventListener('kp:refresh', load))
</script>
