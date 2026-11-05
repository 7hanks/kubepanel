/**
 * 集群作用域内的路径：/c/:clusterId/...
 * 所有资源页、详情页、日志页的跳转都必须经过这里，保证 URL 上始终带当前集群。
 */
export function cpath(sub = '', clusterId) {
  const cid = clusterId || localStorage.getItem('kp_cluster') || ''
  const clean = sub.startsWith('/') ? sub : `/${sub}`
  return `/c/${encodeURIComponent(cid)}${clean === '/' ? '' : clean}`
}

/** 集群列表页（平台级，不在任何集群作用域内） */
export const CLUSTERS_PATH = '/clusters'

/**
 * URL 里的命名空间占位归一化。
 * 集群级资源在表格中显示 '-'，若原样拼进 /namespaces/-/... 会 404，
 * 统一转成 '_all'（后端会去掉 namespaces 段）。
 */
export function nsPath(ns) {
  return !ns || ns === '-' || ns === 'all' ? '_all' : ns
}
