import { loadAll, dump } from 'js-yaml'
import {
  kubeRequest, resRequest, apiPath, KUBE_HEADERS, KubeError,
  discoverResources, findResource, kubeContext, discoveryErrors,
} from './kube.js'
import { parseCpu, parseMem, fmtCpu as fmtUsageCpu, fmtBytes } from './monitorService.js'
import { scopedList } from './resourceScope.js'
import { resourceAllowed, allowedNamespaces } from './access.js'
import { aggregateNodeUsage } from './overviewMetrics.js'

/** 把并发请求统一转成「失败不抛、值为 null」，保证概览页部分可用 */
async function safe(fn) {
  try { return await fn() } catch (e) { return null }
}

/** GET /api/v1/cluster —— 当前所选集群的信息 */
export async function clusterInfo(clusterId, account) {
  const namespaces = account ? allowedNamespaces(account) : null
  const [version, nsRes, discovery] = await Promise.all([
    safe(() => kubeRequest('GET', '/version', { clusterId })),
    namespaces !== null ? Promise.resolve(null) : safe(async () => ({ data: await scopedList(account, { group: '', version: 'v1', plural: 'namespaces', namespaced: false }, { clusterId }) })),
    safe(() => discoverResources(false, clusterId)),
  ])
  const ctx = kubeContext(clusterId)
  return {
    id: ctx.id,
    name: ctx.name,
    server: ctx.server,
    context: ctx.context,
    version: version?.data?.gitVersion || 'unknown',
    platform: version?.data?.platform || '-',
    authMode: ctx.authMode || '-',
    resourceTypes: discovery ? discovery.filter(r => !account || resourceAllowed(account, r)).length : null,
    namespaces: namespaces !== null ? [...namespaces].sort() : (nsRes?.data?.items || []).map(n => n.metadata.name).sort(),
  }
}

function fmtCpu(v) {
  if (!v) return '-'
  if (String(v).endsWith('n')) return `${(parseInt(v, 10) / 1e9).toFixed(2)} core`
  if (String(v).endsWith('m')) return `${(parseInt(v, 10) / 1000).toFixed(2)} core`
  return `${v} core`
}
function fmtMem(v) {
  if (!v) return '-'
  const units = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3 }
  const m = /^(\d+)(Ki|Mi|Gi)?$/.exec(String(v))
  if (!m) return v
  const bytes = Number(m[1]) * (units[m[2]] || 1)
  return `${(bytes / 1024 ** 3).toFixed(2)} Gi`
}
function age(ts) {
  if (!ts) return '-'
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/** 每个 Pod 的资源使用率：用量来自 metrics-server，分母是该 Pod 自己声明的 requests */
function podUsageRows(metricsItems, podList) {
  const usageByPod = new Map()
  for (const m of metricsItems) {
    const key = `${m.metadata?.namespace}/${m.metadata?.name}`
    let cpu = 0
    let mem = 0
    for (const c of m.containers || []) {
      cpu += parseCpu(c.usage?.cpu)
      mem += parseMem(c.usage?.memory)
    }
    usageByPod.set(key, { cpu, mem })
  }

  const rows = podList.map(p => {
    const usage = usageByPod.get(`${p.metadata?.namespace}/${p.metadata?.name}`)
    const requests = (p.spec?.containers || []).reduce((acc, c) => {
      acc.cpu += parseCpu(c.resources?.requests?.cpu)
      acc.mem += parseMem(c.resources?.requests?.memory)
      return acc
    }, { cpu: 0, mem: 0 })
    // 没声明 requests 时没有有意义的分母，返回 null 让前端显示「—」
    const pct = (used, base) => (base > 0 ? Math.round((used / base) * 100) : null)
    return {
      namespace: p.metadata?.namespace,
      name: p.metadata?.name,
      measured: !!usage,
      cpu: usage ? usage.cpu : null,
      cpuText: usage ? fmtUsageCpu(usage.cpu) : '—',
      cpuPercent: usage ? pct(usage.cpu, requests.cpu) : null,
      memory: usage ? usage.mem : null,
      memoryText: usage ? fmtBytes(usage.mem) : '—',
      memoryPercent: usage ? pct(usage.mem, requests.mem) : null,
    }
  })

  // 用量高的排前面；没有指标的排最后
  rows.sort((a, b) => (b.cpu ?? -1) - (a.cpu ?? -1))
  return {
    sampled: usageByPod.size,
    total: podList.length,
    timestamp: metricsItems[0]?.timestamp || null,
    items: rows,
  }
}

/** GET /api/v1/overview —— namespace 不为空时，Pod / Deployment / Service / 事件只统计该命名空间 */
export async function overview(clusterId, namespace, account) {
  const ns = namespace && namespace !== 'all' && namespace !== '_all' ? String(namespace) : ''
  const errors = {}
  const capture = async (key, fn) => {
    try { return await fn() } catch (e) { errors[key] = { status: e.status || 502, message: e.message }; return null }
  }
  const read = (key, group, version, plural, namespaced, query, timeout) => capture(key, async () => ({ data: await scopedList(account,
    { group, version, plural, namespaced }, { clusterId, namespace: namespaced ? ns || undefined : undefined, query, timeout }) }))
  const [nodes, pods, deps, svcs, events, metrics, podMetrics, nsRes, discovery] = await Promise.all([
    read('nodes', '', 'v1', 'nodes', false),
    read('pods', '', 'v1', 'pods', true),
    read('deployments', 'apps', 'v1', 'deployments', true),
    read('services', '', 'v1', 'services', true),
    read('events', '', 'v1', 'events', true, { limit: 100 }),
    read('nodeMetrics', 'metrics.k8s.io', 'v1beta1', 'nodes', false, {}, 5000),
    read('podMetrics', 'metrics.k8s.io', 'v1beta1', 'pods', true, {}, 5000),
    read('namespaces', '', 'v1', 'namespaces', false),
    capture('discovery', () => discoverResources(false, clusterId)),
  ])
  if (discovery && discoveryErrors(clusterId).length) errors.discovery = { status: 206, message: '部分 API 类型发现失败', components: discoveryErrors(clusterId) }

  const usage = {}
  for (const n of metrics?.data?.items || []) usage[n.metadata.name] = n.usage || {}
  const nodeUsage = aggregateNodeUsage(nodes?.data, metrics?.data)
  if (nodes && metrics && !nodeUsage.available && nodeUsage.reason !== 'no-nodes') errors.nodeMetrics = { status: 206, message: '节点指标或可分配资源不完整，集群用量暂不可用' }

  const nodeRows = (nodes?.data?.items || []).map(n => {
    const ready = (n.status?.conditions || []).some(c => c.type === 'Ready' && c.status === 'True')
    const u = usage[n.metadata.name]
    return {
      name: n.metadata.name,
      ready,
      unschedulable: !!n.spec?.unschedulable,
      version: n.status?.nodeInfo?.kubeletVersion || '-',
      cpu: u?.cpu != null ? fmtCpu(u.cpu) : null,
      memory: u?.memory != null ? fmtMem(u.memory) : null,
      pods: pods ? (pods.data?.items || []).filter(p => p.spec?.nodeName === n.metadata.name && !['Failed', 'Succeeded'].includes(p.status?.phase)).length : null,
      allocatable: n.status?.allocatable || {},
      capacity: n.status?.capacity || {},
      conditions: n.status?.conditions || [],
      taints: n.spec?.taints || [],
      diskPressure: (n.status?.conditions || []).some(c => c.type === 'DiskPressure' && c.status === 'True'),
      age: age(n.metadata.creationTimestamp),
    }
  })

  const podList = pods?.data?.items || []
  const podPhases = {}
  let unhealthyPods = 0
  let failedPods = 0
  for (const p of podList) {
    const phase = p.status?.phase || 'Unknown'
    podPhases[phase] = (podPhases[phase] || 0) + 1
    const bad = (p.status?.containerStatuses || []).some(c =>
      c.state?.waiting && /error|crashloop|imagepull|invalid/i.test(c.state.waiting.reason || ''))
    if (phase === 'Failed') failedPods++
    const ready = (p.status?.conditions || []).some(c => c.type === 'Ready' && c.status === 'True')
    if (!['Succeeded', 'Failed'].includes(phase) && !p.metadata?.deletionTimestamp && (bad || phase !== 'Running' || !ready)) unhealthyPods++
  }

  const eventRows = (events?.data?.items || [])
    .sort((a, b) => new Date(b.lastTimestamp || b.eventTime || 0) - new Date(a.lastTimestamp || a.eventTime || 0))
    .slice(0, 30)
    .map(e => ({
      type: e.type, namespace: e.metadata.namespace || '-', reason: e.reason,
      object: e.involvedObject ? `${e.involvedObject.kind}/${e.involvedObject.name}` : '-',
      message: e.message, age: age(e.lastTimestamp || e.eventTime || e.metadata.creationTimestamp),
    }))

  return {
    namespace: ns || 'all',
    stat: {
      nodes: nodes ? nodeRows.length : null,
      namespaces: nsRes ? (nsRes.data?.items || []).length : null,
      pods: pods ? podList.length : null,
      deployments: deps ? (deps.data?.items || []).length : null,
      services: svcs ? (svcs.data?.items || []).length : null,
      unhealthyPods: pods ? unhealthyPods : null,
      failedPods: pods ? failedPods : null,
    },
    nodes: nodeRows,
    events: eventRows,
    podPhases,
    podUsage: podMetrics
      ? { available: true, ...podUsageRows(podMetrics.data?.items || [], podList) }
      : { available: false, sampled: 0, total: podList.length, items: [] },
    nodeUsage,
    metricsAvailable: nodeUsage.available,
    resourceTypes: discovery ? discovery.filter(r => !account || resourceAllowed(account, r)).length : null,
    errors,
    partial: Object.keys(errors).length > 0,
  }
}

/** POST /api/v1/apply —— 多文档 YAML，服务端 Apply（可新建或更新任意资源，含 CRD 实例） */
export async function applyYaml(text, defaultNamespace, clusterId, { dryRun = false, force = false, authorize } = {}) {
  let docs
  try { docs = loadAll(text) } catch (e) { throw new KubeError(400, `YAML 解析失败：${e.message}`) }
  docs = docs.filter(d => d && typeof d === 'object' && !Array.isArray(d))
  if (!docs.length) throw new KubeError(400, 'YAML 中没有可应用的资源文档')

  const results = []
  for (const doc of docs) {
    const label = `${doc.kind || '?'}/${doc.metadata?.name || '?'}`
    try {
      if (!doc.apiVersion || !doc.kind || !doc.metadata?.name) {
        throw new Error('缺少 apiVersion / kind / metadata.name')
      }
      const r = await findResource(doc.apiVersion, doc.kind, clusterId)
      if (!r) throw new Error(`集群中未发现资源类型 ${doc.apiVersion} ${doc.kind}，请确认 CRD 已安装`)
      const ns = doc.metadata.namespace || defaultNamespace || (r.namespaced ? 'default' : undefined)
      if (!r.namespaced && doc.metadata.namespace) throw new KubeError(400, '集群级资源不能指定 namespace')
      await authorize?.({ ...r, namespace: r.namespaced ? ns : undefined, verb: 'create' })
      await authorize?.({ ...r, namespace: r.namespaced ? ns : undefined, verb: 'update' })
      if (!r.verbs.includes('patch')) throw new KubeError(405, '该资源不支持服务端 Apply')
      if (r.namespaced) doc.metadata.namespace = ns
      const p = apiPath({
        group: r.group, version: r.version, plural: r.plural,
        namespace: r.namespaced ? ns : undefined,
        name: doc.metadata.name,
      })
      const qs = `?${new URLSearchParams({ fieldManager: 'kubepanel', ...(force ? { force: 'true' } : {}), ...(dryRun ? { dryRun: 'All' } : {}) })}`
      await kubeRequest('PATCH', p + qs, {
        body: dump(doc, { noRefs: true, lineWidth: 120 }),
        headers: KUBE_HEADERS.applyYaml,
        clusterId,
      })
      results.push({ ok: true, name: label, operation: dryRun ? 'dryRun' : 'apply', message: `${doc.metadata.namespace || ns || '集群级'} · ${dryRun ? '服务端预检通过' : '已应用'}` })
    } catch (e) {
      results.push({ ok: false, name: label, message: e.message })
    }
  }
  return { ok: results.every(r => r.ok), results, dryRun: !!dryRun, force: !!force }
}

/** 扩缩容：merge-patch spec.replicas，兼容 Deployment / StatefulSet / ReplicaSet */
export async function scaleResource(meta, namespace, name, replicas, clusterId, { dryRun = false } = {}) {
  const n = Number(replicas)
  if (!Number.isInteger(n) || n < 0) throw new KubeError(400, 'replicas 必须是非负整数')
  return resRequest('PATCH', meta, {
    namespace, name,
    body: { spec: { replicas: n } },
    headers: KUBE_HEADERS.mergePatch,
    clusterId,
    query: dryRun ? { dryRun: 'All' } : {},
  })
}

/** 滚动重启：写 restartedAt 注解触发 Pod 模板变更（等价 kubectl rollout restart） */
export async function restartWorkload(meta, namespace, name, clusterId, { dryRun = false } = {}) {
  return resRequest('PATCH', meta, {
    namespace, name,
    body: { spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } } } } },
    headers: KUBE_HEADERS.mergePatch,
    clusterId,
    query: dryRun ? { dryRun: 'All' } : {},
  })
}

/** 节点 cordon / uncordon */
export async function cordonNode(name, unschedulable, clusterId, { dryRun = false } = {}) {
  return kubeRequest('PATCH', `/api/v1/nodes/${encodeURIComponent(name)}${dryRun ? '?dryRun=All' : ''}`, {
    body: { spec: { unschedulable: !!unschedulable } },
    headers: KUBE_HEADERS.mergePatch,
    clusterId,
  })
}
