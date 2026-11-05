import axios from 'axios'
import { ElMessage } from 'element-plus'

// 后端同源托管，所有接口都在 /api 下
const http = axios.create({ baseURL: '/api', timeout: 30000 })

http.interceptors.request.use(cfg => {
  const token = localStorage.getItem('kp_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  // 除集群管理接口外，所有请求都带上当前集群；后端按 clusterId 选择客户端
  const clusterId = localStorage.getItem('kp_cluster')
  if (clusterId) cfg.params = { ...cfg.params, clusterId }
  return cfg
})

http.interceptors.response.use(
  res => res.data,
  err => {
    const status = err.response?.status
    const msg = err.response?.data?.message || err.message || '请求失败'
    if (status === 401) {
      localStorage.removeItem('kp_token')
      if (!location.pathname.startsWith('/login')) location.href = '/login'
    } else if (status !== 404) {
      ElMessage.error(typeof msg === 'string' ? msg.slice(0, 300) : '请求失败')
    }
    return Promise.reject({ status, message: msg, hint: err.response?.data?.hint, raw: err })
  }
)

// 资源路径：/v1/resources/{group}/{version}/{plural}[/{namespace}[/{name}]]
export function resPath(group, version, plural, namespace, name) {
  const g = group || '_core'
  let p = `/v1/resources/${encodeURIComponent(g)}/${encodeURIComponent(version)}/${encodeURIComponent(plural)}`
  if (name !== undefined && name !== null) p += `/${encodeURIComponent(namespace || '_all')}/${encodeURIComponent(name)}`
  return p
}

export const api = {
  // ---- 认证 ----
  login: (username, password) => http.post('/auth/login', { username, password }),
  logout: () => http.post('/auth/logout'),
  profile: () => http.get('/v1/auth/profile'),
  changePassword: (currentPassword, newPassword) =>
    http.post('/v1/auth/password', { currentPassword, newPassword }),

  // ---- 集群管理（平台级） ----
  clusters: (refresh = false) => http.get('/v1/clusters', { params: { refresh: refresh ? 1 : 0 } }),
  addCluster: (name, kubeconfig) => http.post('/v1/clusters', { name, kubeconfig }),
  removeCluster: id => http.delete(`/v1/clusters/${encodeURIComponent(id)}`),
  testCluster: id => http.post(`/v1/clusters/${encodeURIComponent(id)}/test`, {}),
  clusterDetail: id => http.get(`/v1/clusters/${encodeURIComponent(id)}/detail`),
  // 平台级：集群详情抽屉里的资源使用率 TOP N（metrics-server）
  topPods: (id, limit = 10) =>
    http.get(`/v1/clusters/${encodeURIComponent(id)}/top-pods`, { params: { limit } }),

  // ---- 当前集群信息与资源 ----
  cluster: () => http.get('/v1/cluster'),
  overview: () => http.get('/v1/overview'),
  discovery: () => http.get('/v1/resources'),

  // ---- 通用资源 CRUD ----
  list: (group, version, plural, params = {}) =>
    http.get(resPath(group, version, plural), { params }),
  get: (group, version, plural, namespace, name) =>
    http.get(resPath(group, version, plural, namespace, name)),
  create: (group, version, plural, namespace, body, params = {}) =>
    http.post(resPath(group, version, plural), body, { params: { namespace, ...params } }),
  update: (group, version, plural, namespace, name, body) =>
    http.put(resPath(group, version, plural, namespace, name), body),
  patch: (group, version, plural, namespace, name, body, patchType) =>
    http.patch(resPath(group, version, plural, namespace, name), body, { params: { patchType } }),
  remove: (group, version, plural, namespace, name, params = {}) =>
    http.delete(resPath(group, version, plural, namespace, name), { params }),
  scale: (group, version, plural, namespace, name, replicas) =>
    http.post(`${resPath(group, version, plural, namespace, name)}/scale`, { replicas }),
  restart: (group, version, plural, namespace, name) =>
    http.post(`${resPath(group, version, plural, namespace, name)}/restart`, {}),
  apply: (yaml, options = {}) => http.post('/v1/apply', { yaml, ...options }),

  // ---- 节点 / Pod ----
  cordon: (name, unschedulable) => http.post(`/v1/nodes/${encodeURIComponent(name)}/cordon`, { unschedulable }),
  podEvents: (namespace, name) => http.get(`/v1/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/events`),
  restartPod: (namespace, name) => http.post(`/v1/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/restart`, {}),
  nodeMetrics: () => http.get('/v1/metrics/nodes'),
  podMetrics: (namespace) => http.get('/v1/metrics/pods', { params: { namespace } }),

  // ---- 镜像仓库（平台级） ----
  registries: () => http.get('/v1/registries'),
  addRegistry: body => http.post('/v1/registries', body),
  updateRegistry: (id, body) => http.patch(`/v1/registries/${encodeURIComponent(id)}`, body),
  removeRegistry: id => http.delete(`/v1/registries/${encodeURIComponent(id)}`),
  testRegistry: id => http.post(`/v1/registries/${encodeURIComponent(id)}/test`, {}),
  discoverRegistries: (clusterId, namespace) => http.post('/v1/registries/discover', { clusterId, namespace }),
  registryProjects: id => http.get(`/v1/registries/${encodeURIComponent(id)}/projects`),
  registryRepositories: (id, project) => http.get(`/v1/registries/${encodeURIComponent(id)}/repositories`, { params: { project } }),
  registryArtifacts: (id, project, repository) =>
    http.get(`/v1/registries/${encodeURIComponent(id)}/artifacts`, { params: { project, repository } }),

  // ---- 监控（平台级 + 集群级指标） ----
  monitor: () => http.get('/v1/monitor'),
  saveMonitor: body => http.post('/v1/monitor', body),
  testMonitor: body => http.post('/v1/monitor/test', body),
  dashboards: () => http.get('/v1/monitor/dashboards'),
}

// ---- SSE / WebSocket 地址（浏览器原生 API，不走 axios）----
export function logsUrl(namespace, pod, params = {}) {
  const q = new URLSearchParams({
    ...params,
    token: localStorage.getItem('kp_token') || '',
    clusterId: localStorage.getItem('kp_cluster') || '',
  })
  return `/api/v1/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/logs?${q}`
}

export function execWsUrl({ namespace, pod, container, shell }) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const q = new URLSearchParams({
    namespace, pod,
    container: container || '',
    shell: shell || '/bin/sh',
    token: localStorage.getItem('kp_token') || '',
    clusterId: localStorage.getItem('kp_cluster') || '',
  })
  return `${proto}//${location.host}/api/v1/ws/exec?${q}`
}

export default api
