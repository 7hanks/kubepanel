<template>
  <div class="kp-layout">
    <!-- 侧边栏：浅色、可收起，只展示内置资源分组 -->
    <aside class="kp-side" :class="{ 'is-collapsed': collapsed }">
      <div class="kp-brand">
        <span class="mark">K</span>
        <span class="kp-brand-text">KubePanel</span>
      </div>
      <div class="kp-side-search">
        <el-input v-model="menuFilter" placeholder="搜索菜单 / 资源类型" size="small" clearable :prefix-icon="Search" />
      </div>
      <nav class="kp-side-scroll" aria-label="控制台导航">
        <section v-for="g in groups" :key="g.id" class="kp-nav-group">
          <button v-if="g.id !== 'overview'" type="button" class="kp-group-title kp-group-toggle" :class="{ 'is-open': g.open }"
            :aria-label="g.title" :aria-expanded="g.open" :aria-controls="'nav-' + g.id"
            :title="g.title" :disabled="!!menuFilter.trim()" @click="toggleGroup(g)">
            <el-icon class="kp-group-icon"><component :is="g.icon || 'FolderOpened'" /></el-icon>
            <span class="kp-group-label">{{ g.title }}</span>
            <el-icon class="kp-group-chevron"><ArrowDown /></el-icon>
          </button>
          <div v-show="g.id === 'overview' || g.open" :id="'nav-' + g.id">
            <router-link v-for="it in g.items" :key="it.path"
              class="kp-nav-item" :class="{ active: isActive(it.path, it.platform) }"
              :aria-label="it.label" :aria-current="isActive(it.path, it.platform) ? 'page' : undefined"
              :title="[it.label, it.kind, it.aliases].filter(Boolean).join(' · ')"
              :to="it.platform ? it.path : cpath(it.path)">
              <el-icon><component :is="it.icon || 'Document'" /></el-icon>
              <span>{{ it.label }}</span>
            </router-link>
          </div>
        </section>
        <p v-if="!groups.length" class="kp-menu-empty" role="status">未找到匹配菜单</p>
      </nav>
      <div class="kp-side-footer">
        <button type="button" class="kp-nav-item" :title="collapsed ? '展开菜单' : '收起菜单'" :aria-label="collapsed ? '展开菜单' : '收起菜单'" @click="toggleCollapse">
          <el-icon><component :is="collapsed ? 'Expand' : 'Fold'" /></el-icon>
          <span>收起菜单</span>
        </button>
      </div>
    </aside>

    <!-- 主区域 -->
    <div class="kp-main">
      <header class="kp-header">
        <div class="kp-header-left">
          <el-tooltip :content="collapsed ? '展开侧栏' : '收起侧栏'" placement="bottom">
            <el-button size="small" circle text aria-label="展开或收起侧栏" @click="toggleCollapse">
              <el-icon><component :is="collapsed ? 'Expand' : 'Fold'" /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="集群管理" placement="bottom">
            <el-button size="small" circle text aria-label="集群管理" @click="goClusterList"><el-icon><OfficeBuilding /></el-icon></el-button>
          </el-tooltip>
          <span class="kp-header-sep" />
          <el-select
            :model-value="store.currentClusterId" size="small" style="width:158px"
            placeholder="选择集群" @change="switchCluster"
          >
            <el-option v-for="c in store.clusters" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
          <span class="kp-crumb">{{ title }}</span>
          <el-tag disable-transitions v-if="store.cluster" type="info" size="small" effect="plain">{{ store.cluster.version }}</el-tag>
        </div>

        <div class="kp-header-left">
          <span class="kp-header-label">命名空间</span>
          <el-select :model-value="store.namespace" size="small" style="width:150px" filterable @change="changeNs">
            <el-option label="全部命名空间" value="all" />
            <el-option v-for="ns in store.namespaces" :key="ns" :label="ns" :value="ns" />
          </el-select>
          <el-dropdown @command="setAutoRefresh">
            <button type="button" class="kp-header-action">
              <el-icon><Timer /></el-icon>{{ autoLabel }}<el-icon><ArrowDown /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item :command="0">关闭自动刷新</el-dropdown-item>
                <el-dropdown-item :command="15" divided>每 15 秒</el-dropdown-item>
                <el-dropdown-item :command="30">每 30 秒</el-dropdown-item>
                <el-dropdown-item :command="60">每 60 秒</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-tooltip content="刷新当前数据" placement="bottom">
            <el-button size="small" circle text :loading="reloading" aria-label="刷新当前数据" @click="reload"><el-icon><Refresh /></el-icon></el-button>
          </el-tooltip>
          <el-tooltip content="关于" placement="bottom">
            <el-button size="small" circle text aria-label="关于" @click="onCommand('about')"><el-icon><QuestionFilled /></el-icon></el-button>
          </el-tooltip>
          <span class="kp-header-sep" />
          <el-dropdown @command="onCommand">
            <button type="button" class="kp-header-action"><el-icon><UserFilled /></el-icon>{{ username }}<el-icon><ArrowDown /></el-icon></button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-if="roleLabel" disabled>{{ roleLabel }}</el-dropdown-item>
                <el-dropdown-item command="clusters">集群管理</el-dropdown-item>
                <el-dropdown-item command="password" divided>修改密码</el-dropdown-item>
                <el-dropdown-item command="about">关于</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <main class="kp-content">
        <el-alert v-if="store.error" type="error" show-icon :closable="false" style="margin-bottom:16px">
          <template #title>连接集群失败：{{ store.error }}</template>
          <template #default>
            请检查该集群的 kubeconfig、网络连通性与 RBAC 权限。
            <el-button link type="primary" @click="reload">重新连接</el-button>
            <el-button v-if="!route.meta.clusterManagement" link type="primary" @click="goClusterList">集群管理</el-button>
          </template>
        </el-alert>
        <router-view v-if="store.ready || route.meta.clusterManagement" v-slot="{ Component }">
          <component :is="Component" :key="route.path" />
        </router-view>
      </main>
    </div>

    <ChangePasswordDialog v-model="pwdVisible" @success="afterPasswordChanged" />
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Search, OfficeBuilding, Refresh, Timer, QuestionFilled, UserFilled, ArrowDown,
} from '@element-plus/icons-vue'
import { store } from '../store'
import { navGroups, metaFromRoute } from '../config/resources'
import { parseNavigationExpansion, visibleNavigationGroups, revealActiveNavigationGroup } from '../utils/navigation-groups'
import { confirmContextChange } from '../utils/navigation'
import { cpath } from '../utils/path'
import api from '../api'
import ChangePasswordDialog from '../components/ChangePasswordDialog.vue'
import {
  canReadCluster as permitCluster, canReadUsers as permitUsers,
  canReadRegistry as permitRegistry, canReadMonitor as permitMonitor,
  refreshSession, clearSession, roleName, can, canResource,
} from '../utils/perm'

const route = useRoute()
const router = useRouter()
const reloading = ref(false)
const menuFilter = ref('')
const groupExpansionKey = 'kp_nav_groups_v1'
const groupExpansion = ref(parseNavigationExpansion(localStorage.getItem(groupExpansionKey)))
const username = ref(localStorage.getItem('kp_user') || 'admin')
const roleLabel = ref(roleName())
const tick = ref(0)
const collapsed = ref(localStorage.getItem('kp_side_collapsed') === '1')
const autoRefresh = ref(Number(localStorage.getItem('kp_auto_refresh') || 0))
const pwdVisible = ref(false)
let refreshTimer = null

const allow = computed(() => {
  void tick.value
  return {
    cluster: permitCluster(),
    users: permitUsers(),
    registry: permitRegistry(),
    monitor: permitMonitor(),
  }
})

const autoLabel = computed(() => autoRefresh.value ? `${autoRefresh.value}s 刷新` : '自动刷新')

const baseGroups = computed(() => {
  const platform = [
    { label: '操作审计', icon: 'Document', path: '/audit', allowed: can('audit:list') },
    { label: '用户管理', icon: 'User', path: '/users', allowed: allow.value.users },
    { label: '平台角色', icon: 'UserFilled', path: '/roles', allowed: allow.value.users },
    { label: '镜像仓库', icon: 'Box', path: '/registries', allowed: allow.value.registry },
    { label: '监控', icon: 'TrendCharts', path: '/monitor', allowed: allow.value.monitor },
  ].filter(item => item.allowed).map(item => ({ ...item, platform: item.path !== '/monitor' }))
  return [...navGroups, { id: 'platform', title: '平台', icon: 'OfficeBuilding', items: platform }]
})
const permittedGroups = computed(() => visibleNavigationGroups(baseGroups.value, '', groupExpansion.value,
  item => !item.plural || canResource(item, 'list', store.namespace)))
const groups = computed(() => visibleNavigationGroups(permittedGroups.value, menuFilter.value, groupExpansion.value, () => true))

function saveGroupExpansion(value) {
  groupExpansion.value = value
  localStorage.setItem(groupExpansionKey, JSON.stringify(value))
}
function toggleGroup(group) {
  if (menuFilter.value.trim()) return
  saveGroupExpansion({ ...groupExpansion.value, [group.id]: !group.open })
}
watch([() => route.path, baseGroups], () => {
  const next = revealActiveNavigationGroup(permittedGroups.value, groupExpansion.value,
    item => isActive(item.path, item.platform))
  if (next !== groupExpansion.value) saveGroupExpansion(next)
}, { immediate: true })

const title = computed(() => {
  if (route.meta.title) return route.meta.title
  if (route.name === 'resource-list' || route.name === 'resource-detail') {
    return metaFromRoute(route.params, store.discovery).label
  }
  if (route.name === 'pod-logs') return 'Pod 日志'
  if (route.name === 'pod-terminal') return 'Web 终端'
  return '控制台'
})

function toggleCollapse() {
  collapsed.value = !collapsed.value
  localStorage.setItem('kp_side_collapsed', collapsed.value ? '1' : '0')
}
function setAutoRefresh(sec) {
  autoRefresh.value = Number(sec) || 0
  localStorage.setItem('kp_auto_refresh', String(autoRefresh.value))
  applyAutoRefresh()
  ElMessage.success(autoRefresh.value ? `已开启每 ${autoRefresh.value} 秒自动刷新` : '已关闭自动刷新')
}
function applyAutoRefresh() {
  clearInterval(refreshTimer)
  if (autoRefresh.value > 0) {
    refreshTimer = setInterval(() => window.dispatchEvent(new Event('kp:refresh')), autoRefresh.value * 1000)
  }
}

function isActive(path, platform = false) {
  const full = platform ? path : cpath(path, route.params.clusterId)
  if (path === '/overview') return route.path === full
  return route.path === full || route.path.startsWith(full + '/')
}
function go(path) { if (route.path !== cpath(path)) router.push(cpath(path)) }
function goClusterList() { router.push(cpath('/clusters')) }
function switchCluster(id) {
  router.push(cpath(route.name==='cluster-monitor' ? '/monitor' : '/overview', id))
}
async function changeNs(ns) { if (await confirmContextChange()) store.setNamespace(ns) }

/** 改完密码旧 token 仍然有效，但一律要求重新登录，避免“改了却没生效”的困惑 */
function afterPasswordChanged() {
  clearSession()
  router.push('/login')
}

async function reload() {
  reloading.value = true
  window.dispatchEvent(new Event('kp:refresh'))
  try { await store.init(true); ElMessage.success('集群信息已刷新') }
  catch (e) { /* store.error 已展示 */ }
  finally { reloading.value = false }
}

async function onCommand(cmd) {
  if (cmd === 'logout') { await api.logout().catch(() => {});
    clearSession()
    router.push('/login')
  } else if (cmd === 'password') {
    pwdVisible.value = true
  } else if (cmd === 'clusters') {
    goClusterList()
  } else {
    ElMessageBox.alert(
      'KubePanel · 轻量多集群 Kubernetes 控制台。',
      '关于', { dangerouslyUseHTMLString: true, confirmButtonText: '知道了' }
    )
  }
}

onMounted(async () => {
  store.setCluster(route.params.clusterId)
  try { await store.loadClusters() } catch (e) { /* 顶部仍可手动切换 */ }
  store.init().catch(() => {})
  applyAutoRefresh()
  try {
    const p = await refreshSession()
    username.value = p.username
    roleLabel.value = p.roleName
    tick.value++
  } catch (e) { /* 拦截器已处理 401 */ }
})
onUnmounted(() => clearInterval(refreshTimer))

// 同一集群从管理页返回资源页也需要重试失败的初始化。
watch(() => route.path, () => {
  const id = route.params.clusterId
  if (!id) return
  if (id !== store.currentClusterId) store.setCluster(id)
  if (!store.ready) store.init().catch(() => {})
})
</script>

<style scoped>
.kp-side-footer { padding: 8px; border-top: 1px solid var(--kp-border); flex-shrink: 0; }
.kp-side.is-collapsed .kp-side-footer .kp-nav-item span { display: none; }
.kp-header-action {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  font-size: 13px; color: var(--kp-text-2); white-space: nowrap;
  padding: 5px 8px; border-radius: var(--kp-r-sm); transition: background .14s;
}
.kp-header-action:hover { background: var(--kp-side-hover); color: var(--kp-text); }
.kp-group-toggle {
  display: flex; align-items: center; gap: 8px; width: 100%; min-height: 34px;
  margin: 4px 0 2px; padding: 8px 10px; border: 0; border-radius: var(--kp-r-sm);
  background: transparent; text-align: left; color: var(--kp-text-2);
  font-size: 13px; line-height: 18px; letter-spacing: 0; text-transform: none; cursor: pointer;
}
.kp-group-toggle:hover { background: var(--kp-side-hover); color: var(--kp-text); }
.kp-group-toggle:disabled { cursor: default; }
.kp-group-label { flex: 1; }
.kp-group-toggle .kp-group-icon { display: none; }
.kp-group-chevron { margin-left: auto; font-size: 11px; transform: rotate(-90deg); transition: transform .16s; }
.kp-group-toggle.is-open .kp-group-chevron { transform: rotate(0deg); }
.kp-menu-empty { margin: 12px 8px; font-size: 13px; color: var(--kp-text-2); }
.kp-side.is-collapsed .kp-group-toggle {
  display: flex; justify-content: center; height: 34px; min-height: 34px; margin: 5px 0 2px;
  padding: 8px 0; background: transparent; font-size: 13px;
}
.kp-side.is-collapsed .kp-group-toggle .kp-group-icon { display: inline-flex; font-size: 16px; }
.kp-side.is-collapsed .kp-group-toggle .kp-group-label,
.kp-side.is-collapsed .kp-group-toggle .kp-group-chevron { display: none; }
.kp-side.is-collapsed .kp-group-toggle.is-open { color: var(--kp-brand); background: var(--kp-side-active); }
@media (max-width: 900px) {
  .kp-layout > .kp-side .kp-group-toggle {
    display: flex; justify-content: center; height: 34px; min-height: 34px;
    margin: 5px 0 2px; padding: 8px 0; background: transparent; font-size: 13px;
  }
  .kp-layout > .kp-side .kp-group-toggle .kp-group-icon { display: inline-flex; font-size: 16px; }
  .kp-layout > .kp-side .kp-group-toggle .kp-group-label,
  .kp-layout > .kp-side .kp-group-toggle .kp-group-chevron { display: none; }
  .kp-layout > .kp-side .kp-group-toggle.is-open { color: var(--kp-brand); background: var(--kp-side-active); }
}
</style>
