import { assertResourceAccess, allowedNamespaces, filterNamespaces } from './access.js'
import { resRequest, KubeError } from './kube.js'

/** Lists only authorized namespaces upstream; never retrieves an all-namespace response to filter later. */
export async function scopedList(account, meta, { clusterId, namespace, query = {}, timeout } = {}) {
  const guard = ns => account && assertResourceAccess(account, { ...meta, clusterId, namespace: ns, verb: 'list' })
  const scope = account ? allowedNamespaces(account) : null
  if (meta.plural === 'namespaces' && !meta.group && scope !== null) {
    // Namespace metadata is required for navigation, but no cluster-wide list is exposed.
    const items = []
    for (const name of scope) {
      if (namespace && name !== namespace) continue
      assertResourceAccess(account, { ...meta, clusterId, namespace: name, verb: 'get' })
      try {
        const r = await resRequest('GET', meta, { name, clusterId, timeout })
        items.push(r.data)
      } catch (e) { if (e.status !== 404) throw e }
    }
    return { apiVersion: 'v1', kind: 'NamespaceList', metadata: {}, items: filterNamespaces(account, items) }
  }
  if (!meta.namespaced || namespace || scope === null) {
    guard(meta.namespaced ? namespace : undefined)
    return (await resRequest('GET', meta, { namespace: meta.namespaced ? namespace : undefined, clusterId, query, timeout })).data
  }
  if (query.continue) throw new KubeError(400, '跨授权命名空间列表不支持共享 continue 游标，请选择命名空间')
  const items = []
  for (const ns of scope) {
    guard(ns)
    const q = { ...query }; delete q.limit
    const r = await resRequest('GET', meta, { namespace: ns, clusterId, query: q, timeout })
    items.push(...r.data?.items || [])
  }
  return { apiVersion: meta.group ? `${meta.group}/${meta.version}` : meta.version, kind: 'List', metadata: {}, items }
}
