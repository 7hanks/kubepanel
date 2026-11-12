import express from 'express'
import { authMiddleware, login, logout, profile, changePassword, issueStreamTicket, activeStreamAccount } from './auth.js'
import { containerTools } from './containerTools.js'
import { createDownloadTickets, transferSize } from './fileTransfer.js'
import {
  kubeRequest, resRequest, KUBE_HEADERS, KubeError,
  discoverResources, kubeContext, getCluster, getDefaultClusterId,
  resourceMeta,
} from './kube.js'
import {
  initClusters, clusterSummaries, addCluster, updateCluster, removeCluster, testCluster, clusterDetail,
} from './clusterService.js'
import { clusterInfo, overview, applyYaml, scaleResource, restartWorkload, cordonNode } from './actions.js'
import { streamPodLogs } from './logs.js'
import {
  listRegistries, addRegistry, updateRegistry, removeRegistry, testRegistry,
  listProjects, listRepositories, listArtifacts, discoverRegistries,
} from './registryService.js'
import { monitorView, createMonitor, updateMonitor, deleteMonitor, testMonitor, listDashboards, parseCpu, parseMem, fmtCpu, fmtBytes } from './monitorService.js'
import { can, canAny, OBJECTS, ACTIONS, PERMISSIONS, PERMISSION_LABEL, SENSITIVE_PERMISSIONS } from './permissions.js'
import { assertResourceAccess, assertClusterAccess, resourceAllowed } from './access.js'
import { scopedList } from './resourceScope.js'
import { operations } from './operations.js'
import { podScaling } from './podScaling.js'
import { listAudit } from './auditService.js'
import { listRoles, createRole, updateRole, deleteRole } from './roleService.js'
import { listUsers, createUser, updateUser, deleteUser, countUsersByRole } from './userService.js'

const router = express.Router()
const downloadTickets = createDownloadTickets()
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

/** 越权拦截：账号缺少权限码时返回 403，前端按 message 提示 */
function requirePerm(...perms) {
  return (req, res, next) => {
    if (canAny(req.account, perms)) return next()
    return res.status(403).json({
      message: '当前账号没有执行该操作的权限',
      required: perms,
      role: req.account?.role || '',
    })
  }
}
function requireAll(...perms) {
  return (req, res, next) => perms.every(p => can(req.account, p)) ? next() : res.status(403).json({ message: '当前账号缺少执行该操作的完整权限', required: perms })
}
function bool(value, fallback = false) {
  if (value === undefined) return fallback
  if ([true, 'true', '1', 1].includes(value)) return true
  if ([false, 'false', '0', 0].includes(value)) return false
  throw new KubeError(400, '布尔参数必须是 true 或 false')
}
const opOptions = req => ({ dryRun: bool(req.body?.dryRun ?? req.query.dryRun), authorize: meta => assertResourceAccess(req.account, { ...meta, clusterId: req.clusterId }) })
async function target(req, verb) {
  const meta = await resourceMeta(metaOf(req), req.clusterId)
  if (!meta.verbs.includes(verb)) throw new KubeError(405, `资源不支持 ${verb}`)
  const namespace = nsOf(req) || (verb === 'create' && meta.namespaced ? req.body?.metadata?.namespace || 'default' : undefined)
  if (!meta.namespaced && nsOf(req)) throw new KubeError(400, '集群级资源不能指定 namespace')
  if (meta.namespaced && !namespace && verb !== 'list') throw new KubeError(400, '该资源必须指定 namespace')
  if (verb !== 'list') assertResourceAccess(req.account, { ...meta, clusterId: req.clusterId, namespace, verb })
  return { meta, namespace }
}
function validateBody(body, meta, namespace, name) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new KubeError(400, '请求体必须是资源对象')
  const av = meta.group ? `${meta.group}/${meta.version}` : meta.version
  if ((body.apiVersion && body.apiVersion !== av) || (body.kind && body.kind !== meta.kind)
    || (name && body.metadata?.name && name !== body.metadata.name)
    || (body.metadata?.namespace && body.metadata.namespace !== namespace)) throw new KubeError(400, '资源 apiVersion/kind/name/namespace 与请求目标不一致')
}
function resourceResponse(account, meta, data) {
  if (meta.group || meta.plural !== 'secrets' || can(account, 'secret:read') || !data || data.kind === 'Status') return data
  const metadata = {}
  for (const key of ['name', 'namespace', 'uid', 'resourceVersion', 'creationTimestamp']) if (data.metadata?.[key] !== undefined) metadata[key] = data.metadata[key]
  return { apiVersion: data.apiVersion, kind: data.kind, metadata, type: data.type, redacted: true }
}
async function metricsPods(account, clusterId, namespace, limit) {
  const data = await scopedList(account, { group: 'metrics.k8s.io', version: 'v1beta1', plural: 'pods', namespaced: true }, { clusterId, namespace, timeout: 6000 })
  const pods = await scopedList(account, { group: '', version: 'v1', plural: 'pods', namespaced: true }, { clusterId, namespace, timeout: 6000 })
  const byName = new Map((pods.items || []).map(p => [`${p.metadata.namespace}/${p.metadata.name}`, p]))
  const items = (data.items || []).map(p => {
    const usage = (p.containers || []).reduce((a, c) => ({ cpu: a.cpu + parseCpu(c.usage?.cpu), mem: a.mem + parseMem(c.usage?.memory) }), { cpu: 0, mem: 0 })
    const requests = (byName.get(`${p.metadata.namespace}/${p.metadata.name}`)?.spec?.containers || []).reduce((a, c) => ({ cpu: a.cpu + parseCpu(c.resources?.requests?.cpu), mem: a.mem + parseMem(c.resources?.requests?.memory) }), { cpu: 0, mem: 0 })
    return { namespace: p.metadata.namespace, name: p.metadata.name, cpu: usage.cpu, cpuText: fmtCpu(usage.cpu), memory: usage.mem, memoryText: fmtBytes(usage.mem), cpuPercent: requests.cpu > 0 ? Math.round(usage.cpu / requests.cpu * 100) : null, memoryPercent: requests.mem > 0 ? Math.round(usage.mem / requests.mem * 100) : null, timestamp: p.timestamp }
  }).sort((a, b) => b.cpu - a.cpu)
  return { items: limit ? items.slice(0, Math.min(100, Math.max(1, Number(limit) || 10))) : items, total: items.length, totalCpu: items.reduce((a, b) => a + b.cpu, 0), totalMemory: items.reduce((a, b) => a + b.memory, 0), timestamp: items[0]?.timestamp || null }
}

/** 服务层抛出的 { status } 错误转成 KubeError，保留 4xx 语义 */
function rethrow(e) {
  if (e instanceof KubeError) throw e
  throw new KubeError(e?.status || 500, e?.message || '操作失败')
}

/** 从路由参数还原 GVK 元数据；_core 代表 core API 组 */
function metaOf(req) {
  return {
    group: !req.params.group || req.params.group === '_core' ? '' : req.params.group,
    version: req.params.version || 'v1',
    plural: req.params.plural,
  }
}
function nsOf(req) {
  // Path namespace is an actual object identity; "all" is a valid K8s namespace name.
  if (req.params.namespace) return ['_all','-'].includes(req.params.namespace) ? undefined : req.params.namespace
  const v = req.query.namespace
  // '-' 是前端对「无命名空间」的显示占位，不能拼进 /namespaces/-/...
  return !v || v === 'all' || v === '_all' || v === '-' ? undefined : v
}
function listQuery(req) {
  const out = {}
  for (const k of ['labelSelector', 'fieldSelector', 'limit', 'continue', 'resourceVersion', 'timeoutSeconds']) {
    if (req.query[k] !== undefined) out[k] = req.query[k]
  }
  return out
}

// ---------------- 认证 ----------------
router.post('/auth/login', login)
router.use(authMiddleware)
router.post('/auth/logout', wrap(logout))
router.post('/v1/auth/stream-ticket', wrap(issueStreamTicket))

// ---------------- 账号（登录后） ----------------
router.get('/v1/auth/profile', wrap(async (req, res) => profile(req, res)))
router.post('/v1/auth/password', wrap(async (req, res) => changePassword(req, res)))

// ---------------- 用户与角色管理（平台级，需要 user 对象权限） ----------------
router.get('/v1/roles', requirePerm('user:list', 'user:detail'), wrap(async (req, res) => {
  const roles = listRoles().map(r => ({
    ...r,
    permissionLabels: r.permissions.map(p => PERMISSION_LABEL.get(p) || p),
    userCount: countUsersByRole(r.id),
  }))
  res.json({ roles, objects: OBJECTS, actions: ACTIONS, permissions: PERMISSIONS, sensitivePermissions: SENSITIVE_PERMISSIONS })
}))

router.post('/v1/roles', requirePerm('user:create'), wrap(async (req, res) => {
  try {
    res.status(201).json(createRole(req.body || {}))
  } catch (e) { rethrow(e) }
}))

router.patch('/v1/roles/:id', requirePerm('user:update'), wrap(async (req, res) => {
  try {
    res.json(updateRole(req.params.id, req.body || {}))
  } catch (e) { rethrow(e) }
}))

router.delete('/v1/roles/:id', requirePerm('user:delete'), wrap(async (req, res) => {
  try {
    const used = countUsersByRole(req.params.id)
    if (used > 0) throw new KubeError(400, `该角色下还有 ${used} 个账号，请先为这些账号换绑其他角色`)
    res.json(deleteRole(req.params.id))
  } catch (e) { rethrow(e) }
}))

router.get('/v1/users', requirePerm('user:list', 'user:detail'), wrap(async (req, res) => {
  res.json({ items: listUsers() })
}))

router.post('/v1/users', requirePerm('user:create'), wrap(async (req, res) => {
  try {
    res.status(201).json(createUser(req.body || {}))
  } catch (e) { rethrow(e) }
}))

router.patch('/v1/users/:username', requirePerm('user:update'), wrap(async (req, res) => {
  try {
    const patch = { ...(req.body || {}) }
    // 自助改密码走 /v1/auth/password；这里只允许管理员重置他人密码
    if (req.params.username === req.account?.username) {
      throw new KubeError(400, '不能在这里修改自己的账号，请使用右上角「修改密码」')
    }
    res.json(updateUser(req.params.username, patch))
  } catch (e) { rethrow(e) }
}))

router.delete('/v1/users/:username', requirePerm('user:delete'), wrap(async (req, res) => {
  try {
    if (req.params.username === req.account?.username) {
      throw new KubeError(400, '不能删除当前登录的账号')
    }
    res.json(deleteUser(req.params.username))
  } catch (e) { rethrow(e) }
}))

// ---------------- 集群管理（平台级，不需要指定 clusterId） ----------------
router.get('/v1/clusters', requirePerm('cluster:list', 'cluster:detail'), wrap(async (req, res) => {
  res.json(await clusterSummaries(String(req.query.refresh) === '1', req.account))
}))
router.post('/v1/clusters', requirePerm('cluster:import'), wrap(async (req, res) => {
  const { name, kubeconfig } = req.body || {}
  res.status(201).json(addCluster(name, kubeconfig))
}))
router.post('/v1/clusters/:id/test', requirePerm('cluster:detail', 'cluster:list'), wrap(async (req, res) => {
  assertClusterAccess(req.account, req.params.id)
  res.json(await testCluster(req.params.id))
}))
router.put('/v1/clusters/:id', requirePerm('cluster:import'), wrap(async (req, res) => {
  assertClusterAccess(req.account, req.params.id)
  res.json(updateCluster(req.params.id, req.body || {}, req.account))
}))
router.get('/v1/clusters/:id/detail', requirePerm('cluster:detail', 'cluster:list'), wrap(async (req, res) => {
  assertClusterAccess(req.account, req.params.id)
  res.json(await clusterDetail(req.params.id, req.account))
}))
// 平台级：集群详情抽屉里的「资源使用率 TOP 10」，走 metrics-server
router.get('/v1/clusters/:id/top-pods', requirePerm('cluster:detail', 'cluster:list'), wrap(async (req, res) => {
  const id = req.params.id
  assertClusterAccess(req.account, id)
  try {
    res.json({ available: true, ...(await metricsPods(req.account, id, undefined, req.query.limit || 10)) })
  } catch (e) {
    if (e.status === 403) throw e
    res.json({ available: false, items: [], total: null, message: e.message })
  }
}))
router.delete('/v1/clusters/:id', requirePerm('cluster:remove'), wrap(async (req, res) => {
  assertClusterAccess(req.account, req.params.id)
  res.json(removeCluster(req.params.id, req.account))
}))

// ---------------- 镜像仓库（平台级，Harbor） ----------------
router.get('/v1/registries', requirePerm('registry:list', 'registry:detail'), wrap(async (req, res) => res.json(listRegistries())))
router.post('/v1/registries', requirePerm('registry:create'), wrap(async (req, res) => {
  res.status(201).json(await addRegistry(req.body || {}))
}))
router.post('/v1/registries/discover', requirePerm('registry:create'), wrap(async (req, res) => {
  const { clusterId, namespace } = req.body || {}
  const id = getCluster(clusterId).id
  assertResourceAccess(req.account, { clusterId: id, namespace: namespace || 'harbor', group: '', plural: 'services', verb: 'list' })
  res.json(await discoverRegistries(id, namespace || 'harbor', { account: req.account }))
}))
router.patch('/v1/registries/:id', requirePerm('registry:update'), wrap(async (req, res) => {
  res.json(await updateRegistry(req.params.id, req.body || {}))
}))
router.delete('/v1/registries/:id', requirePerm('registry:delete'), wrap(async (req, res) => {
  res.json(removeRegistry(req.params.id))
}))
router.post('/v1/registries/:id/test', requirePerm('registry:detail', 'registry:update'), wrap(async (req, res) => {
  res.json(await testRegistry(req.params.id))
}))
router.get('/v1/registries/:id/projects', requirePerm('registry:detail', 'registry:list'), wrap(async (req, res) => {
  res.json(await listProjects(req.params.id, req.query))
}))
router.get('/v1/registries/:id/repositories', requirePerm('registry:detail', 'registry:list'), wrap(async (req, res) => {
  res.json(await listRepositories(req.params.id, String(req.query.project || ''), req.query))
}))
router.get('/v1/registries/:id/artifacts', requirePerm('registry:detail', 'registry:list'), wrap(async (req, res) => {
  res.json(await listArtifacts(req.params.id, String(req.query.project || ''), String(req.query.repository || ''), req.query))
}))

// ---------------- 监控（平台级，Grafana，支持多实例 / 多环境） ----------------
// 静态路径先注册，避免与 /:id 混淆
router.get('/v1/monitor', requirePerm('monitor:list', 'monitor:detail'), wrap(async (req, res) => res.json(monitorView())))
router.get('/v1/monitor/dashboards', requirePerm('monitor:detail', 'monitor:list'), wrap(async (req, res) => {
  res.json(await listDashboards(req.query.id))
}))
router.post('/v1/monitor', requirePerm('monitor:create'), wrap(async (req, res) => {
  res.status(201).json(createMonitor(req.body || {}))
}))
router.post('/v1/monitor/test', requirePerm('monitor:update', 'monitor:create'), wrap(async (req, res) => {
  res.json(await testMonitor(req.body || {}))
}))
router.patch('/v1/monitor/:id', requirePerm('monitor:update'), wrap(async (req, res) => {
  res.json(updateMonitor(req.params.id, req.body || {}))
}))
router.delete('/v1/monitor/:id', requirePerm('monitor:delete'), wrap(async (req, res) => {
  res.json(deleteMonitor(req.params.id))
}))

// ---------------- 以下所有接口都需要选定集群 ----------------
router.get('/v1/audit', requirePerm('audit:list'), wrap(async (req, res) => res.json(listAudit(req.query))))
// 集群级接口统一鉴权：读需要 cluster:list / cluster:detail，写操作按具体权限码判断
router.use(requirePerm('cluster:list', 'cluster:detail',
  'cluster:create', 'cluster:update', 'cluster:delete'))

// clusterId 可通过 query（axios 统一注入）、X-Cluster-Id 请求头或 body 传递
router.use((req, res, next) => {
  const raw = req.query.clusterId || req.headers['x-cluster-id'] || req.body?.clusterId
  try {
    req.clusterId = getCluster(raw).id
    assertClusterAccess(req.account, req.clusterId)
    next()
  } catch (e) {
    res.status(e.status || 404).json({
      message: e.message || '集群不存在',
      hint: '请返回集群列表重新选择一个集群',
    })
  }
})

// ---------------- 集群信息 ----------------
const transferContext=(req,res)=>{
  const controller=new AbortController(),initial={...req.account,sessionId:req.session?.id}
  const close=()=>{if(!res.writableEnded)controller.abort()}
  res.on('close',close)
  res.setHeader('Cache-Control','no-store')
  res.setHeader('Referrer-Policy','no-referrer')
  return {signal:controller.signal,live:()=>{const account=activeStreamAccount(initial);if(!account)throw Object.assign(new Error('会话已失效'),{status:401});return account},cleanup:()=>res.off('close',close)}
}
router.post('/v1/container/files/upload',wrap(async(req,res)=>{
  const options=transferContext(req,res)
  try{
    if(!req.is('application/octet-stream'))throw new KubeError(415,'上传文件必须使用二进制流')
    const size=transferSize(req.query.size)
    if(req.headers['content-length']!==undefined&&String(size)!==req.headers['content-length'])throw new KubeError(400,'上传文件大小与请求长度不一致')
    res.json(await containerTools.upload(req.account,req.clusterId,{...req.query,size,confirmed:bool(req.query.confirmed),overwrite:bool(req.query.overwrite)}, {...options,input:req}))
  }catch(e){
    // Do not leave an unread multi-GiB request on a keep-alive connection.
    if(!req.complete){res.setHeader('Connection','close');res.once('finish',()=>req.destroy())}
    throw e
  }finally{options.cleanup()}
}))
router.post('/v1/container/files/download-ticket',wrap(async(req,res)=>{
  const options=transferContext(req,res)
  try{
    const target={...req.body,clusterId:req.clusterId},bytes=await containerTools.downloadInfo(req.account,req.clusterId,target,options)
    const ticket=downloadTickets.issue(req.account,req.session?.id,{...target,bytes})
    res.json({url:`/api/v1/container/files/download?clusterId=${encodeURIComponent(req.clusterId)}&ticket=${encodeURIComponent(ticket)}`,bytes})
  }finally{options.cleanup()}
}))
router.get('/v1/container/files/download',wrap(async(req,res)=>{
  const options=transferContext(req,res)
  try{
    const target=downloadTickets.consume(req.query.ticket,req.account,req.session?.id,req.clusterId)
    await containerTools.download(req.account,req.clusterId,target,{...options,output:res,onReady:size=>{
      const name=target.path.split('/').pop()||'download'
      res.setHeader('Content-Type','application/octet-stream')
      res.setHeader('Content-Length',String(size))
      res.setHeader('Content-Disposition',`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`)
      res.setHeader('X-Content-Type-Options','nosniff')
    }})
    res.end()
  }catch(e){
    if(res.headersSent){res.destroy();return}
    res.removeHeader('Content-Length');res.removeHeader('Content-Disposition');res.removeHeader('Content-Type')
    throw e
  }finally{options.cleanup()}
}))
router.post('/v1/container/files',wrap(async(req,res)=>{
  const controller=new AbortController()
  const close=()=>{if(!res.writableEnded)controller.abort()}
  res.on('close',close)
  const initial={...req.account,sessionId:req.session?.id}
  const live=()=>{const account=activeStreamAccount(initial);if(!account)throw Object.assign(new Error('会话已失效'),{status:401});return account}
  try{res.setHeader('Cache-Control','no-store');res.json(await containerTools.file(req.account,req.clusterId,req.body||{},{signal:controller.signal,live}))}
  finally{res.off('close',close)}
}))
router.get('/v1/cluster', requirePerm('cluster:list', 'cluster:detail'), wrap(async (req, res) => res.json(await clusterInfo(req.clusterId, req.account))))
router.get('/v1/overview', requirePerm('cluster:list', 'cluster:detail'), wrap(async (req, res) => res.json(await overview(req.clusterId, nsOf(req), req.account))))
router.get('/v1/resources', requirePerm('cluster:list', 'cluster:detail'), wrap(async (req, res) => {
  const force = String(req.query.refresh) === '1'
  res.json((await discoverResources(force, req.clusterId)).filter(r => resourceAllowed(req.account, r)))
}))

// ---------------- 通用资源 CRUD ----------------
router.get('/v1/resources/:group/:version/:plural', requirePerm('cluster:list', 'cluster:detail'), wrap(async (req, res) => {
  const { meta, namespace } = await target(req, 'list')
  res.json(await scopedList(req.account, meta, { namespace, query: listQuery(req), clusterId: req.clusterId }))
}))

router.post('/v1/resources/:group/:version/:plural', requirePerm('cluster:create'), wrap(async (req, res) => {
  const { meta, namespace } = await target(req, 'create')
  const body = req.body
  if (!body || !body.metadata?.name) throw new KubeError(400, '请求体必须包含 metadata.name')
  validateBody(body, meta, namespace)
  const r = await resRequest('POST', meta, { namespace, body, query: bool(req.query.dryRun) ? { dryRun: 'All' } : {}, clusterId: req.clusterId })
  res.status(201).json(resourceResponse(req.account, meta, r.data))
}))

router.get('/v1/resources/:group/:version/:plural/:namespace/:name', requirePerm('cluster:detail', 'cluster:list'), wrap(async (req, res) => {
  const { meta, namespace } = await target(req, 'get')
  const r = await resRequest('GET', meta, {
    namespace, name: req.params.name, clusterId: req.clusterId,
  })
  res.json(r.data)
}))

router.put('/v1/resources/:group/:version/:plural/:namespace/:name', requirePerm('cluster:update'), wrap(async (req, res) => {
  const { meta, namespace } = await target(req, 'update')
  validateBody(req.body, meta, namespace, req.params.name)
  if (!req.body.metadata?.resourceVersion) throw new KubeError(400, '更新资源必须保留 metadata.resourceVersion，请刷新后重试')
  try {
    const r = await resRequest('PUT', meta, {
      namespace, name: req.params.name, body: req.body, query: bool(req.query.dryRun) ? { dryRun: 'All' } : {}, clusterId: req.clusterId,
    })
    res.json(resourceResponse(req.account, meta, r.data))
  } catch (e) {
    if (e instanceof KubeError && (e.status === 409 || /has been modified/i.test(e.message || ''))) {
      throw new KubeError(409, '资源已被其他客户端修改，请刷新页面后重新编辑（K8s 乐观锁冲突）')
    }
    throw e
  }
}))

router.patch('/v1/resources/:group/:version/:plural/:namespace/:name', requirePerm('cluster:update'), wrap(async (req, res) => {
  const { meta, namespace } = await target(req, 'patch')
  const type = req.query.patchType || 'merge'
  const headers = {
    merge: KUBE_HEADERS.mergePatch,
    strategic: KUBE_HEADERS.strategicPatch,
    json: KUBE_HEADERS.jsonPatch,
  }[type]
  if (!headers) throw new KubeError(400, '不支持的 patchType')
  if (type !== 'json') validateBody(req.body, meta, namespace, req.params.name)
  else if (!Array.isArray(req.body)) throw new KubeError(400, 'JSON Patch 必须是操作数组')
  const r = await resRequest('PATCH', meta, {
    namespace, name: req.params.name, body: req.body, headers, query: bool(req.query.dryRun) ? { dryRun: 'All' } : {}, clusterId: req.clusterId,
  })
  res.json(resourceResponse(req.account, meta, r.data))
}))

router.delete('/v1/resources/:group/:version/:plural/:namespace/:name', requirePerm('cluster:delete'), wrap(async (req, res) => {
  const { meta, namespace } = await target(req, 'delete')
  const query = {}
  if (req.query.gracePeriodSeconds !== undefined) query.gracePeriodSeconds = req.query.gracePeriodSeconds
  if (req.query.propagationPolicy !== undefined) query.propagationPolicy = req.query.propagationPolicy
  if (bool(req.query.dryRun)) query.dryRun = 'All'
  const r = await resRequest('DELETE', meta, {
    namespace, name: req.params.name, query, clusterId: req.clusterId,
  })
  res.json(resourceResponse(req.account, meta, r.data))
}))

router.post('/v1/resources/:group/:version/:plural/:namespace/:name/scale', requirePerm('cluster:update'), wrap(async (req, res) => {
  const { meta, namespace } = await target(req, 'patch')
  if (meta.group !== 'apps' || !['deployments', 'statefulsets', 'replicasets'].includes(meta.plural)) throw new KubeError(400, '该资源不支持扩缩容')
  const r = await scaleResource(meta, namespace, req.params.name, req.body?.replicas, req.clusterId, { dryRun: bool(req.body?.dryRun) })
  res.json(r.data)
}))
router.post('/v1/resources/:group/:version/:plural/:namespace/:name/restart', requirePerm('cluster:update'), wrap(async (req, res) => {
  const { meta, namespace } = await target(req, 'patch')
  if (meta.group !== 'apps' || !['deployments', 'statefulsets', 'daemonsets'].includes(meta.plural)) throw new KubeError(400, '该资源不支持滚动重启')
  const r = await restartWorkload(meta, namespace, req.params.name, req.clusterId, { dryRun: bool(req.body?.dryRun) })
  res.json(r.data)
}))

// ---------------- 组合操作 ----------------
router.post('/v1/apply', requireAll('cluster:create', 'cluster:update'), wrap(async (req, res) => {
  const yamlText = req.body?.yaml
  if (!yamlText || typeof yamlText !== 'string') throw new KubeError(400, '请求体缺少 yaml 字段')
  const options = { ...opOptions(req), force: bool(req.body?.force) }
  if (options.force && !can(req.account, 'apply:force')) throw new KubeError(403, '强制接管字段需要 apply:force 权限')
  res.json(await applyYaml(yamlText, req.body?.defaultNamespace, req.clusterId, options))
}))

router.post('/v1/nodes/:name/cordon', requireAll('cluster:update', 'node:maintain'), wrap(async (req, res) => {
  assertResourceAccess(req.account, { clusterId: req.clusterId, group: '', plural: 'nodes', verb: 'patch' })
  const r = await cordonNode(req.params.name, bool(req.body?.unschedulable, true), req.clusterId, { dryRun: bool(req.body?.dryRun) })
  res.json(r.data)
}))

// ---------------- Pod 日志 / 事件 / 指标 ----------------
router.get('/v1/pods/:namespace/:name/logs', requirePerm('pod:logs'), wrap(async (req, res) => {
  assertResourceAccess(req.account, { clusterId: req.clusterId, group: '', plural: 'pods', namespace: req.params.namespace, verb: 'get' })
  return streamPodLogs(req, res)
}))

/**
 * Pod 重建通过 Eviction 保留 PDB 与 UID 保护，不保证控制器一定能补足副本。
 */
router.post('/v1/pods/:namespace/:name/restart', requireAll('cluster:update', 'cluster:delete'), wrap(async (req, res) => {
  res.json(await operations.restartPod(req.params.namespace, req.params.name, req.clusterId, {...opOptions(req),uid:req.body?.uid}))
}))

router.get('/v1/pods/:namespace/:name/scale-target', requirePerm('cluster:detail', 'cluster:list'), wrap(async (req, res) => {
  res.json(await podScaling.resolveTarget(req.params.namespace, req.params.name, req.clusterId, { ...opOptions(req), uid: req.query.uid }))
}))
router.post('/v1/pods/:namespace/:name/scale', requirePerm('cluster:update'), wrap(async (req, res) => {
  res.json(await podScaling.scalePod(req.params.namespace, req.params.name, req.clusterId, {
    ...opOptions(req), uid: req.body?.uid, controllerUid: req.body?.controllerUid,
    replicas: req.body?.replicas, expectedReplicas: req.body?.expectedReplicas,
  }))
}))

router.get('/v1/pods/:namespace/:name/events', requirePerm('cluster:detail', 'cluster:list'), wrap(async (req, res) => {
  assertResourceAccess(req.account, { clusterId: req.clusterId, group: '', plural: 'pods', namespace: req.params.namespace, verb: 'get' })
  assertResourceAccess(req.account, { clusterId: req.clusterId, group: '', plural: 'events', namespace: req.params.namespace, verb: 'list' })
  const q = new URLSearchParams({
    fieldSelector: `involvedObject.name=${req.params.name},involvedObject.namespace=${req.params.namespace}`,
  })
  const r = await kubeRequest('GET',
    `/api/v1/namespaces/${encodeURIComponent(req.params.namespace)}/events?${q}`,
    { clusterId: req.clusterId })
  res.json(r.data)
}))

router.get('/v1/metrics/nodes', requirePerm('cluster:list', 'cluster:detail'), wrap(async (req, res) => {
  assertResourceAccess(req.account, { clusterId: req.clusterId, group: 'metrics.k8s.io', plural: 'nodes', verb: 'list' })
  assertResourceAccess(req.account, { clusterId: req.clusterId, group: '', plural: 'nodes', verb: 'list' })
  try {
    const [m, nodes] = await Promise.all([
      kubeRequest('GET', '/apis/metrics.k8s.io/v1beta1/nodes', { timeout: 5000, clusterId: req.clusterId }),
      kubeRequest('GET', '/api/v1/nodes', { timeout: 5000, clusterId: req.clusterId }).catch(() => null),
    ])
    // 附带节点可分配容量，前端才能画出「用量 / 容量」的真实占比
    const cap = {}
    for (const n of nodes?.data?.items || []) {
      const a = n.status?.allocatable || n.status?.capacity || {}
      cap[n.metadata?.name] = { cpu: a.cpu || '', memory: a.memory || '', pods: a.pods || '' }
    }
    const items = (m.data.items || []).map(x => ({ ...x, capacity: cap[x.metadata?.name] || null }))
    res.json({ available: true, items, capacities: cap })
  } catch (e) {
    res.json({ available: false, items: [], message: e.message || '未安装 metrics-server 或无访问权限' })
  }
}))

router.get('/v1/metrics/pods', requirePerm('cluster:list', 'cluster:detail'), wrap(async (req, res) => {
  try {
    res.json({ available: true, ...(await metricsPods(req.account, req.clusterId, nsOf(req))) })
  } catch (e) {
    if (e.status === 403) throw e
    res.json({ available: false, items: [], totalCpu: null, totalMemory: null, message: e.message || '未安装 metrics-server 或无访问权限' })
  }
}))

router.get('/v1/workloads/:namespace/:name/history', requirePerm('cluster:list', 'cluster:detail'), wrap(async (req, res) => {
  res.json(await operations.workloadHistory(req.params.namespace, req.params.name, String(req.query.kind || 'Deployment'), req.clusterId, opOptions(req)))
}))
router.post('/v1/workloads/:namespace/:name/rollback', requirePerm('cluster:update'), wrap(async (req, res) => {
  res.json(await operations.rollbackWorkload(req.params.namespace, req.params.name, String(req.body?.kind || req.query.kind || 'Deployment'), req.body?.revision, req.clusterId, opOptions(req)))
}))
router.post('/v1/cronjobs/:namespace/:name/run', requirePerm('cluster:create'), wrap(async (req, res) => {
  res.json(await operations.runCronJob(req.params.namespace, req.params.name, req.clusterId, opOptions(req)))
}))
router.post('/v1/cronjobs/:namespace/:name/suspend', requirePerm('cluster:update'), wrap(async (req, res) => {
  res.json(await operations.suspendCronJob(req.params.namespace, req.params.name, req.body?.suspend, req.clusterId, opOptions(req)))
}))
router.get('/v1/nodes/:name/drain', requireAll('node:maintain', 'cluster:update', 'cluster:delete'), wrap(async (req, res) => {
  const { _pods, ...result } = await operations.nodeDrainPreflight(req.params.name, req.clusterId, opOptions(req))
  res.json(result)
}))
router.post('/v1/nodes/:name/drain', requireAll('node:maintain', 'cluster:update', 'cluster:delete'), wrap(async (req, res) => {
  res.json(await operations.drainNode(req.params.name, req.clusterId, { ...opOptions(req), timeoutSeconds: req.body?.timeoutSeconds }))
}))

// 调试用：返回当前集群连接上下文（不含任何凭据）
router.get('/v1/context', requirePerm('cluster:list', 'cluster:detail'), (req, res) => res.json({
  ...kubeContext(req.clusterId),
  defaultClusterId: getDefaultClusterId(),
}))

// 供 index.js 启动时调用，避免额外 import 路径
export { initClusters }
export default router
