<template>
  <div class="plat-shell">
    <!-- 平台级左侧导航：集群列表 / 镜像仓库 / 监控 -->
    <aside class="kp-side" :class="{ 'is-collapsed': collapsed }">
      <div class="kp-brand" @click="go('/clusters')">
        <span class="mark">K</span><span class="kp-brand-text">KubePanel</span>
      </div>
      <div class="kp-side-scroll">
        <div class="kp-group-title">平台</div>
        <div
          v-for="n in navs" :key="n.key"
          class="kp-nav-item" :class="{ active: active === n.key }"
          :title="collapsed ? n.label : ''" @click="go(n.path)"
        >
          <el-icon><component :is="n.icon" /></el-icon>
          <span>{{ n.label }}</span>
        </div>
      </div>
      <div class="ps-foot">
        <div class="kp-nav-item" :title="collapsed ? '展开菜单' : ''" @click="toggleCollapse">
          <el-icon><component :is="collapsed ? 'Expand' : 'Fold'" /></el-icon>
          <span>收起菜单</span>
        </div>
        <div v-if="!collapsed" class="ps-ver">KubePanel v1.4.0</div>
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
            <span class="plat-user"><el-icon><UserFilled /></el-icon>{{ username }}<el-icon><ArrowDown /></el-icon></span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="password">修改密码</el-dropdown-item>
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
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import {
  OfficeBuilding, Box, TrendCharts, UserFilled, ArrowDown,
} from '@element-plus/icons-vue'
import ChangePasswordDialog from '../components/ChangePasswordDialog.vue'
import { CLUSTERS_PATH } from '../utils/path'

const props = defineProps({ active: { type: String, default: 'clusters' } })

const router = useRouter()
const username = localStorage.getItem('kp_user') || 'admin'
const pwdVisible = ref(false)
const collapsed = ref(localStorage.getItem('kp_plat_side_collapsed') === '1')

const navs = [
  { key: 'clusters', label: '集群列表', icon: OfficeBuilding, path: CLUSTERS_PATH },
  { key: 'registries', label: '镜像仓库', icon: Box, path: '/registries' },
  { key: 'monitor', label: '监控', icon: TrendCharts, path: '/monitor' },
]
const currentLabel = computed(() => navs.find(n => n.key === props.active)?.label || '平台')

function toggleCollapse() {
  collapsed.value = !collapsed.value
  localStorage.setItem('kp_plat_side_collapsed', collapsed.value ? '1' : '0')
}
function go(path) { if (router.currentRoute.value.path !== path) router.push(path) }
function onCommand(cmd) {
  if (cmd === 'logout') { localStorage.removeItem('kp_token'); router.push('/login') }
  else if (cmd === 'password') pwdVisible.value = true
  else ElMessageBox.alert('KubePanel v1.4.0 · 多集群 Kubernetes 控制台。', '关于', { confirmButtonText: '知道了' })
}
function afterPasswordChanged() {
  localStorage.removeItem('kp_token')
  router.push('/login')
}
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
.plat-user {
  display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12.5px;
  color: var(--kp-text-2); padding: 5px 8px; border-radius: var(--kp-r-sm); transition: background .14s;
}
.plat-user:hover { background: var(--kp-side-hover); color: var(--kp-text); }
.plat-content { flex: 1; overflow-y: auto; }

@media (max-width: 860px) {
  .plat-shell :deep(.kp-side) { width: 62px; }
  .plat-shell :deep(.kp-side .kp-nav-item span),
  .plat-shell :deep(.kp-brand-text) { display: none; }
  .plat-shell :deep(.kp-side .kp-nav-item) { justify-content: center; padding: 9px 0; }
  .plat-shell :deep(.kp-group-title) { height: 1px; padding: 0; margin: 10px 12px 6px; font-size: 0; background: var(--kp-border); }
}
</style>
