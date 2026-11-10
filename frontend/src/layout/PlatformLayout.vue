<template>
  <div class="plat-shell">
    <!-- 平台级左侧导航：集群列表 / 用户管理 / 镜像仓库 / 监控 -->
    <aside class="kp-side" :class="{ 'is-collapsed': collapsed }">
      <router-link class="kp-brand" to="/clusters">
        <span class="mark">K</span><span class="kp-brand-text">KubePanel</span>
      </router-link>
      <div class="kp-side-scroll">
        <div class="kp-group-title">平台</div>
        <template v-for="n in navs" :key="n.key">
          <!-- 带子页面的一级菜单（用户管理 → 用户 / 角色） -->
          <template v-if="n.children">
            <button type="button" class="kp-nav-item" :class="{ active: isGroupActive(n), open: opened[n.key] }"
              :title="collapsed ? n.label : ''" 
             @click="toggleGroup(n)">
              <el-icon><component :is="n.icon" /></el-icon>
              <span>{{ n.label }}</span>
              <el-icon class="kp-nav-caret"><ArrowDown /></el-icon>
            </button>
            <div v-show="opened[n.key] && !collapsed" class="kp-subnav">
              <router-link v-for="c in n.children" :key="c.key"
                class="kp-nav-item kp-subnav-item" :class="{ active: active === c.key }"
                
               :to="c.path">
                <span>{{ c.label }}</span>
              </router-link>
            </div>
          </template>
          <router-link v-else
            class="kp-nav-item" :class="{ active: active === n.key }"
            :title="collapsed ? n.label : ''" 
           :to="n.path">
            <el-icon><component :is="n.icon" /></el-icon>
            <span>{{ n.label }}</span>
          </router-link>
        </template>
      </div>
      <div class="ps-foot">
        <button type="button" class="kp-nav-item" :title="collapsed ? '展开菜单' : ''"  @click="toggleCollapse">
          <el-icon><component :is="collapsed ? 'Expand' : 'Fold'" /></el-icon>
          <span>收起菜单</span>
        </button>
        <div v-if="!collapsed" class="ps-ver">KubePanel v1.5.0</div>
      </div>
    </aside>

    <div class="plat-body">
      <header class="plat-top">
        <div class="plat-crumb">
          <span class="kp-muted">平台</span>
          <span class="ps-sep">/</span>
          <span>{{ currentLabel }}</span>
        </div>
        <div class="plat-right">
          <slot name="actions" />
          <span class="ps-divider" />
          <el-dropdown @command="onCommand">
            <button type="button" class="plat-user">
              <el-icon><UserFilled /></el-icon>{{ username }}<el-icon><ArrowDown /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-if="roleLabel" disabled>{{ roleLabel }}</el-dropdown-item>
                <el-dropdown-item command="password" divided>修改密码</el-dropdown-item>
                <el-dropdown-item command="about">关于</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <div class="plat-content">
        <slot />
      </div>
    </div>

    <ChangePasswordDialog v-model="pwdVisible" @success="afterPasswordChanged" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import {
  OfficeBuilding, Box, TrendCharts, UserFilled, ArrowDown, User,
} from '@element-plus/icons-vue'
import api from '../api'
import ChangePasswordDialog from '../components/ChangePasswordDialog.vue'
import { CLUSTERS_PATH } from '../utils/path'
import {
  canReadCluster, canReadUsers, canReadRegistry, canReadMonitor,
  refreshSession, clearSession, roleName, can,
} from '../utils/perm'

const props = defineProps({ active: { type: String, default: 'clusters' } })

const router = useRouter()
const username = ref(localStorage.getItem('kp_user') || 'admin')
const roleLabel = ref(roleName())
const tick = ref(0)                               // 权限快照刷新后重算菜单
const pwdVisible = ref(false)
const collapsed = ref(localStorage.getItem('kp_plat_side_collapsed') === '1')
const opened = ref({ 'user-mgmt': true })

const navs = computed(() => {
  void tick.value
  return [
    { key: 'clusters', label: '集群列表', icon: OfficeBuilding, path: CLUSTERS_PATH, hidden: !canReadCluster() },
    {
      key: 'user-mgmt', label: '用户管理', icon: User, hidden: !canReadUsers(),
      children: [
        { key: 'users', label: '用户', path: '/users' },
        { key: 'roles', label: '角色', path: '/roles' },
      ].filter(c => canReadUsers()),
    },
    { key: 'registries', label: '镜像仓库', icon: Box, path: '/registries', hidden: !canReadRegistry() },
    { key:'audit',label:'操作审计',icon:User,path:'/audit',hidden:!can('audit:list') },
    { key: 'monitor', label: '监控', icon: TrendCharts, path: '/monitor', hidden: !canReadMonitor() },
  ].filter(n => !n.hidden)
})

const allLabels = computed(() => {
  const out = {}
  for (const n of navs.value) {
    out[n.key] = n.label
    for (const c of n.children || []) out[c.key] = c.label
  }
  return out
})
const currentLabel = computed(() => allLabels.value[props.active] || '平台')

function isGroupActive(n) {
  return (n.children || []).some(c => c.key === props.active)
}
function toggleGroup(n) {
  if (collapsed.value) return go(n.children?.[0]?.path || '/')
  opened.value[n.key] = !opened.value[n.key]
}
function toggleCollapse() {
  collapsed.value = !collapsed.value
  localStorage.setItem('kp_plat_side_collapsed', collapsed.value ? '1' : '0')
}
function go(path) { if (router.currentRoute.value.path !== path) router.push(path) }
async function onCommand(cmd) {
  if (cmd === 'logout') { await api.logout().catch(() => {}); clearSession(); router.push('/login') }
  else if (cmd === 'password') pwdVisible.value = true
  else if (cmd === 'about') ElMessageBox.alert('KubePanel v1.5.0 · 多集群 Kubernetes 控制台。', '关于', { confirmButtonText: '知道了' })
}
function afterPasswordChanged() {
  clearSession()
  router.push('/login')
}

onMounted(async () => {
  try {
    const p = await refreshSession()
    username.value = p.username
    roleLabel.value = p.roleName
    tick.value++
  } catch (e) { /* 拦截器已处理 401 */ }
})
</script>

<style scoped>
.plat-shell { display: flex; height: 100vh; overflow: hidden; background: var(--kp-bg); }
.plat-body { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }

.kp-brand { cursor: pointer; }
.ps-foot { border-top: 1px solid var(--kp-border); padding: 8px; flex-shrink: 0; }
.ps-ver {
  padding: 6px 10px 2px; font-size: 11px; color: var(--kp-faint);
  white-space: nowrap; letter-spacing: .01em;
}
.plat-top {
  height: 56px; flex-shrink: 0; background: #fff; border-bottom: 1px solid var(--kp-border);
  display: flex; align-items: center; justify-content: space-between; padding: 0 22px;
}
.plat-crumb { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--kp-text); }
.ps-sep { color: var(--kp-faint); }
.plat-right { display: flex; align-items: center; gap: 10px; }
.ps-divider { width: 1px; height: 18px; background: var(--kp-border); }
.plat-user { background:transparent; border:0; font:inherit;
  display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12.5px;
  color: var(--kp-text-2); padding: 5px 8px; border-radius: var(--kp-r-sm); transition: background .14s;
}
.plat-user:hover { background: var(--kp-side-hover); color: var(--kp-text); }
.plat-content { flex: 1; overflow-y: auto; }

.kp-nav-caret { margin-left: auto; font-size: 12px !important; transition: transform .16s; }
.kp-nav-item.open .kp-nav-caret { transform: rotate(180deg); }
.kp-subnav { padding: 2px 0 6px; }
.kp-subnav-item { padding-left: 36px; font-size: 12.5px; }
.kp-subnav-item.active { background: var(--kp-side-active); color: var(--kp-brand); font-weight: 600; }
.kp-side.is-collapsed .kp-nav-caret { display: none; }

@media (max-width: 860px) {
  .plat-shell :deep(.kp-side) { width: 62px; }
  .plat-shell :deep(.kp-side .kp-nav-item span),
  .plat-shell :deep(.kp-brand-text) { display: none; }
  .plat-shell :deep(.kp-side .kp-nav-item) { justify-content: center; padding: 9px 0; }
  .plat-shell :deep(.kp-group-title) { height: 1px; padding: 0; margin: 10px 12px 6px; font-size: 0; background: var(--kp-border); }
  .kp-subnav { display: none; }
}
</style>
