import express from 'express'
import { authMiddleware, login, logout, profile, changePassword } from './auth.js'
import {
  kubeRequest, resRequest, KUBE_HEADERS, KubeError,
  discoverResources, kubeContext, getCluster, getDefaultClusterId,
} from './kube.js'
import {
  initClusters, clusterSummaries, addCluster, removeCluster, testCluster, clusterDetail,
} from './clusterService.js'
import { clusterInfo, overview, applyYaml, scaleResource, restartWorkload, cordonNode } from './actions.js'
import { streamPodLogs } from './logs.js'
import {
  listRegistries, addRegistry, updateRegistry, removeRegistry, testRegistry,
  listProjects, listRepositories, listArtifacts, discoverRegistries,
} from './registryService.js'
import { monitorView, saveMonitor, testMonitor, listDashboards, podMetrics, topPods } from './monitorService.js'

const router = express.Router()
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

/** 从路由参数还原 GVK 元数据；_core 代表 core API 组 */
function metaOf(req) {
  return {
    group: !req.params.group || req.params.group === '_core' ? '' : req.params.group,
    version: req.params.version || 'v1',
    plural: req.params.plural,
  }
}
function nsOf(req) {
  const v = req.params.namespace || req.query.namespace
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
router.post('/auth/logout', logout)
router.use(authMiddleware)

// ---------------- 账号（登录后） ----------------
router.get('/v1/auth/profile', wrap(async (req, res) => profile(req, res)))
router.post('/v1/auth/password', wrap(async (req, res) => changePassword(req, res)))

// ---------------- 集群管理（平台级，不需要指定 clusterId） ----------------
router.get('/v1/clusters', wrap(async (req, res) => {
  res.json(await clusterSummaries(String(req.query.refresh) === '1'))
}))
router.post('/v1/clusters', wrap(async (req, res) => {
  const { name, kubeconfig } = req.body || {}
  res.status(201).json(addCluster(name, kubeconfig))
}))
router.post('/v1/clusters/:id/test', wrap(async (req, res) => {
  res.json(await testCluster(req.params.id))
}))
router.get('/v1/clusters/:id/detail', wrap(async (req, res) => {
  res.json(await clusterDetail(req.params.id))
}))
// 平台级：集群详情抽屉里的「资源使用率 TOP 10」，走 metrics-server
router.get('/v1/clusters/:id/top-pods', wrap(async (req, res) => {
  const id = req.params.id
  try {
    res.json({ available: true, ...(await topPods(id, req.query.limit)) })
  } catch (e) {
    res.json({ available: false, items: [], total: 0, message: '未安装 metrics-server 或无访问权限' })
  }
}))
router.delete('/v1/clusters/:id', wrap(async (req, res) => {
  res.json(removeCluster(req.params.id))
}))

// ---------------- 镜像仓库（平台级，Harbor） ----------------
router.get('/v1/registries', wrap(async (req, res) => res.json(listRegistries())))
router.post('/v1/registries', wrap(async (req, res) => {
  res.status(201).json(await addRegistry(req.body || {}))
}))
router.post('/v1/registries/discover', wrap(async (req, res) => {
  const { clusterId, namespace } = req.body || {}
  res.json(await discoverRegistries(getCluster(clusterId).id, namespace || 'harbor'))
}))
router.patch('/v1/registries/:id', wrap(async (req, res) => {
  res.json(await updateRegistry(req.params.id, req.body || {}))
}))
router.delete('/v1/registries/:id', wrap(async (req, res) => {
  res.json(removeRegistry(req.params.id))
}))
router.post('/v1/registries/:id/test', wrap(async (req, res) => {
  res.json(await testRegistry(req.params.id))
}))
router.get('/v1/registries/:id/projects', wrap(async (req, res) => {
  res.json(await listProjects(req.params.id))
}))
router.get('/v1/registries/:id/repositories', wrap(async (req, res) => {
  res.json(await listRepositories(req.params.id, String(req.query.project || '')))
}))
router.get('/v1/registries/:id/artifacts', wrap(async (req, res) => {
  res.json(await listArtifacts(req.params.id, String(req.query.project || ''), String(req.query.repository || '')))
}))

// ---------------- 监控（平台级，Grafana） ----------------
router.get('/v1/monitor', wrap(async (req, res) => res.json(monitorView())))
router.post('/v1/monitor', wrap(async (req, res) => {
  res.json(saveMonitor(req.body || {}))
}))
router.post('/v1/monitor/test', wrap(async (req, res) => {
  res.json(await testMonitor(req.body || {}))
}))
router.get('/v1/monitor/dashboards', wrap(async (req, res) => {
  res.json(await listDashboards())
}))

// ---------------- 以下所有接口都需要选定集群 ----------------
// clusterId 可通过 query（axios 统一注入）、X-Cluster-Id 请求头或 body 传递
router.use((req, res, next) => {
  const raw = req.query.clusterId || req.headers['x-cluster-id'] || req.body?.clusterId
  try {
    req.clusterId = getCluster(raw).id
    next()
  } catch (e) {
    res.status(e.status || 404).json({
      message: e.message || '集群不存在',
      hint: '请返回集群列表重新选择一个集群',
    })
  }
})

// ---------------- 集群信息 ----------------
router.get('/v1/cluster', wrap(async (req, res) => res.json(await clusterInfo(req.clusterId))))
router.get('/v1/overview', wrap(async (req, res) => res.json(await overview(req.clusterId))))
router.get('/v1/resources', wrap(async (req, res) => {
  const force = String(req.query.refresh) === '1'
  res.json(await discoverResources(force, req.clusterId))
}))

// ---------------- 通用资源 CRUD ----------------
router.get('/v1/resources/:group/:version/:plural', wrap(async (req, res) => {
  const r = await resRequest('GET', metaOf(req), {
    namespace: nsOf(req), query: listQuery(req), clusterId: req.clusterId,
  })
  res.json(r.data)
}))

router.post('/v1/resources/:group/:version/:plural', wrap(async (req, res) => {
  const meta = metaOf(req)
  const body = req.body
  if (!body || !body.metadata?.name) throw new KubeError(400, '请求体必须包含 metadata.name')
  const namespace = req.query.namespace || body.metadata.namespace
  const r = await resRequest('POST', meta, { namespace, body, clusterId: req.clusterId })
  res.status(201).json(r.data)
}))

router.get('/v1/resources/:group/:version/:plural/:namespace/:name', wrap(async (req, res) => {
  const r = await resRequest('GET', metaOf(req), {
    namespace: nsOf(req), name: req.params.name, clusterId: req.clusterId,
  })
  res.json(r.data)
}))

router.put('/v1/resources/:group/:version/:plural/:namespace/:name', wrap(async (req, res) => {
  try {
    const r = await resRequest('PUT', metaOf(req), {
      namespace: nsOf(req), name: req.params.name, body: req.body, clusterId: req.clusterId,
    })
    res.json(r.data)
  } catch (e) {
    if (e instanceof KubeError && (e.status === 409 || /has been modified/i.test(e.message || ''))) {
      throw new KubeError(409, '资源已被其他客户端修改，请刷新页面后重新编辑（K8s 乐观锁冲突）')
    }
    throw e
  }
}))

router.patch('/v1/resources/:group/:version/:plural/:namespace/:name', wrap(async (req, res) => {
  const type = req.query.patchType || 'merge'
  const headers = {
    merge: KUBE_HEADERS.mergePatch,
    strategic: KUBE_HEADERS.strategicPatch,
    json: KUBE_HEADERS.jsonPatch,
  }[type] || KUBE_HEADERS.mergePatch
  const r = await resRequest('PATCH', metaOf(req), {
    namespace: nsOf(req), name: req.params.name, body: req.body, headers, clusterId: req.clusterId,
  })
  res.json(r.data)
}))

router.delete('/v1/resources/:group/:version/:plural/:namespace/:name', wrap(async (req, res) => {
  const query = {}
  if (req.query.gracePeriodSeconds !== undefined) query.gracePeriodSeconds = req.query.gracePeriodSeconds
  if (req.query.propagationPolicy !== undefined) query.propagationPolicy = req.query.propagationPolicy
  const r = await resRequest('DELETE', metaOf(req), {
    namespace: nsOf(req), name: req.params.name, query, clusterId: req.clusterId,
  })
  res.json(r.data)
}))

router.post('/v1/resources/:group/:version/:plural/:namespace/:name/scale', wrap(async (req, res) => {
  const r = await scaleResource(metaOf(req), nsOf(req), req.params.name, req.body?.replicas, req.clusterId)
  res.json(r.data)
}))
router.post('/v1/resources/:group/:version/:plural/:namespace/:name/restart', wrap(async (req, res) => {
  const r = await restartWorkload(metaOf(req), nsOf(req), req.params.name, req.clusterId)
  res.json(r.data)
}))

// ---------------- 组合操作 ----------------
router.post('/v1/apply', wrap(async (req, res) => {
  const yamlText = req.body?.yaml
  if (!yamlText || typeof yamlText !== 'string') throw new KubeError(400, '请求体缺少 yaml 字段')
  res.json(await applyYaml(yamlText, req.body?.defaultNamespace, req.clusterId))
}))

router.post('/v1/nodes/:name/cordon', wrap(async (req, res) => {
  const r = await cordonNode(req.params.name, req.body?.unschedulable !== false, req.clusterId)
  res.json(r.data)
}))

// ---------------- Pod 日志 / 事件 / 指标 ----------------
router.get('/v1/pods/:namespace/:name/logs', wrap(streamPodLogs))

/**
 * 重启 Pod：K8s 没有 Pod restart 子资源，标准做法是删除后由控制器重建。
 * 裸 Pod（无 ownerReferences）删除后不会自动重建，这里直接拒绝，避免误删。
 */
router.post('/v1/pods/:namespace/:name/restart', wrap(async (req, res) => {
  const { namespace, name } = req.params
  const podPath = `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}`
  const pod = await kubeRequest('GET', podPath, { clusterId: req.clusterId })
  const owners = pod.data?.metadata?.ownerReferences || []
  if (!owners.length) {
    throw new KubeError(400,
      `Pod ${name} 没有控制器（ownerReferences），删除后不会自动重建，已拒绝重启。如需重建请用 YAML 工作台重新 apply；确认无用的裸 Pod 请手动删除。`)
  }
  const ownerList = owners.map(o => `${o.kind}/${o.name}`).join('、')
  // dryRun=1 只做预检，不删除任何 Pod，便于脚本验证与用户确认
  if (String(req.query.dryRun) === '1') {
    return res.json({
      ok: true, dryRun: true, wouldRestart: true,
      message: `预检通过：${name} 由 ${ownerList} 管理，删除后会自动重建（未执行删除）`,
      owners: owners.map(o => ({ kind: o.kind, name: o.name })),
    })
  }
  await kubeRequest('DELETE', podPath, { clusterId: req.clusterId })
  res.json({
    ok: true,
    message: `已删除 Pod ${name}，将由 ${ownerList} 自动重建`,
    owners: owners.map(o => ({ kind: o.kind, name: o.name })),
  })
}))

router.get('/v1/pods/:namespace/:name/events', wrap(async (req, res) => {
  const q = new URLSearchParams({
    fieldSelector: `involvedObject.name=${req.params.name},involvedObject.namespace=${req.params.namespace}`,
  })
  const r = await kubeRequest('GET',
    `/api/v1/namespaces/${encodeURIComponent(req.params.namespace)}/events?${q}`,
    { clusterId: req.clusterId })
  res.json(r.data)
}))

router.get('/v1/metrics/nodes', wrap(async (req, res) => {
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
    res.json({ available: false, items: [], message: '未安装 metrics-server 或无访问权限' })
  }
}))

router.get('/v1/metrics/pods', wrap(async (req, res) => {
  try {
    res.json({ available: true, ...(await podMetrics(req.clusterId, String(req.query.namespace || 'all'))) })
  } catch (e) {
    res.json({ available: false, items: [], totalCpu: 0, totalMemory: 0, message: e.message || '未安装 metrics-server 或无访问权限' })
  }
}))

// 调试用：返回当前集群连接上下文（不含任何凭据）
router.get('/v1/context', (req, res) => res.json({
  ...kubeContext(req.clusterId),
  defaultClusterId: getDefaultClusterId(),
}))

// 供 index.js 启动时调用，避免额外 import 路径
export { initClusters }
export default router
