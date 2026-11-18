export const RBAC_API_GROUP = 'rbac.authorization.k8s.io'
export const RBAC_KINDS = ['Role', 'ClusterRole', 'RoleBinding', 'ClusterRoleBinding']
export const isRbacResource = meta => meta?.group === RBAC_API_GROUP && RBAC_KINDS.includes(meta.kind)

export function rbacDraftFields(kind, _namespace = '') {
  if (['Role', 'ClusterRole'].includes(kind)) return { rules: [{ apiGroups: [''], resources: [], verbs: [] }] }
  if (['RoleBinding', 'ClusterRoleBinding'].includes(kind)) return {
    roleRef: { apiGroup: RBAC_API_GROUP, kind: kind === 'RoleBinding' ? 'Role' : 'ClusterRole', name: '' },
    // A RoleBinding subject follows the binding namespace until explicitly set.
    subjects: [{ kind: 'ServiceAccount', apiGroup: '', name: '', ...(kind === 'ClusterRoleBinding' ? { namespace: '' } : {}) }],
  }
  return {}
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
function stringList(value, label, { required = false, allowEmpty = false } = {}) {
  if (value === undefined && !required) return
  if (!Array.isArray(value) || required && !value.length || value.some(item => typeof item !== 'string' || (!allowEmpty && !item.trim()) || item !== item.trim())) {
    throw new Error(`${label}${required ? '至少填写一项' : '必须为文本列表'}${allowEmpty ? '，核心 API 组使用空字符串' : '，每项不能为空'}`)
  }
}

/** Validate a draft without normalizing it or discarding server/extension fields. */
export function validateRbacResource(body, { creating = false, original } = {}) {
  if (!RBAC_KINDS.includes(body?.kind)) return
  if (['Role', 'ClusterRole'].includes(body.kind)) {
    if (body.rules == null) return
    if (!Array.isArray(body.rules)) throw new Error('权限规则 rules 必须为列表')
    for (const [index, rule] of body.rules.entries()) {
      const prefix = `规则 ${index + 1}：`
      if (!object(rule)) throw new Error(`${prefix}权限规则必须为对象`)
      stringList(rule.verbs, `${prefix}动作 verbs`, { required: true })
      stringList(rule.nonResourceURLs, `${prefix}非资源 URL`)
      stringList(rule.apiGroups, `${prefix}API 组 apiGroups`, { allowEmpty: true })
      stringList(rule.resources, `${prefix}资源 resources`)
      stringList(rule.resourceNames, `${prefix}资源名称 resourceNames`)
      const urlRule = !!rule.nonResourceURLs?.length || Object.hasOwn(rule, 'nonResourceURLs') && !rule.apiGroups?.length && !rule.resources?.length && !rule.resourceNames?.length
      if (urlRule) {
        if (body.kind !== 'ClusterRole') throw new Error(`${prefix}只有 ClusterRole 可以配置非资源 URL`)
        if (rule.apiGroups?.length || rule.resources?.length || rule.resourceNames?.length) throw new Error(`${prefix}非资源 URL 不能与 API 组、资源或资源名称同时配置`)
        stringList(rule.nonResourceURLs, `${prefix}非资源 URL`, { required: true })
        if (rule.nonResourceURLs.some(url => url !== '*' && (!url.startsWith('/') || url.slice(0, -1).includes('*')))) throw new Error(`${prefix}非资源 URL 必须以 / 开头，通配符 * 只能出现在末尾`)
      } else {
        stringList(rule.apiGroups, `${prefix}API 组 apiGroups`, { required: true, allowEmpty: true })
        stringList(rule.resources, `${prefix}资源 resources`, { required: true })
      }
    }
    return
  }

  const reference = body.roleRef
  if (!object(reference)) throw new Error('请选择引用的角色')
  if (reference.apiGroup !== RBAC_API_GROUP) throw new Error(`角色引用 API 组必须是 ${RBAC_API_GROUP}`)
  const referenceKinds = body.kind === 'RoleBinding' ? ['Role', 'ClusterRole'] : ['ClusterRole']
  if (!referenceKinds.includes(reference.kind)) throw new Error(`角色引用类型必须是 ${referenceKinds.join(' 或 ')}`)
  if (typeof reference.name !== 'string' || !reference.name.trim()) throw new Error('引用的角色名称必填')
  if (!creating && original && ['apiGroup', 'kind', 'name'].some(key => reference[key] !== original.roleRef?.[key])) throw new Error('roleRef 角色引用创建后不可修改，请新建绑定')
  if (body.subjects === undefined) return
  if (!Array.isArray(body.subjects)) throw new Error('绑定主体 subjects 必须为列表')
  for (const [index, subject] of body.subjects.entries()) {
    const prefix = `主体 ${index + 1}：`
    if (!object(subject) || !['ServiceAccount', 'User', 'Group'].includes(subject.kind)) throw new Error(`${prefix}主体类型必须是 ServiceAccount、User 或 Group`)
    if (typeof subject.name !== 'string' || !subject.name.trim()) throw new Error(`${prefix}主体名称必填`)
    if (subject.kind === 'ServiceAccount') {
      if (subject.apiGroup !== undefined && subject.apiGroup !== '') throw new Error(`${prefix}ServiceAccount 的 API 组必须为空`)
      const namespace = subject.namespace || (body.kind === 'RoleBinding' ? body.metadata?.namespace : '')
      if (typeof namespace !== 'string' || !namespace.trim()) throw new Error(`${prefix}ServiceAccount 命名空间必填`)
    } else if (subject.apiGroup !== RBAC_API_GROUP) throw new Error(`${prefix}${subject.kind} 的 API 组必须是 ${RBAC_API_GROUP}`)
  }
}
