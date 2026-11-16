/** Keep the compact role table and its full permission details in sync. */
export function permissionGroups(permissions = [], objects = [], actions = [], sensitivePermissions = []) {
  const remaining = new Set(permissions)
  const groups = []

  for (const object of objects) {
    const granted = actions
      .filter(action => remaining.has(`${object.key}:${action.key}`))
      .map(action => ({ key: `${object.key}:${action.key}`, label: action.label, action: action.key }))
    if (!granted.length) continue
    const readOnly = granted.every(permission => ['list', 'detail'].includes(permission.action))
    groups.push({
      key: object.key,
      label: object.label.replace(/对象$/, ''),
      access: readOnly ? 'read' : granted.length === actions.length ? 'manage' : 'custom',
      permissions: granted.map(({ key, label }) => ({ key, label })),
    })
    for (const permission of granted) remaining.delete(permission.key)
  }

  const sensitive = sensitivePermissions.filter(permission => remaining.has(permission.key))
  if (sensitive.length) {
    groups.push({ key: 'sensitive', label: '敏感操作', permissions: sensitive.map(({ key, label }) => ({ key, label })) })
    for (const permission of sensitive) remaining.delete(permission.key)
  }
  if (remaining.size) {
    groups.push({ key: 'other', label: '其他权限', permissions: [...remaining].map(key => ({ key, label: key })) })
  }
  return groups
}

export function scopeSummary(scope = {}) {
  return [
    { key: 'clusters', label: '集群', unit: '个' },
    { key: 'namespaces', label: '命名空间', unit: '个' },
    { key: 'resources', label: '资源', unit: '类' },
  ].map(({ key, label, unit }) => {
    const values = scope?.[key] ?? ['*']
    const unrestricted = values.includes('*')
    return {
      key, label, values, unrestricted,
      summary: unrestricted ? `全部${label}` : values.length ? `${values.length} ${unit}${label}` : `无${label}授权`,
    }
  })
}
