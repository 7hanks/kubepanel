import { can, canAny } from './permissions.js'

const deny = message => { throw Object.assign(new Error(message), { status: 403 }) }
const all = account => can(account, '*')
const LEGACY_SCOPE = { clusters: ['*'], namespaces: ['*'], resources: ['*'] }

export function normalizeScope(scope) {
  if (scope === undefined || scope === null) return structuredClone(LEGACY_SCOPE)
  if (typeof scope !== 'object' || Array.isArray(scope)) throw Object.assign(new Error('授权范围必须是对象'), { status: 400 })
  const out = {}
  for (const key of Object.keys(LEGACY_SCOPE)) {
    const list = scope[key] === undefined ? ['*'] : scope[key]
    if (!Array.isArray(list) || list.length > 200 || list.some(x => typeof x !== 'string' || !x.trim() || x.length > 253 || /[\s\\\x00-\x1f]/.test(x))) {
      throw Object.assign(new Error(`${key} 必须是名称数组，* 表示全部，空数组表示无授权`), { status: 400 })
    }
    out[key] = [...new Set(list.map(x => x.trim()))]
    if (key === 'resources' && out[key].some(x => x !== '*' && !/^[_a-z0-9.-]+\/[a-z0-9.-]+$/.test(x))) {
      throw Object.assign(new Error('资源范围格式应为 API组/资源名，例如 apps/deployments 或 _core/pods'), { status: 400 })
    }
    if (key !== 'resources' && out[key].some(x => /\//.test(x) || x === '.' || x === '..')) throw Object.assign(new Error('集群和命名空间范围不能包含路径'), { status: 400 })
  }
  return out
}
function scopeOf(account) { return normalizeScope(account?.scope) }
function contains(values, value) { return values.includes('*') || values.includes(value) }
export function canAccessCluster(account, clusterId) {
  return !!account && (all(account) || contains(scopeOf(account).clusters, clusterId))
}
export function assertClusterAccess(account, clusterId) {
  if (!canAccessCluster(account, clusterId)) deny('当前账号无权访问该集群')
  if (!canAny(account, ['cluster:list','cluster:detail','cluster:create','cluster:update','cluster:delete','pod:logs','pod:exec','node:maintain'])) deny('当前账号没有集群资源访问权限')
}
export function allowedNamespaces(account) {
  const list = all(account) ? ['*'] : scopeOf(account).namespaces
  return list.includes('*') ? null : list
}
export function resourceAllowed(account, { group = '', plural = '' } = {}) {
  if (all(account)) return true
  const normalized = plural.split('/')[0]
  if (normalized === 'secrets' && !can(account, 'secret:read')) return false
  return contains(scopeOf(account).resources, `${group && group !== '_core' ? group : '_core'}/${normalized}`)
}
export function assertResourceAccess(account, { clusterId, namespace, group = '', plural, verb }) {
  assertClusterAccess(account, clusterId)
  if (all(account)) return
  const action = { get:'detail', list:'list', watch:'list', create:'create', update:'update', patch:'update', delete:'delete' }[verb]
  if (!action || !canAny(account, action === 'detail' || action === 'list' ? ['cluster:list','cluster:detail'] : [`cluster:${action}`])) deny('当前账号没有执行该资源操作的权限')
  const allowed = allowedNamespaces(account)
  if (allowed && (!namespace || !allowed.includes(namespace))) deny('当前账号无权访问该命名空间或集群级资源')
  const normalized = String(plural || '').split('/')[0]
  if (!contains(scopeOf(account).resources, `${group && group !== '_core' ? group : '_core'}/${normalized}`)) deny('当前账号无权访问该资源类型')
  if (normalized === 'secrets' && ['get','list','watch'].includes(verb) && !can(account, 'secret:read')) deny('读取 Secret 需要独立的敏感权限')
  if ((!group || group === '_core') && normalized === 'nodes' && !['get','list','watch'].includes(verb) && !can(account,'node:maintain')) deny('修改节点需要独立的维护权限')
  if (group === 'rbac.authorization.k8s.io' && !['get','list','watch'].includes(verb) && !can(account, 'rbac:write')) deny('修改 Kubernetes RBAC 需要独立权限')
}
export function filterNamespaces(account, items = []) {
  const list = allowedNamespaces(account)
  return list === null ? items : items.filter(x => list.includes(typeof x === 'string' ? x : x?.metadata?.namespace || x?.namespace || x?.metadata?.name))
}
