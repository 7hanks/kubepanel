/**
 * 权限码与对象模型。
 *
 * 四个受控对象（集群 / 镜像仓库 / 用户管理 / 监控）× 五个动作（列表 / 详情 / 创建 / 编辑 / 删除），
 * 权限码形如 `cluster:update`。角色本身是可编辑的数据（见 roleService.js），这里只定义可勾选的权限清单。
 */

export const OBJECTS = [
  { key: 'cluster', label: '集群对象', hint: '集群、节点、工作负载、配置等 K8s 资源' },
  { key: 'registry', label: '镜像仓库对象', hint: 'Harbor 仓库、项目与镜像' },
  { key: 'user', label: '用户管理对象', hint: '用户、角色与账号密码' },
  { key: 'monitor', label: '监控', hint: 'Grafana 地址、令牌与仪表盘' },
]

export const ACTIONS = [
  { key: 'list', label: '列表', hint: '浏览列表页' },
  { key: 'detail', label: '详情', hint: '查看详情、YAML、日志与事件' },
  { key: 'create', label: '创建', hint: '新建对象、apply YAML' },
  { key: 'update', label: '编辑', hint: '修改、扩缩容、重启' },
  { key: 'delete', label: '删除', hint: '删除对象' },
]

export const SENSITIVE_PERMISSIONS = [
  {key:'cluster:import',label:'导入纳管集群'},
  {key:'cluster:remove',label:'移除纳管集群'},
  {key:'pod:exec',label:'容器终端'},
  {key:'pod:logs',label:'容器日志'},
  {key:'pod:files:read',label:'浏览与下载容器文件'},
  {key:'pod:files:write',label:'上传与修改容器文件'},
  {key:'pod:batch-exec',label:'容器批量执行'},
  {key:'secret:read',label:'读取 Secret 内容'},
  {key:'rbac:write',label:'修改 Kubernetes RBAC'},
  {key:'node:maintain',label:'节点维护与驱逐'},
  {key:'apply:force',label:'强制接管 Apply 字段'},
  {key:'audit:list',label:'查看操作审计'},
]

export const PERMISSIONS = [...OBJECTS.flatMap(o => ACTIONS.map(a => ({
  key: `${o.key}:${a.key}`,
  object: o.key,
  action: a.key,
  label: `${o.label}（${a.label}）`,
}))), ...SENSITIVE_PERMISSIONS.map(p=>({...p,object:p.key.split(':')[0],action:p.key.split(':')[1]}))]

export const PERMISSION_LABEL = new Map(PERMISSIONS.map(p => [p.key, p.label]))

const VALID = new Set(PERMISSIONS.map(p => p.key))

/** 过滤掉不认识的权限码，去重并保持 PERMISSIONS 的顺序 */
export function normalizePermissions(list) {
  const set = new Set(Array.isArray(list) ? list : [])
  return PERMISSIONS.map(p => p.key).filter(k => set.has(k))
}

export function isValidPermission(perm) {
  return VALID.has(perm)
}

/** 判断账号是否持有某个权限码 */
export function can(account, perm) {
  if (!account) return false
  const perms = account.permissions || []
  return perms.includes('*') || perms.includes(perm)
}

export function canAny(account, perms) {
  return perms.some(p => can(account, p))
}

/** 该对象下的全部权限码 */
export function objectPerms(objectKey) {
  return PERMISSIONS.filter(p => p.object === objectKey).map(p => p.key)
}

/** 账号能否看到某个对象的入口（任一权限即可） */
export function canSeeObject(account, objectKey) {
  return canAny(account, objectPerms(objectKey))
}

/** 由权限码推导出可访问的落地页，避免登录后停在无权访问的页面 */
export function landingPath(permissions = []) {
  const has = p => permissions.includes('*') || permissions.includes(p)
  if (has('cluster:list') || has('cluster:detail')) return '/clusters'
  if (has('registry:list') || has('registry:detail')) return '/registries'
  if (has('user:list') || has('user:detail')) return '/users'
  if (has('monitor:list') || has('monitor:detail')) return '/monitor'
  return '/clusters'
}

/** 内置超级管理员（对环境变量里的 admin 账号） */
export const SUPER_ROLE = {
  id: 'admin',
  name: '超级管理员',
  description: '内置 admin 账号，拥有全部权限，不在角色列表中',
  builtin: true,
  permissions: ['*'],
}
