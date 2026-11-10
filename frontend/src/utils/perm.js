import api from '../api'
import { scopeAllows } from './scope'

/**
 * 前端会话里的权限快照。
 *
 * 真正的越权拦截在后端（每个 /api 路由都校验权限码），这里只用来
 * 隐藏无权访问的菜单与写操作按钮，避免用户点进去才报 403。
 * 角色与其权限随时可能被管理员调整，所以每次进入布局都会用 /v1/auth/profile 刷新一次。
 */

const KEY_PERMS = 'kp_perms'

export function saveSession(data = {}) {
  localStorage.removeItem('kp_token')
  localStorage.setItem('kp_authenticated','1')
  if (data.csrfToken) sessionStorage.setItem('kp_csrf',data.csrfToken)
  if (data.scope) localStorage.setItem('kp_scope',JSON.stringify(data.scope))
  if (data.username) localStorage.setItem('kp_user', data.username)
  if (data.nickname !== undefined) localStorage.setItem('kp_nickname', data.nickname || '')
  if (data.role) localStorage.setItem('kp_role', data.role)
  if (data.roleName) localStorage.setItem('kp_role_name', data.roleName)
  if (Array.isArray(data.permissions)) localStorage.setItem(KEY_PERMS, JSON.stringify(data.permissions))
}

export function clearSession() {
  sessionStorage.removeItem('kp_csrf')
  for (const k of ['kp_token', 'kp_authenticated', 'kp_scope', 'kp_user', KEY_PERMS, 'kp_role', 'kp_role_name', 'kp_nickname']) {
    localStorage.removeItem(k)
  }
}

export function permissions() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY_PERMS) || '[]')
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

export function can(perm) {
  const list = permissions()
  return list.includes('*') || list.includes(perm)
}

export function canAny(...perms) {
  const list = permissions()
  if (list.includes('*')) return true
  return perms.flat().some(p => list.includes(p))
}

/** 某个对象的任一权限（用于菜单与路由入口） */
export function canSee(objectKey) {
  return canAny(
    `${objectKey}:list`, `${objectKey}:detail`,
    `${objectKey}:create`, `${objectKey}:update`, `${objectKey}:delete`,
  )
}

export function canList(objectKey) { return canAny(`${objectKey}:list`, `${objectKey}:detail`) }
export function canDetail(objectKey) { return can(`${objectKey}:detail`) || can(`${objectKey}:list`) }
export function canCreate(objectKey) { return can(`${objectKey}:create`) }
export function canUpdate(objectKey) { return can(`${objectKey}:update`) }
export function canDelete(objectKey) { return can(`${objectKey}:delete`) }

/** 集群对象：读入口 / 可写（任一写权限，用于整块表单的可编辑状态） */
export function canReadCluster() { return canSee('cluster') }
export function canWriteCluster() { return canAny('cluster:create', 'cluster:update', 'cluster:delete') }

export function canReadRegistry() { return canSee('registry') }
export function canWriteRegistry() { return canAny('registry:create', 'registry:update', 'registry:delete') }

export function canReadUsers() { return canSee('user') }
export function canWriteUsers() { return canAny('user:create', 'user:update', 'user:delete') }

export function canReadMonitor() { return canSee('monitor') }
export function canWriteMonitor() { return canAny('monitor:create', 'monitor:update') }

export function roleName() {
  return localStorage.getItem('kp_role_name') || ''
}

export function isLoggedIn() {
  return localStorage.getItem('kp_authenticated') === '1'
}

/** 登录后落到第一个有权访问的页面 */
export function landingPath() {
  if (canList('cluster')) return '/clusters'
  if (canList('registry')) return '/registries'
  if (canList('user')) return '/users'
  if (canList('monitor')) return '/monitor'
  if (can('audit:list')) return '/audit'
  // 只有某个对象的写权限时，仍然给出一个能看的页面
  if (canReadCluster()) return '/clusters'
  if (canReadRegistry()) return '/registries'
  if (canReadUsers()) return '/users'
  if (canReadMonitor()) return '/monitor'
  return '/clusters'
}

/** 从服务端刷新权限快照；账号被禁用或删除时抛错 */
export async function refreshSession() {
  const p = await api.profile()
  saveSession(p)
  return p
}

export function canResource(meta, action, namespace, clusterId=localStorage.getItem('kp_cluster')) {
  if (!can(`cluster:${action}`) && !(['list','detail'].includes(action) && canAny('cluster:list','cluster:detail'))) return false
  if (can('*')) return true
  if (meta.plural==='secrets' && ['list','detail'].includes(action) && !can('secret:read')) return false
  if (meta.group==='rbac.authorization.k8s.io' && !['list','detail'].includes(action) && !can('rbac:write')) return false
  try { return scopeAllows(JSON.parse(localStorage.getItem('kp_scope') || '{}'), {...meta,clusterId,namespace}) } catch { return false }
}
