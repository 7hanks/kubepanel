import { createRouter, createWebHistory } from 'vue-router'
import { confirmContextChange } from '../utils/navigation'
import Layout from '../layout/Layout.vue'
import { store } from '../store'
import { canAny, landingPath, refreshSession, clearSession } from '../utils/perm'

// 两级信息架构：/clusters（平台级集群列表） → /c/:clusterId/...（单个集群的资源控制台）
const routes = [
  { path: '/login', name: 'login', component: () => import('../views/Login.vue'), meta: { public: true } },
  { path: '/clusters', name: 'clusters', component: () => import('../views/ClusterList.vue'), meta: { title: '集群列表', perm: ['cluster:list', 'cluster:detail'] } },
  { path: '/registries', name: 'registries', component: () => import('../views/Registries.vue'), meta: { title: '镜像仓库', perm: ['registry:list', 'registry:detail'] } },
  { path: '/monitor', name: 'monitor', component: () => import('../views/Monitor.vue'), meta: { title: '监控', perm: ['monitor:list', 'monitor:detail'] } },
  // 用户管理：一级菜单，下面挂「用户」和「角色」两个子页面
  { path: '/users', name: 'users', component: () => import('../views/Users.vue'), meta: { title: '用户', perm: ['user:list', 'user:detail'] } },
  { path: '/audit', name:'audit', component:()=>import('../views/Audit.vue'),meta:{title:'操作审计',perm:['audit:list']} },
  { path: '/roles', name: 'roles', component: () => import('../views/Roles.vue'), meta: { title: '角色', perm: ['user:list', 'user:detail'] } },
  {
    path: '/c/:clusterId', component: Layout, meta: { perm: ['cluster:list', 'cluster:detail'] },
    children: [
      { path: '', redirect: to => ({ name: 'overview', params: { clusterId: to.params.clusterId } }) },
      { path: 'overview', name: 'overview', component: () => import('../views/Overview.vue'), meta: { title: '集群概览' } },
      { path: 'r/:group/:version/:plural', name: 'resource-list', component: () => import('../views/ResourceList.vue') },
      { path: 'r/:group/:version/:plural/:namespace/:name', name: 'resource-detail', component: () => import('../views/ResourceDetail.vue') },
      { path: 'custom-resources', name: 'custom-resources', component: () => import('../views/CustomResources.vue'), meta: { title: '自定义资源' } },
      { path: 'pods/:namespace/:name/logs', name: 'pod-logs', component: () => import('../views/PodLogs.vue'), meta:{perm:['pod:logs']} },
      { path: 'pods/:namespace/:name/terminal', name: 'pod-terminal', component: () => import('../views/PodTerminal.vue'), meta:{perm:['pod:exec']} },
      { path: 'workbench', name: 'workbench', component: () => import('../views/YamlWorkbench.vue'), meta: { title: 'YAML 工作台' } },
    ],
  },
  { path: '/', redirect: () => landingPath() },
  { path: '/:pathMatch(.*)*', redirect: () => landingPath() },
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach(async (to) => {
  if (!await confirmContextChange()) return false
  if (to.meta.public) return true
  try { await refreshSession() }
  catch (e) {
    clearSession()
    return {path:'/login',query:{redirect:to.fullPath}}
  }
  if (to.meta.perm && !canAny(to.meta.perm)) {
    const target = landingPath()
    if (target !== to.path) return target
  }
  // 必须在组件挂载前同步 clusterId：Vue 子组件的 onMounted 早于父级 Layout，
  // 否则首屏请求会带着上一个集群的 id 打到错误的 API Server
  if (to.params.clusterId) {
    localStorage.setItem('kp_cluster', to.params.clusterId)
    store.setCluster(to.params.clusterId)
  }
  return true
})

export default router
