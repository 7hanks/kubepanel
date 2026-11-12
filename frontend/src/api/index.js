import axios from 'axios'
import { ElMessage } from 'element-plus'
import { uploadFile } from '../utils/container-transfer'

// 后端同源托管，所有接口都在 /api 下
const http = axios.create({ baseURL: '/api', timeout: 30000, withCredentials: true })

http.interceptors.request.use(cfg => {
  const csrf = sessionStorage.getItem('kp_csrf')
  if (csrf && !['get','head','options'].includes(String(cfg.method).toLowerCase())) cfg.headers['X-CSRF-Token'] = csrf
  // 除集群管理接口外，所有请求都带上当前集群；后端按 clusterId 选择客户端
  const clusterId = localStorage.getItem('kp_cluster')
  if (clusterId) cfg.params = { clusterId, ...cfg.params }
  return cfg
})

http.interceptors.response.use(
  res => res.data,
  err => {
    const status = err.response?.status
    const msg = err.response?.data?.message || err.message || '请求失败'
    // 登录接口的失败由登录页就地展示（401 即「用户名或密码错误」），
    // 这里既不弹全局提示也不跳转，否则登录页的提示会被静默吞掉
    const isLogin = String(err.config?.url || '').includes('/auth/login')
    if (axios.isCancel(err)) return Promise.reject({ cancelled: true, message: '请求已取消' })
    if (status === 401) {
      for (const key of ['kp_token','kp_authenticated','kp_user','kp_perms','kp_role','kp_role_name','kp_scope']) localStorage.removeItem(key)
      sessionStorage.removeItem('kp_csrf')
    }
    if (!isLogin) {
      if (status === 401) {
        if (!location.pathname.startsWith('/login')) location.href = '/login'
      } else if (status !== 404 && !err.config?.silent) {
        ElMessage.error(typeof msg === 'string' ? msg.slice(0, 300) : '请求失败')
      }
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
  containerFile: (body,config={}) => http.post('/v1/container/files',body,{timeout:20000,...config}),
  containerUpload: (target,file,config={}) => uploadFile(http,target,file,config),
  containerDownloadTicket: (body,config={}) => http.post('/v1/container/files/download-ticket',body,{timeout:20000,...config,params:{...config.params,clusterId:body.clusterId}}),
  streamTicket: body => http.post('/v1/auth/stream-ticket', body),
  audit: params => http.get('/v1/audit', { params }),
  history: (namespace,name,kind) => http.get(`/v1/workloads/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/history`, {params:{kind}}),
  rollback: (namespace,name,kind,revision,dryRun) => http.post(`/v1/workloads/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/rollback`, {revision,dryRun}, {params:{kind}}),
  runCronJob: (namespace,name,dryRun) => http.post(`/v1/cronjobs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/run`, {dryRun}),
  suspendCronJob: (namespace,name,suspend,dryRun) => http.post(`/v1/cronjobs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/suspend`, {suspend,dryRun}),
  drainPreflight: name => http.get(`/v1/nodes/${encodeURIComponent(name)}/drain`),
  drain: (name,body) => http.post(`/v1/nodes/${encodeURIComponent(name)}/drain`, body),
  // ---- 认证 ----
  login: (username, password) => http.post('/auth/login', { username, password }),
  logout: () => http.post('/auth/logout'),
  profile: () => http.get('/v1/auth/profile'),
  changePassword: (currentPassword, newPassword) =>
    http.post('/v1/auth/password', { currentPassword, newPassword }),

  // ---- 用户与角色管理（平台级） ----
  roles: () => http.get('/v1/roles'),
  createRole: body => http.post('/v1/roles', body),
  updateRole: (id, body) => http.patch(`/v1/roles/${encodeURIComponent(id)}`, body),
  removeRole: id => http.delete(`/v1/roles/${encodeURIComponent(id)}`),
  users: () => http.get('/v1/users'),
  createUser: body => http.post('/v1/users', body),
  updateUser: (username, body) => http.patch(`/v1/users/${encodeURIComponent(username)}`, body),
  removeUser: username => http.delete(`/v1/users/${encodeURIComponent(username)}`),

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
  overview: (namespace) => http.get('/v1/overview', { params: { namespace } }),
  discovery: () => http.get('/v1/resources'),

  // ---- 通用资源 CRUD ----
  list: (group, version, plural, params = {}, config = {}) =>
    http.get(resPath(group, version, plural), { ...config, params }),
  get: (group, version, plural, namespace, name) =>
    http.get(resPath(group, version, plural, namespace, name)),
  create: (group, version, plural, namespace, body, params = {}) =>
    http.post(resPath(group, version, plural), body, { params: { namespace, ...params } }),
  update: (group, version, plural, namespace, name, body, params = {}) =>
    http.put(resPath(group, version, plural, namespace, name), body, { params }),
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
  restartPod: (namespace, name, {dryRun=false,uid,clusterId,signal,silent=false}={}) => http.post(`/v1/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/restart`, {dryRun,...(uid===undefined?{}:{uid})},{params:clusterId?{clusterId}:{},signal,silent}),
  nodeMetrics: () => http.get('/v1/metrics/nodes'),
  podMetrics: (namespace) => http.get('/v1/metrics/pods', { params: { namespace } }),

  // ---- 镜像仓库（平台级） ----
  registries: () => http.get('/v1/registries'),
  addRegistry: body => http.post('/v1/registries', body),
  updateRegistry: (id, body) => http.patch(`/v1/registries/${encodeURIComponent(id)}`, body),
  removeRegistry: id => http.delete(`/v1/registries/${encodeURIComponent(id)}`),
  testRegistry: id => http.post(`/v1/registries/${encodeURIComponent(id)}/test`, {}),
  discoverRegistries: (clusterId, namespace) => http.post('/v1/registries/discover', { clusterId, namespace }),
  registryProjects: (id,options={}) => http.get(`/v1/registries/${encodeURIComponent(id)}/projects`,{params:options}),
  registryRepositories: (id, project, options={}) => http.get(`/v1/registries/${encodeURIComponent(id)}/repositories`, { params: { project,...options } }),
  registryArtifacts: (id, project, repository, options={}) =>
    http.get(`/v1/registries/${encodeURIComponent(id)}/artifacts`, { params: { project, repository,...options } }),

  // ---- 监控（平台级，多 Grafana 实例 + 集群级指标） ----
  monitor: () => http.get('/v1/monitor'),
  createMonitor: body => http.post('/v1/monitor', body),
  updateMonitor: (id, body) => http.patch(`/v1/monitor/${encodeURIComponent(id)}`, body),
  removeMonitor: id => http.delete(`/v1/monitor/${encodeURIComponent(id)}`),
  testMonitor: body => http.post('/v1/monitor/test', body),
  dashboards: id => http.get('/v1/monitor/dashboards', { params: id ? { id } : {} }),
}

// ---- SSE / WebSocket 地址（浏览器原生 API，不走 axios）----
export function logsUrl(namespace, pod, params = {}) {
  const q = new URLSearchParams({
    ...params,
    clusterId: localStorage.getItem('kp_cluster') || '',
  })
  return `/api/v1/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/logs?${q}`
}

export function execWsUrl({ namespace, pod, container, shell, ticket }) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const q = new URLSearchParams({
    namespace, pod, ticket,
    container: container || '',
    shell: shell || '/bin/sh',
    clusterId: localStorage.getItem('kp_cluster') || '',
  })
  return `${proto}//${location.host}/api/v1/ws/exec?${q}`
}

export default api
