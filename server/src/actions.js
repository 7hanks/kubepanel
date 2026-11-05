import { loadAll, dump } from 'js-yaml'
import {
  kubeRequest, resRequest, apiPath, KUBE_HEADERS, KubeError,
  discoverResources, findResource, kubeContext,
} from './kube.js'

/** 把并发请求统一转成「失败不抛、值为 null」，保证概览页部分可用 */
async function safe(fn) {
  try { return await fn() } catch (e) { return null }
}

/** GET /api/v1/cluster —— 当前所选集群的信息 */
export async function clusterInfo(clusterId) {
  const [version, nsRes, discovery] = await Promise.all([
    safe(() => kubeRequest('GET', '/version', { clusterId })),
    safe(() => kubeRequest('GET', '/api/v1/namespaces', { clusterId })),
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
    resourceTypes: discovery?.length || 0,
    namespaces: (nsRes?.data?.items || []).map(n => n.metadata.name).sort(),
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

/** GET /api/v1/overview —— namespace 不为空时，Pod / Deployment / Service / 事件只统计该命名空间 */
export async function overview(clusterId, namespace) {
  const ns = namespace && namespace !== 'all' && namespace !== '_all' ? String(namespace) : ''
  const prefix = ns ? `/namespaces/${encodeURIComponent(ns)}` : ''
  const [nodes, pods, deps, svcs, events, metrics, nsRes, discovery] = await Promise.all([
    safe(() => kubeRequest('GET', '/api/v1/nodes', { clusterId })),
    safe(() => kubeRequest('GET', `/api/v1${prefix}/pods`, { clusterId })),
    safe(() => kubeRequest('GET', `/apis/apps/v1${prefix}/deployments`, { clusterId })),
    safe(() => kubeRequest('GET', `/api/v1${prefix}/services`, { clusterId })),
    safe(() => kubeRequest('GET', `/api/v1${prefix}/events?limit=100`, { clusterId })),
    safe(() => kubeRequest('GET', '/apis/metrics.k8s.io/v1beta1/nodes', { timeout: 5000, clusterId })),
    safe(() => kubeRequest('GET', '/api/v1/namespaces', { clusterId })),
    safe(() => discoverResources(false, clusterId)),
  ])

  const usage = {}
  for (const n of metrics?.data?.items || []) usage[n.metadata.name] = n.usage || {}

  const nodeRows = (nodes?.data?.items || []).map(n => {
    const ready = (n.status?.conditions || []).some(c => c.type === 'Ready' && c.status === 'True')
    const u = usage[n.metadata.name]
    return {
      name: n.metadata.name,
      ready,
      unschedulable: !!n.spec?.unschedulable,
      version: n.status?.nodeInfo?.kubeletVersion || '-',
      cpu: u ? fmtCpu(u.cpu) : (n.status?.capacity?.cpu || '-'),
      memory: u ? fmtMem(u.memory) : (n.status?.capacity?.memory || '-'),
      pods: n.status?.capacity?.pods || '-',
      age: age(n.metadata.creationTimestamp),
    }
  })

  const podList = pods?.data?.items || []
  const podPhases = {}
  let unhealthyPods = 0
  for (const p of podList) {
    const phase = p.status?.phase || 'Unknown'
    podPhases[phase] = (podPhases[phase] || 0) + 1
    const bad = (p.status?.containerStatuses || []).some(c =>
      c.state?.waiting && /error|crashloop|imagepull|invalid/i.test(c.state.waiting.reason || ''))
    if (bad || !['Running', 'Succeeded'].includes(phase)) unhealthyPods++
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
      nodes: nodeRows.length,
      namespaces: (nsRes?.data?.items || []).length,
      pods: podList.length,
      deployments: (deps?.data?.items || []).length,
      services: (svcs?.data?.items || []).length,
      unhealthyPods,
    },
    nodes: nodeRows,
    events: eventRows,
    podPhases,
    metricsAvailable: !!metrics,
    resourceTypes: discovery?.length || 0,
    partial: !nodes || !pods,
  }
}

/** POST /api/v1/apply —— 多文档 YAML，服务端 Apply（可新建或更新任意资源，含 CRD 实例） */
export async function applyYaml(text, defaultNamespace, clusterId) {
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
      const p = apiPath({
        group: r.group, version: r.version, plural: r.plural,
        namespace: r.namespaced ? ns : undefined,
        name: doc.metadata.name,
      })
      const qs = '?fieldManager=kubepanel&force=true'
      await kubeRequest('PATCH', p + qs, {
        body: dump(doc, { noRefs: true, lineWidth: 120 }),
        headers: KUBE_HEADERS.applyYaml,
        clusterId,
      })
      results.push({ ok: true, name: label, message: `${doc.metadata.namespace || ns || '集群级'} · 已应用` })
    } catch (e) {
      results.push({ ok: false, name: label, message: e.message })
    }
  }
  return { results }
}

/** 扩缩容：merge-patch spec.replicas，兼容 Deployment / StatefulSet / ReplicaSet */
export async function scaleResource(meta, namespace, name, replicas, clusterId) {
  const n = Number(replicas)
  if (!Number.isInteger(n) || n < 0) throw new KubeError(400, 'replicas 必须是非负整数')
  return resRequest('PATCH', meta, {
    namespace, name,
    body: { spec: { replicas: n } },
    headers: KUBE_HEADERS.mergePatch,
    clusterId,
  })
}

/** 滚动重启：写 restartedAt 注解触发 Pod 模板变更（等价 kubectl rollout restart） */
export async function restartWorkload(meta, namespace, name, clusterId) {
  return resRequest('PATCH', meta, {
    namespace, name,
    body: { spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } } } } },
    headers: KUBE_HEADERS.mergePatch,
    clusterId,
  })
}

/** 节点 cordon / uncordon */
export async function cordonNode(name, unschedulable, clusterId) {
  return kubeRequest('PATCH', `/api/v1/nodes/${encodeURIComponent(name)}`, {
    body: { spec: { unschedulable: !!unschedulable } },
    headers: KUBE_HEADERS.mergePatch,
    clusterId,
  })
}
