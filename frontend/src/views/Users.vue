<template>
  <PlatformLayout active="users">
    <template #actions>
      <el-button size="small" :loading="loading" circle @click="load"><el-icon><Refresh /></el-icon></el-button>
    </template>

    <main class="plat-main">
      <div class="page-head">
        <div>
          <h1>用户</h1>
          <p class="kp-muted">
            为平台创建独立账号，并按角色授予权限。权限最终由服务端校验，越权请求会被拒绝。
            内置 <code>admin</code> 账号拥有全部权限，不可在此编辑或删除。
          </p>
        </div>
        <div style="display:flex;gap:8px">
          <el-button v-if="canCreateUser" type="primary" :icon="Plus" @click="openCreate">创建用户</el-button>
        </div>
      </div>

      <div class="kp-stat-grid" style="margin-bottom:16px">
        <div class="kp-stat"><div class="label">用户总数</div><div class="value">{{ items.length }}</div>
          <el-icon class="icon"><User /></el-icon></div>
        <div class="kp-stat"><div class="label">已启用</div><div class="value kp-ok">{{ enabledCount }}</div>
          <el-icon class="icon"><CircleCheck /></el-icon></div>
        <div class="kp-stat"><div class="label">已停用</div><div class="value" :class="disabledCount ? 'kp-danger' : ''">{{ disabledCount }}</div>
          <el-icon class="icon"><CircleClose /></el-icon></div>
      </div>

      <div class="kp-card" style="padding:0">
        <div class="kp-toolbar" style="padding:14px 16px 0;margin-bottom:12px">
          <el-input v-model="filter" size="small" placeholder="搜索用户名 / 昵称 / 邮箱" clearable :prefix-icon="Search" style="max-width:260px" />
          <span class="spacer" />
          <span class="kp-muted" style="font-size:12px">共 {{ filtered.length }} 个账号</span>
        </div>
        <el-table :data="filtered" v-loading="loading" size="small" style="width:100%">
          <el-table-column label="用户名" min-width="150">
            <template #default="{ row }">
              <div style="display:flex;align-items:center;gap:8px">
                <span class="avatar">{{ (row.nickname || row.username).slice(0, 1).toUpperCase() }}</span>
                <strong style="font-weight:600">{{ row.username }}</strong>
                <el-tag disable-transitions v-if="row.builtin" size="small" type="info" effect="plain">内置</el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="nickname" label="昵称" min-width="120">
            <template #default="{ row }"><span class="kp-muted">{{ row.nickname || '—' }}</span></template>
          </el-table-column>
          <el-table-column prop="email" label="邮箱" min-width="180">
            <template #default="{ row }"><span class="kp-muted">{{ row.email || '—' }}</span></template>
          </el-table-column>
          <el-table-column label="角色" min-width="150">
            <template #default="{ row }">
              <el-tag disable-transitions size="small" :type="row.builtin ? 'danger' : 'primary'" effect="light">{{ row.roleName }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="权限范围" min-width="240">
            <template #default="{ row }">
              <span class="kp-muted" style="font-size:12px">{{ summary(row.role) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag disable-transitions size="small" :type="row.enabled ? 'success' : 'info'" effect="plain">
                {{ row.enabled ? '启用' : '停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="创建时间" width="150">
            <template #default="{ row }">
              <span class="kp-muted" style="font-size:12px">{{ fmtTime(row.createdAt) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="170" fixed="right" align="right">
            <template #default="{ row }">
              <template v-if="row.builtin">
                <span class="kp-muted" style="font-size:12px">不可编辑</span>
              </template>
              <template v-else>
                <el-button link type="primary" size="small" :disabled="!canUpdateUser" @click="openEdit(row)">编辑</el-button>
                <el-button link type="primary" size="small" :disabled="!canUpdateUser" @click="openReset(row)">重置密码</el-button>
                <el-button link type="danger" size="small" :disabled="!canDeleteUser" @click="remove(row)">删除</el-button>
              </template>
            </template>
          </el-table-column>
          <template #empty>
            <div class="kp-empty">
              还没有创建其他用户。点右上角「创建用户」，为成员分配角色后即可用独立账号登录。
            </div>
          </template>
        </el-table>
      </div>

      <!-- 创建 / 编辑 -->
      <el-dialog v-model="formVisible" :title="editing ? '编辑用户' : '创建用户'" width="520px" top="8vh" destroy-on-close>
        <el-form label-width="88px" label-position="right">
          <el-form-item label="用户名" required>
            <el-input v-model="form.username" :disabled="!!editing" placeholder="2-32 位字母、数字、点、下划线或短横线" />
          </el-form-item>
          <el-form-item label="昵称">
            <el-input v-model="form.nickname" placeholder="用于界面展示，可留空" />
          </el-form-item>
          <el-form-item label="邮箱">
            <el-input v-model="form.email" placeholder="可留空" />
          </el-form-item>
          <template v-if="!editing">
            <el-form-item label="密码" required>
              <el-input v-model="form.password" type="password" show-password placeholder="至少 8 位，含两类以上字符" />
            </el-form-item>
            <el-form-item label="确认密码" required>
              <el-input v-model="form.confirm" type="password" show-password placeholder="再次输入密码" />
            </el-form-item>
          </template>
          <el-form-item label="角色" required>
            <el-select v-model="form.role" placeholder="请选择" style="width:100%">
              <el-option v-for="r in roles" :key="r.id" :label="r.name" :value="r.id">
                <div class="role-opt">
                  <span>{{ r.name }}</span>
                  <span class="kp-muted">{{ r.description }}</span>
                </div>
              </el-option>
            </el-select>
            <div v-if="selectedRole" class="kp-muted" style="font-size:12px;line-height:1.6;margin-top:6px">
              {{ selectedRole.description || '自定义角色' }}：{{ summary(selectedRole.id) }}
            </div>
          </el-form-item>
          <el-form-item v-if="editing" label="状态">
            <el-switch v-model="form.enabled" active-text="启用" inactive-text="停用" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="formVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="submitForm">{{ editing ? '保存' : '确定' }}</el-button>
        </template>
      </el-dialog>

      <!-- 重置密码 -->
      <el-dialog v-model="resetVisible" title="重置密码" width="440px" destroy-on-close>
        <el-alert type="warning" :closable="false" style="margin-bottom:12px">
          为 <strong>{{ resetTarget?.username }}</strong> 设置新密码，保存后该账号的旧密码立即失效。
        </el-alert>
        <el-form label-width="80px">
          <el-form-item label="新密码">
            <el-input v-model="resetPwd" type="password" show-password placeholder="至少 8 位，含两类以上字符" />
          </el-form-item>
          <el-form-item label="确认密码">
            <el-input v-model="resetConfirm" type="password" show-password placeholder="再次输入新密码" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="resetVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="submitReset">确定</el-button>
        </template>
      </el-dialog>
    </main>
  </PlatformLayout>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Search, User, CircleCheck, CircleClose } from '@element-plus/icons-vue'
import PlatformLayout from '../layout/PlatformLayout.vue'
import api from '../api'
import { canCreate, canUpdate, canDelete } from '../utils/perm'

const loading = ref(false)
const saving = ref(false)
const items = ref([])
const roles = ref([])
const objects = ref([])
const actions = ref([])
const filter = ref('')
const canCreateUser = computed(() => canCreate('user'))
const canUpdateUser = computed(() => canUpdate('user'))
const canDeleteUser = computed(() => canDelete('user'))

const formVisible = ref(false)
const editing = ref(null)
const form = reactive({ username: '', nickname: '', email: '', password: '', confirm: '', role: 'common', enabled: true })

const resetVisible = ref(false)
const resetTarget = ref(null)
const resetPwd = ref('')
const resetConfirm = ref('')

const filtered = computed(() => {
  const f = filter.value.trim().toLowerCase()
  if (!f) return items.value
  return items.value.filter(u =>
    [u.username, u.nickname, u.email, u.roleName].some(v => String(v || '').toLowerCase().includes(f)))
})
const enabledCount = computed(() => items.value.filter(u => u.enabled).length)
const disabledCount = computed(() => items.value.filter(u => !u.enabled).length)
const selectedRole = computed(() => roles.value.find(r => r.id === form.role) || null)

/** 角色权限的紧凑描述：按对象分组，动作写中文 */
function summary(roleId) {
  if (roleId === 'admin') return '全部对象的全部权限'
  const r = roles.value.find(x => x.id === roleId)
  if (!r) return '—'
  const parts = []
  for (const o of objects.value) {
    const acts = r.permissions
      .filter(p => p.startsWith(o.key + ':'))
      .map(p => actions.value.find(a => a.key === p.split(':')[1])?.label || '')
      .filter(Boolean)
    if (acts.length) {
      parts.push(acts.length === actions.value.length ? o.label + '（全部）' : o.label + '（' + acts.join('、') + '）')
    }
  }
  return parts.length ? parts.join('；') : '无任何权限'
}
function fmtTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load() {
  loading.value = true
  try {
    const [u, r] = await Promise.all([api.users(), api.roles()])
    items.value = u.items || []
    roles.value = r.roles || []
    objects.value = r.objects || []
    actions.value = r.actions || []
    if (!form.role && roles.value.length) form.role = roles.value[0].id
  } catch (e) {
    // 拦截器已提示
  } finally {
    loading.value = false
  }
}

function resetForm() {
  Object.assign(form, { username: '', nickname: '', email: '', password: '', confirm: '', role: roles.value[0]?.id || 'common', enabled: true })
}
function openCreate() {
  editing.value = null
  resetForm()
  formVisible.value = true
}
function openEdit(row) {
  editing.value = row
  resetForm()
  Object.assign(form, {
    username: row.username, nickname: row.nickname, email: row.email, role: row.role, enabled: row.enabled,
  })
  formVisible.value = true
}

function validateNewPassword(pwd, confirm) {
  if (!pwd || pwd.length < 8) return '密码至少 8 位'
  if (pwd !== confirm) return '两次输入的密码不一致'
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(re => re.test(pwd)).length
  if (classes < 2) return '密码需包含大写字母、小写字母、数字、符号中的至少两类'
  return ''
}

async function submitForm() {
  if (saving.value) return
  if (!editing.value) {
    if (!form.username.trim()) return ElMessage.warning('请输入用户名')
    const err = validateNewPassword(form.password, form.confirm)
    if (err) return ElMessage.warning(err)
  }
  if (!form.role) return ElMessage.warning('请选择角色')
  saving.value = true
  try {
    if (editing.value) {
      await api.updateUser(editing.value.username, {
        nickname: form.nickname, email: form.email, role: form.role, enabled: form.enabled,
      })
      ElMessage.success('用户已更新')
    } else {
      await api.createUser({
        username: form.username.trim(),
        nickname: form.nickname,
        email: form.email,
        password: form.password,
        role: form.role,
      })
      ElMessage.success('用户已创建')
    }
    formVisible.value = false
    await load()
  } catch (e) {
    // 拦截器已提示
  } finally {
    saving.value = false
  }
}

function openReset(row) {
  resetTarget.value = row
  resetPwd.value = ''
  resetConfirm.value = ''
  resetVisible.value = true
}
async function submitReset() {
  if (saving.value) return
  const err = validateNewPassword(resetPwd.value, resetConfirm.value)
  if (err) return ElMessage.warning(err)
  saving.value = true
  try {
    await api.updateUser(resetTarget.value.username, { password: resetPwd.value })
    ElMessage.success(`已重置 ${resetTarget.value.username} 的密码`)
    resetVisible.value = false
  } catch (e) {
    // 拦截器已提示
  } finally {
    saving.value = false
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除用户 ${row.username}？删除后该账号立即无法登录，已登录的会话也会失效。`,
      '删除用户', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch (e) { return }
  try {
    await api.removeUser(row.username)
    ElMessage.success('用户已删除')
    await load()
  } catch (e) {
    // 拦截器已提示
  }
}

onMounted(load)
</script>

<style scoped>
.plat-main { max-width: 1280px; margin: 0 auto; padding: 24px 22px 48px; }
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
.page-head h1 { margin: 0; font-size: 21px; font-weight: 650; letter-spacing: -.02em; }
.page-head p { margin: 6px 0 0; font-size: 12px; max-width: 760px; line-height: 1.6; }
.avatar {
  width: 24px; height: 24px; border-radius: 6px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--kp-brand-soft); color: var(--kp-brand);
  font-size: 11.5px; font-weight: 700;
}
.role-opt { display: flex; flex-direction: column; line-height: 1.4; }
.role-opt .kp-muted { font-size: 11.5px; }
</style>
