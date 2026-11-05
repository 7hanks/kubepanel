<template>
  <PlatformLayout active="roles">
    <template #actions>
      <el-button size="small" :loading="loading" circle @click="load"><el-icon><Refresh /></el-icon></el-button>
    </template>

    <main class="plat-main">
      <div class="page-head">
        <div>
          <h1>角色</h1>
          <p class="kp-muted">
            角色由「对象 × 动作」的权限组合而成：创建角色时勾选它允许访问的对象和能执行的操作，
            再到「用户」页面把角色分配给账号。内置 admin 始终拥有全部权限，不在此列表中。
          </p>
        </div>
        <div style="display:flex;gap:8px">
          <el-button v-if="canCreateRole" type="primary" :icon="Plus" @click="openCreate">创建角色</el-button>
        </div>
      </div>

      <div class="kp-card" style="padding:0;margin-bottom:16px">
        <el-table :data="roles" v-loading="loading" size="small" style="width:100%">
          <el-table-column label="名称" min-width="180">
            <template #default="{ row }">
              <div style="display:flex;align-items:center;gap:6px">
                <strong style="font-weight:600">{{ row.name }}</strong>
                <el-tag v-if="row.builtin" size="small" type="info" effect="plain">预置</el-tag>
              </div>
              <div class="kp-mono kp-muted" style="font-size:11px;margin-top:2px">{{ row.id }}</div>
            </template>
          </el-table-column>
          <el-table-column prop="description" label="描述" min-width="200">
            <template #default="{ row }">
              <span class="kp-muted">{{ row.description || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="权限范围" min-width="360">
            <template #default="{ row }">
              <span v-if="!row.permissions.length" class="kp-muted">无任何权限</span>
              <el-tag
                v-for="p in row.permissionLabels" :key="p" size="small" effect="plain"
                style="margin:2px 4px 2px 0"
              >{{ p }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="账号数" width="90" align="center">
            <template #default="{ row }">
              <span :class="row.userCount ? '' : 'kp-muted'">{{ row.userCount || 0 }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" align="right" fixed="right">
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

      <p class="kp-muted" style="font-size:12px;line-height:1.7">
        「列表 / 详情」为只读权限；「创建 / 编辑 / 删除」为写权限，只读账号发出的写请求会被服务端拒绝（403）。
        修改角色权限后，已绑定的账号在下次请求时立即生效；仍有账号在用的角色不能删除。
      </p>

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
        </el-form>
        <template #footer>
          <el-button @click="formVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="submitForm">{{ editing ? '保存' : '创建' }}</el-button>
        </template>
      </el-dialog>
    </main>
  </PlatformLayout>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'
import PlatformLayout from '../layout/PlatformLayout.vue'
import api from '../api'
import { canCreate, canUpdate, canDelete } from '../utils/perm'

const loading = ref(false)
const saving = ref(false)
const roles = ref([])
const objects = ref([])
const actions = ref([])

const canCreateRole = computed(() => canCreate('user'))
const canUpdateRole = computed(() => canUpdate('user'))
const canDeleteRole = computed(() => canDelete('user'))

const formVisible = ref(false)
const editing = ref(null)
const form = reactive({ name: '', description: '', checked: {} })

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
  return out
}

function permissionsToForm(list = []) {
  const checked = {}
  for (const o of objects.value) checked[o.key] = {}
  for (const p of list) {
    const [obj, act] = String(p).split(':')
    if (checked[obj] && actions.value.some(a => a.key === act)) checked[obj][act] = true
  }
  form.checked = checked
}

function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', description: '' })
  permissionsToForm([])
  formVisible.value = true
}

function openEdit(row) {
  editing.value = row
  Object.assign(form, { name: row.name, description: row.description || '' })
  permissionsToForm(row.permissions)
  formVisible.value = true
}

function openCopy(row) {
  editing.value = null
  Object.assign(form, { name: `${row.name} 副本`, description: row.description || '' })
  permissionsToForm(row.permissions)
  formVisible.value = true
}

async function submitForm() {
  if (saving.value) return
  const name = form.name.trim()
  if (!name) return ElMessage.warning('请输入角色名称')
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
    const body = { name, description: form.description.trim(), permissions }
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
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
.page-head h1 { margin: 0; font-size: 22px; font-weight: 650; letter-spacing: -.02em; }
.page-head p { margin: 6px 0 0; font-size: 13px; max-width: 760px; line-height: 1.6; }
.perm-box { width: 100%; }
.perm-box :deep(.el-table .cell) { padding: 0 6px; }
.hint { font-size: 11.5px; line-height: 1.4; margin-top: 1px; }
.perm-sum { display: flex; align-items: center; gap: 4px; margin-top: 8px; font-size: 12px; }
.spacer { flex: 1; }
</style>
