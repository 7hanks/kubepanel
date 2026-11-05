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
      <div class="kp-side-scroll">
        <template v-for="g in groups" :key="g.title">
          <div class="kp-group-title">{{ g.title }}</div>
          <div
            v-for="it in g.items" :key="it.path"
            class="kp-nav-item" :class="{ active: isActive(it.path) }"
            :title="collapsed ? it.label : ''" @click="go(it.path)"
          >
            <el-icon><component :is="it.icon || 'Document'" /></el-icon>
            <span>{{ it.label }}</span>
          </div>
        </template>

        <div class="kp-group-title">平台</div>
        <div class="kp-nav-item" :title="collapsed ? '集群列表' : ''" @click="router.push('/clusters')">
          <el-icon><OfficeBuilding /></el-icon><span>集群列表</span>
        </div>
        <div class="kp-nav-item" :title="collapsed ? '镜像仓库' : ''" @click="router.push('/registries')">
          <el-icon><Box /></el-icon><span>镜像仓库</span>
        </div>
        <div class="kp-nav-item" :title="collapsed ? '监控' : ''" @click="router.push('/monitor')">
          <el-icon><TrendCharts /></el-icon><span>监控</span>
        </div>
      </div>
      <div class="kp-side-footer">
        <div class="kp-nav-item" :title="collapsed ? '展开菜单' : ''" @click="toggleCollapse">
          <el-icon><component :is="collapsed ? 'Expand' : 'Fold'" /></el-icon>
          <span>收起菜单</span>
        </div>
      </div>
    </aside>

    <!-- 主区域 -->
    <div class="kp-main">
      <header class="kp-header">
        <div class="kp-header-left">
          <el-tooltip :content="collapsed ? '展开侧栏' : '收起侧栏'" placement="bottom">
            <el-button size="small" circle text @click="toggleCollapse">
              <el-icon><component :is="collapsed ? 'Expand' : 'Fold'" /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="返回集群列表" placement="bottom">
            <el-button size="small" circle text @click="goClusterList"><el-icon><OfficeBuilding /></el-icon></el-button>
          </el-tooltip>
          <span class="kp-header-sep" />
          <el-select
            :model-value="store.currentClusterId" size="small" style="width:158px"
            placeholder="选择集群" @change="switchCluster"
          >
            <el-option v-for="c in store.clusters" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
          <span class="kp-crumb">{{ title }}</span>
          <el-tag v-if="store.cluster" type="info" size="small" effect="plain">{{ store.cluster.version }}</el-tag>
        </div>

        <div class="kp-header-left">
          <span class="kp-header-label">命名空间</span>
          <el-select :model-value="store.namespace" size="small" style="width:150px" filterable @change="changeNs">
            <el-option label="全部命名空间" value="all" />
            <el-option v-for="ns in store.namespaces" :key="ns" :label="ns" :value="ns" />
          </el-select>
          <el-dropdown @command="setAutoRefresh">
            <span class="kp-header-action">
              <el-icon><Timer /></el-icon>{{ autoLabel }}<el-icon><ArrowDown /></el-icon>
            </span>
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
            <el-button size="small" circle text :loading="reloading" @click="reload"><el-icon><Refresh /></el-icon></el-button>
          </el-tooltip>
          <el-tooltip content="关于" placement="bottom">
            <el-button size="small" circle text @click="onCommand('about')"><el-icon><QuestionFilled /></el-icon></el-button>
          </el-tooltip>
          <span class="kp-header-sep" />
          <el-dropdown @command="onCommand">
            <span class="kp-header-action"><el-icon><UserFilled /></el-icon>{{ username }}<el-icon><ArrowDown /></el-icon></span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="clusters">集群列表</el-dropdown-item>
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
            <el-button link type="primary" @click="goClusterList">返回集群列表</el-button>
          </template>
        </el-alert>
        <router-view v-slot="{ Component }">
          <component :is="Component" :key="route.fullPath" />
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
import { Search, OfficeBuilding, Refresh, Timer, QuestionFilled, UserFilled, ArrowDown } from '@element-plus/icons-vue'
import { store } from '../store'
import { navGroups } from '../config/resources'
import { cpath, CLUSTERS_PATH } from '../utils/path'
import ChangePasswordDialog from '../components/ChangePasswordDialog.vue'

const route = useRoute()
const router = useRouter()
const reloading = ref(false)
const menuFilter = ref('')
const username = localStorage.getItem('kp_user') || 'admin'
const collapsed = ref(localStorage.getItem('kp_side_collapsed') === '1')
const autoRefresh = ref(Number(localStorage.getItem('kp_auto_refresh') || 0))
const pwdVisible = ref(false)
let refreshTimer = null

const autoLabel = computed(() => autoRefresh.value ? `${autoRefresh.value}s 刷新` : '自动刷新')

const groups = computed(() => {
  const base = navGroups.map(g => ({ ...g }))
  const f = menuFilter.value.trim().toLowerCase()
  if (!f) return base
  return base
    .map(g => ({ ...g, items: g.items.filter(i =>
      i.label.toLowerCase().includes(f) || (i.kind || '').toLowerCase().includes(f) || (i.plural || '').toLowerCase().includes(f)) }))
    .filter(g => g.items.length)
})

const title = computed(() => {
  if (route.meta.title) return route.meta.title
  if (route.name === 'resource-list' || route.name === 'resource-detail') {
    const p = route.params.plural
    return String(p).charAt(0).toUpperCase() + String(p).slice(1)
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

function isActive(path) {
  const full = cpath(path)
  if (path === '/overview') return route.path === full
  return route.path === full || route.path.startsWith(full + '/')
}
function go(path) { if (route.path !== cpath(path)) router.push(cpath(path)) }
function goClusterList() { router.push(CLUSTERS_PATH) }
function switchCluster(id) {
  store.setCluster(id)
  router.push(cpath('/overview', id))
}
function changeNs(ns) { store.setNamespace(ns) }

/** 改完密码旧 token 仍然有效，但一律要求重新登录，避免“改了却没生效”的困惑 */
function afterPasswordChanged() {
  localStorage.removeItem('kp_token')
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
  if (cmd === 'logout') {
    localStorage.removeItem('kp_token')
    router.push('/login')
  } else if (cmd === 'password') {
    pwdVisible.value = true
  } else if (cmd === 'clusters') {
    goClusterList()
  } else {
    ElMessageBox.alert(
      'KubePanel · 轻量多集群 Kubernetes 控制台。<br/>先在集群列表选择集群，再进入资源控制台；所有写操作最终由 API Server 执行。',
      '关于', { dangerouslyUseHTMLString: true, confirmButtonText: '知道了' }
    )
  }
}

onMounted(async () => {
  store.setCluster(route.params.clusterId)
  try { await store.loadClusters() } catch (e) { /* 顶部仍可手动切换 */ }
  store.init().catch(() => {})
  applyAutoRefresh()
})
onUnmounted(() => clearInterval(refreshTimer))

watch(() => route.params.clusterId, id => {
  if (!id || id === store.currentClusterId) return
  store.setCluster(id)
  store.init(true).catch(() => {})
})
</script>

<style scoped>
.kp-side-footer { padding: 8px; border-top: 1px solid var(--kp-border); flex-shrink: 0; }
.kp-side.is-collapsed .kp-side-footer .kp-nav-item span { display: none; }
.kp-header-action {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  font-size: 12.5px; color: var(--kp-text-2); white-space: nowrap;
  padding: 5px 8px; border-radius: var(--kp-r-sm); transition: background .14s;
}
.kp-header-action:hover { background: var(--kp-side-hover); color: var(--kp-text); }
</style>
