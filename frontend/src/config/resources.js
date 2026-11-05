// 资源导航与元数据定义
// group 为空字符串表示 core API 组；URL 中用 '_core' 占位，避免路径出现双斜杠
export const CORE = '_core'
export const ALL_NS = '_all' // 集群级资源 / 全部命名空间

const R = (label, kind, plural, group = '', version = 'v1', namespaced = true, icon = 'Document') => ({
  label, kind, plural, group, version, namespaced, icon,
  key: `${group || CORE}/${version}/${plural}`,
  path: `/r/${group || CORE}/${version}/${plural}`,
})

export const navGroups = [
  { title: '总览', items: [{ label: '集群概览', icon: 'DataBoard', path: '/overview' }] },
  {
    title: '工作负载',
    items: [
      R('Pod', 'Pod', 'pods', '', 'v1', true, 'Box'),
      R('Deployment', 'Deployment', 'deployments', 'apps', 'v1', true, 'Grid'),
      R('StatefulSet', 'StatefulSet', 'statefulsets', 'apps', 'v1', true, 'Files'),
      R('DaemonSet', 'DaemonSet', 'daemonsets', 'apps', 'v1', true, 'Operation'),
      R('ReplicaSet', 'ReplicaSet', 'replicasets', 'apps', 'v1', true, 'CopyDocument'),
      R('Job', 'Job', 'jobs', 'batch', 'v1', true, 'AlarmClock'),
      R('CronJob', 'CronJob', 'cronjobs', 'batch', 'v1', true, 'Timer'),
      R('HPA', 'HorizontalPodAutoscaler', 'horizontalpodautoscalers', 'autoscaling', 'v2', true, 'TrendCharts'),
    ],
  },
  {
    title: '网络',
    items: [
      R('Service', 'Service', 'services', '', 'v1', true, 'Connection'),
      R('Ingress', 'Ingress', 'ingresses', 'networking.k8s.io', 'v1', true, 'Share'),
      R('NetworkPolicy', 'NetworkPolicy', 'networkpolicies', 'networking.k8s.io', 'v1', true, 'Lock'),
      R('Endpoints', 'Endpoints', 'endpoints', '', 'v1', true, 'Link'),
    ],
  },
  {
    title: '配置与权限',
    items: [
      R('ConfigMap', 'ConfigMap', 'configmaps', '', 'v1', true, 'Tickets'),
      R('Secret', 'Secret', 'secrets', '', 'v1', true, 'Key'),
      R('ServiceAccount', 'ServiceAccount', 'serviceaccounts', '', 'v1', true, 'User'),
      R('ResourceQuota', 'ResourceQuota', 'resourcequotas', '', 'v1', true, 'PieChart'),
      R('LimitRange', 'LimitRange', 'limitranges', '', 'v1', true, 'ScaleToOriginal'),
      R('Role', 'Role', 'roles', 'rbac.authorization.k8s.io', 'v1', true, 'UserFilled'),
      R('RoleBinding', 'RoleBinding', 'rolebindings', 'rbac.authorization.k8s.io', 'v1', true, 'Stamp'),
      R('ClusterRole', 'ClusterRole', 'clusterroles', 'rbac.authorization.k8s.io', 'v1', false, 'Avatar'),
      R('ClusterRoleBinding', 'ClusterRoleBinding', 'clusterrolebindings', 'rbac.authorization.k8s.io', 'v1', false, 'Postcard'),
    ],
  },
  {
    title: '存储',
    items: [
      R('PVC', 'PersistentVolumeClaim', 'persistentvolumeclaims', '', 'v1', true, 'FolderOpened'),
      R('PV', 'PersistentVolume', 'persistentvolumes', '', 'v1', false, 'Coin'),
      R('StorageClass', 'StorageClass', 'storageclasses', 'storage.k8s.io', 'v1', false, 'Management'),
    ],
  },
  {
    title: '集群',
    items: [
      R('Node', 'Node', 'nodes', '', 'v1', false, 'Monitor'),
      R('Namespace', 'Namespace', 'namespaces', '', 'v1', false, 'Collection'),
      R('Event', 'Event', 'events', '', 'v1', true, 'Bell'),
      R('CRD', 'CustomResourceDefinition', 'customresourcedefinitions', 'apiextensions.k8s.io', 'v1', false, 'SetUp'),
      { label: '自定义资源', icon: 'Grid', path: '/custom-resources' },
    ],
  },
  { title: '工具', items: [{ label: 'YAML 工作台', icon: 'EditPen', path: '/workbench' }] },
]

// 扁平索引：key = "group/version/plural"，core 组为 "_core"
export const resourceMap = {}
for (const g of navGroups) {
  for (const it of g.items) if (it.key) resourceMap[it.key] = it
}

export function metaFromRoute(params) {
  const key = `${params.group}/${params.version}/${params.plural}`
  return resourceMap[key] || {
    kind: params.plural, plural: params.plural,
    group: params.group === CORE ? '' : params.group,
    version: params.version, namespaced: true, key, label: params.plural,
  }
}

// 已知的内置 API 组，用于从 discovery 结果里筛出「自定义资源」
const BUILTIN_GROUPS = new Set([
  '', 'apps', 'batch', 'autoscaling', 'networking.k8s.io', 'rbac.authorization.k8s.io',
  'storage.k8s.io', 'apiextensions.k8s.io', 'policy', 'coordination.k8s.io',
  'discovery.k8s.io', 'scheduling.k8s.io', 'node.k8s.io', 'admissionregistration.k8s.io',
  'authentication.k8s.io', 'authorization.k8s.io', 'certificates.k8s.io', 'flowcontrol.apiserver.k8s.io',
  'events.k8s.io', 'internal.apiserver.k8s.io', 'resource.k8s.io', 'storagemigration.k8s.io',
])

export function customResources(discovery) {
  return (discovery || [])
    .filter(r => !BUILTIN_GROUPS.has(r.group) && !r.plural.includes('/') && (r.verbs || []).includes('list'))
    .map(r => R(r.kind, r.kind, r.plural, r.group, r.version, r.namespaced, 'MoreFilled'))
}

// 常用资源状态 -> Element Plus Tag 类型
export function statusTag(text = '') {
  const t = String(text).toLowerCase()
  if (/running|ready|active|bound|succeeded|true|available|healthy/.test(t)) return 'success'
  if (/pending|creating|progressing|waiting|terminating/.test(t)) return 'warning'
  if (/failed|error|crashloop|imagepull|notready|unschedulable|evicted|unknown/.test(t)) return 'danger'
  return 'info'
}
