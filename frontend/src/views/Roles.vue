<template>
  <component :is="embedded ? 'div' : PlatformLayout" active="roles">
    <template v-if="!embedded" #actions>
      <el-button size="small" :loading="loading" circle @click="load"><el-icon><Refresh /></el-icon></el-button>
    </template>

    <main class="plat-main" :class="{ 'platform-embedded-main': embedded }">
      <div class="page-head">
        <div class="page-title">
          <h1>角色</h1>
          <el-popover trigger="click" placement="bottom-start" :width="360" :popper-style="{ maxWidth: 'calc(100vw - 32px)' }">
            <template #reference>
              <el-button class="help-button" text circle :icon="QuestionFilled" aria-label="角色使用说明" />
            </template>
            <div class="role-help">
              <strong>角色使用说明</strong>
              <p>勾选角色允许访问的对象和操作，再到「用户」页面分配给账号。内置 admin 拥有全部权限，不在此列表中。</p>
              <p>「列表 / 详情」为只读权限；「创建 / 编辑 / 删除」为写权限。服务端会拒绝只读账号的写请求（403）。</p>
              <p>权限变更在账号下次请求时立即生效；仍有账号使用的角色不能删除。</p>
            </div>
          </el-popover>
        </div>
        <div style="display:flex;gap:8px">
          <el-button v-if="embedded" :loading="loading" :icon="Refresh" @click="load">刷新</el-button>
          <el-button v-if="canCreateRole" type="primary" :icon="Plus" @click="openCreate">创建角色</el-button>
        </div>
      </div>

      <div class="kp-card" style="padding:0;margin-bottom:16px">
        <el-table :data="displayRoles" v-loading="loading" size="small" class="roles-table" style="width:100%">
          <el-table-column label="角色" min-width="210">
            <template #default="{ row }">
              <div class="role-name" :title="`角色 ID：${row.id}`">
                <strong style="font-weight:600">{{ row.name }}</strong>
                <span v-if="row.builtin" class="builtin-label">预置</span>
              </div>
              <div v-if="row.description" class="role-description kp-muted" :title="row.description">{{ row.description }}</div>
            </template>
          </el-table-column>
          <el-table-column label="权限" min-width="290">
            <template #default="{ row }">
              <span v-if="!row.groups.length" class="kp-muted">无权限</span>
              <el-popover v-else trigger="click" placement="bottom-start" :width="400" :popper-style="{ maxWidth: 'calc(100vw - 32px)' }">
                <template #reference>
                  <button type="button" class="summary-button permission-summary" :aria-label="`查看${row.name}的权限明细`">
                    <span v-for="group in row.groups" :key="group.key" class="permission-group-summary">
                      {{ group.label }}<span class="summary-separator">·</span>{{ group.access ? accessLabels[group.access] : `${group.permissions.length} 项` }}
                    </span>
                    <el-icon class="summary-chevron"><ArrowDown /></el-icon>
                  </button>
                </template>
                <div class="permission-details">
                  <div class="detail-heading">权限明细<span class="kp-muted">{{ row.permissions.length }} 项</span></div>
                  <section v-for="group in row.groups" :key="group.key" class="permission-detail-group">
                    <strong>{{ group.label }}</strong>
                    <div v-for="permission in group.permissions" :key="permission.key" class="permission-detail-item">
                      <span>{{ permission.label }}</span><code>{{ permission.key }}</code>
                    </div>
                  </section>
                </div>
              </el-popover>
            </template>
          </el-table-column>
          <el-table-column label="作用范围" min-width="240">
            <template #default="{ row }">
              <el-popover trigger="click" placement="bottom-start" :width="360" :popper-style="{ maxWidth: 'calc(100vw - 32px)' }">
                <template #reference>
                  <button type="button" class="summary-button scope-summary" :aria-label="`查看${row.name}的作用范围`">
                    <span>{{ row.scopeSummary.map(field => field.summary).join(' / ') }}</span>
                    <el-icon class="summary-chevron"><ArrowDown /></el-icon>
                  </button>
                </template>
                <div class="scope-details">
                  <div class="detail-heading">作用范围</div>
                  <section v-for="field in row.scopeSummary" :key="field.key" class="scope-detail-field">
                    <strong>{{ field.label }}</strong>
                    <span v-if="field.unrestricted" class="kp-muted">{{ field.summary }}</span>
                    <span v-else-if="!field.values.length" class="kp-muted">无授权</span>
                    <code v-else v-for="value in field.values" :key="value">{{ value }}</code>
                  </section>
                </div>
              </el-popover>
            </template>
          </el-table-column>
          <el-table-column label="账号" width="70" align="center">
            <template #default="{ row }">
              <span :class="row.userCount ? '' : 'kp-muted'">{{ row.userCount || 0 }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160" align="right" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" :disabled="!canUpdateRole" @click="openEdit(row)">编辑</el-button>
              <el-button link type="primary" size="small" :disabled="!canCreateRole" @click="openCopy(row)">复制</el-button>
              <el-button link type="danger" size="small" :disabled="!canDeleteRole" @click="remove(row)">删除</el-button>
            </template>
          </el-table-column>
          <template #empty>
            <div class="kp-empty">
              还没有角色。点右上角「创建角色」，勾选允许访问的对象与操作后保存。
            </div>
          </template>
        </el-table>
      </div>

      <!-- 创建 / 编辑 -->
      <el-dialog
        v-model="formVisible" :title="editing ? `编辑角色 · ${editing.name}` : '创建角色'"
        width="780px" top="7vh" destroy-on-close
      >
        <el-form label-width="76px" label-position="right">
          <el-form-item label="名称" required>
            <el-input v-model="form.name" maxlength="32" show-word-limit placeholder="例如：日志查看员" />
          </el-form-item>
          <el-form-item label="描述">
            <el-input v-model="form.description" maxlength="128" show-word-limit placeholder="这个角色能做什么，可留空" />
          </el-form-item>
          <el-form-item label="权限设置">
            <div class="perm-box">
              <el-table :data="permRows" size="small" border style="width:100%">
                <el-table-column label="对象" min-width="200">
                  <template #header>
                    <el-checkbox
                      :model-value="allChecked" :indeterminate="someChecked"
                      @change="toggleAll"
                    >对象</el-checkbox>
                  </template>
                  <template #default="{ row }">
                    <el-checkbox
                      :model-value="rowState(row) === 'all'"
                      :indeterminate="rowState(row) === 'some'"
                      @change="v => toggleRow(row, v)"
                    >{{ row.label }}</el-checkbox>
                    <div class="kp-muted hint">{{ row.hint }}</div>
                  </template>
                </el-table-column>
                <el-table-column v-for="a in actions" :key="a.key" :label="a.label" width="64" align="center">
                  <template #default="{ row }">
                    <el-checkbox
                      :model-value="row.checked[a.key] === true"
                      @change="v => setPerm(row, a.key, v)"
                    />
                  </template>
                </el-table-column>
              </el-table>
              <div class="perm-sum">
                <span class="kp-muted">已选 {{ selectedCount }} 项权限</span>
                <span class="spacer" />
                <el-button link type="primary" size="small" @click="toggleAll(true)">全选</el-button>
                <el-button link size="small" @click="toggleAll(false)">清空</el-button>
              </div>
            </div>
          </el-form-item>
          <el-form-item label="敏感操作"><el-checkbox-group v-model="form.sensitive"><el-checkbox v-for="p in sensitivePermissions" :key="p.key" :value="p.key">{{p.label}}</el-checkbox></el-checkbox-group></el-form-item>
          <el-form-item v-for="field in scopeFields" :key="field.key" :label="field.label"><div style="width:100%"><el-select v-model="form.scope[field.key]" multiple filterable allow-create default-first-option style="width:100%" :aria-label="field.label" placeholder="输入后按 Enter 添加，也支持逗号分隔；* 为全部，空列表为不授权"><el-option label="全部 (*)" value="*" /></el-select><p class="kp-muted" style="font-size:12px">{{field.hint}}</p></div></el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="formVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="submitForm">{{ editing ? '保存' : '创建' }}</el-button>
        </template>
      </el-dialog>
    </main>
  </component>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, QuestionFilled, ArrowDown } from '@element-plus/icons-vue'
import PlatformLayout from '../layout/PlatformLayout.vue'
import api from '../api'
import {parseScope} from '../utils/scope'
import { canCreate, canUpdate, canDelete } from '../utils/perm'
import { permissionGroups, scopeSummary } from '../utils/roleSummary'

defineProps({ embedded: { type: Boolean, default: false } })

const loading = ref(false)
const saving = ref(false)
const roles = ref([])
const objects = ref([])
const actions = ref([])
const sensitivePermissions=ref([])
const accessLabels = { read: '只读', manage: '管理', custom: '自定义' }
const displayRoles = computed(() => roles.value.map(role => ({
  ...role,
  groups: permissionGroups(role.permissions, objects.value, actions.value, sensitivePermissions.value),
  scopeSummary: scopeSummary(role.scope),
})))
const scopeFields=[{key:'clusters',label:'集群',hint:'填集群 ID，或 *。'},{key:'namespaces',label:'命名空间',hint:'受限命名空间角色不能读取集群级资源。'},{key:'resources',label:'资源',hint:'使用 group/plural，例如 _core/pods、apps/deployments，或 *。'}]
const scopeOf=row=>Object.fromEntries(scopeFields.map(f=>[f.key,[...(row?.scope?.[f.key] ?? ['*'])]]))

const canCreateRole = computed(() => canCreate('user'))
const canUpdateRole = computed(() => canUpdate('user'))
const canDeleteRole = computed(() => canDelete('user'))

const formVisible = ref(false)
const editing = ref(null)
const form = reactive({ name: '', description: '', checked: {}, sensitive:[], scope:scopeOf() })

/** 表格行：每个对象一行，checked 是 action -> boolean */
const permRows = computed(() => objects.value.map(o => ({
  ...o,
  checked: form.checked[o.key] || {},
})))

function ensureRows() {
  const next = {}
  for (const o of objects.value) {
    const row = {}
    for (const a of actions.value) row[a.key] = !!form.checked[o.key]?.[a.key]
    next[o.key] = row
  }
  form.checked = next
}

function rowState(row) {
  const vals = actions.value.map(a => !!row.checked[a.key])
  if (vals.every(Boolean)) return 'all'
  if (vals.some(Boolean)) return 'some'
  return 'none'
}

function setPerm(row, actionKey, value) {
  const cur = { ...(form.checked[row.key] || {}) }
  cur[actionKey] = !!value
  form.checked = { ...form.checked, [row.key]: cur }
}

function toggleRow(row, value) {
  const cur = {}
  for (const a of actions.value) cur[a.key] = !!value
  form.checked = { ...form.checked, [row.key]: cur }
}

const allChecked = computed(() =>
  objects.value.length > 0 && objects.value.every(o => rowState({ ...o, checked: form.checked[o.key] || {} }) === 'all'))
const someChecked = computed(() => !allChecked.value && selectedCount.value > 0)
const selectedCount = computed(() => {
  let n = 0
  for (const o of objects.value) {
    for (const a of actions.value) if (form.checked[o.key]?.[a.key]) n += 1
  }
  return n
})

function toggleAll(value) {
  const next = {}
  for (const o of objects.value) {
    const row = {}
    for (const a of actions.value) row[a.key] = !!value
    next[o.key] = row
  }
  form.checked = next
}

function permissionsFromForm() {
  const out = []
  for (const o of objects.value) {
    for (const a of actions.value) {
      if (form.checked[o.key]?.[a.key]) out.push(`${o.key}:${a.key}`)
    }
  }
  return [...out,...form.sensitive]
}

function permissionsToForm(list = []) {
  const checked = {}
  for (const o of objects.value) checked[o.key] = {}
  for (const p of list) {
    const [obj, act] = String(p).split(':')
    if (checked[obj] && actions.value.some(a => a.key === act)) checked[obj][act] = true
  }
  form.checked = checked
  form.sensitive=list.filter(p=>sensitivePermissions.value.some(x=>x.key===p))
}

function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', description: '', scope:scopeOf() })
  permissionsToForm([])
  formVisible.value = true
}

function openEdit(row) {
  editing.value = row
  Object.assign(form, { name: row.name, description: row.description || '',scope:scopeOf(row) })
  permissionsToForm(row.permissions)
  formVisible.value = true
}

function openCopy(row) {
  editing.value = null
  Object.assign(form, { name: `${row.name} 副本`, description: row.description || '',scope:scopeOf(row) })
  permissionsToForm(row.permissions)
  formVisible.value = true
}

async function submitForm() {
  if (saving.value) return
  const name = form.name.trim()
  if (!name) return ElMessage.warning('请输入角色名称')
  let scope
  try { scope=parseScope(form.scope) } catch(e) { return ElMessage.error(e.message) }
  const permissions = permissionsFromForm()
  if (!permissions.length) {
    try {
      await ElMessageBox.confirm(
        '这个角色没有勾选任何权限，绑定它的账号登录后看不到任何功能。确定保存？',
        '没有权限', { type: 'warning', confirmButtonText: '仍然保存', cancelButtonText: '返回勾选' },
      )
    } catch (e) { return }
  }
  saving.value = true
  try {
    const body = { name, description: form.description.trim(), permissions,scope }
    if (editing.value) {
      await api.updateRole(editing.value.id, body)
      ElMessage.success('角色已更新')
    } else {
      await api.createRole(body)
      ElMessage.success('角色已创建')
    }
    formVisible.value = false
    await load()
  } catch (e) {
    // 拦截器已提示
  } finally {
    saving.value = false
  }
}

async function remove(row) {
  const hint = row.userCount
    ? `该角色下还有 ${row.userCount} 个账号，需要先为这些账号换绑其他角色。`
    : '删除后不可恢复。'
  try {
    await ElMessageBox.confirm(`确定删除角色「${row.name}」？${hint}`, '删除角色',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch (e) { return }
  try {
    await api.removeRole(row.id)
    ElMessage.success('角色已删除')
    await load()
  } catch (e) {
    // 拦截器已提示
  }
}

async function load() {
  loading.value = true
  try {
    const r = await api.roles()
    roles.value = r.roles || []
    objects.value = r.objects || []
    actions.value = r.actions || []
    sensitivePermissions.value=r.sensitivePermissions || []
    if (!Object.keys(form.checked).length) ensureRows()
  } catch (e) {
    // 拦截器已提示
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.plat-main { max-width: 1280px; margin: 0 auto; padding: 24px 22px 48px; }
.plat-main.platform-embedded-main { max-width: none; margin: 0; padding: 0; }
.page-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
.page-head h1 { margin: 0; font-size: 21px; font-weight: 650; letter-spacing: -.02em; }
.page-title { display: flex; align-items: center; gap: 7px; }
.help-button { color: #98a2b3; }
.role-help { font-size: 12px; line-height: 1.7; }
.role-help p { margin: 8px 0 0; }
.roles-table :deep(.el-table__cell) { padding: 15px 0; }
.role-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.role-name strong { overflow-wrap: anywhere; }
.builtin-label { flex: none; font-size: 11px; color: #98a2b3; }
.role-description { margin-top: 4px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.summary-button { border: 0; background: transparent; font: inherit; color: #475467; text-align: left; padding: 3px 0; cursor: pointer; line-height: 1.8; }
.summary-button:hover { color: var(--el-color-primary); }
.summary-button:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; border-radius: 3px; }
.permission-summary { display: flex; align-items: center; gap: 3px 12px; flex-wrap: wrap; }
.permission-group-summary { white-space: nowrap; }
.summary-separator { padding: 0 4px; color: #b0b8c4; }
.summary-chevron { flex: none; font-size: 10px; color: #98a2b3; }
.scope-summary { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; }
.permission-details, .scope-details { max-height: min(480px, 65vh); overflow-y: auto; font-size: 12px; }
.detail-heading { display: flex; align-items: center; gap: 8px; color: #344054; font-weight: 600; padding-bottom: 10px; }
.detail-heading .kp-muted { font-weight: 400; }
.permission-detail-group + .permission-detail-group { margin-top: 12px; padding-top: 12px; border-top: 1px solid #eef1f5; }
.permission-detail-group > strong, .scope-detail-field > strong { display: block; margin-bottom: 5px; font-weight: 600; color: #475467; }
.permission-detail-item { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; padding: 3px 0; }
.permission-detail-item code, .scope-detail-field code { color: #7b8493; font-size: 11px; overflow-wrap: anywhere; }
.scope-detail-field + .scope-detail-field { margin-top: 14px; }
.scope-detail-field code { display: block; line-height: 1.8; }
.perm-box { width: 100%; }
.perm-box :deep(.el-table .cell) { padding: 0 6px; }
.hint { font-size: 11.5px; line-height: 1.4; margin-top: 1px; }
.perm-sum { display: flex; align-items: center; gap: 4px; margin-top: 8px; font-size: 12px; }
.spacer { flex: 1; }
</style>
