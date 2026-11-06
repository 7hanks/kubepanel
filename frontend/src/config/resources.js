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
      R('容器组', 'Pod', 'pods', '', 'v1', true, 'Box'),
      R('部署', 'Deployment', 'deployments', 'apps', 'v1', true, 'Grid'),
      R('有状态副本集', 'StatefulSet', 'statefulsets', 'apps', 'v1', true, 'Files'),
      R('守护进程集', 'DaemonSet', 'daemonsets', 'apps', 'v1', true, 'Operation'),
      R('副本集', 'ReplicaSet', 'replicasets', 'apps', 'v1', true, 'CopyDocument'),
      R('任务', 'Job', 'jobs', 'batch', 'v1', true, 'AlarmClock'),
      R('定时任务', 'CronJob', 'cronjobs', 'batch', 'v1', true, 'Timer'),
      R('水平自动扩缩', 'HorizontalPodAutoscaler', 'horizontalpodautoscalers', 'autoscaling', 'v2', true, 'TrendCharts'),
    ],
  },
  {
    title: '网络',
    items: [
      R('服务', 'Service', 'services', '', 'v1', true, 'Connection'),
      R('路由', 'Ingress', 'ingresses', 'networking.k8s.io', 'v1', true, 'Share'),
      R('网络策略', 'NetworkPolicy', 'networkpolicies', 'networking.k8s.io', 'v1', true, 'Lock'),
      R('端点', 'Endpoints', 'endpoints', '', 'v1', true, 'Link'),
    ],
  },
  {
    title: '配置与权限',
    items: [
      R('配置项', 'ConfigMap', 'configmaps', '', 'v1', true, 'Tickets'),
      R('密钥', 'Secret', 'secrets', '', 'v1', true, 'Key'),
      R('服务账户', 'ServiceAccount', 'serviceaccounts', '', 'v1', true, 'User'),
      R('资源配额', 'ResourceQuota', 'resourcequotas', '', 'v1', true, 'PieChart'),
      R('限制范围', 'LimitRange', 'limitranges', '', 'v1', true, 'ScaleToOriginal'),
      R('角色', 'Role', 'roles', 'rbac.authorization.k8s.io', 'v1', true, 'UserFilled'),
      R('角色绑定', 'RoleBinding', 'rolebindings', 'rbac.authorization.k8s.io', 'v1', true, 'Stamp'),
      R('集群角色', 'ClusterRole', 'clusterroles', 'rbac.authorization.k8s.io', 'v1', false, 'Avatar'),
      R('集群角色绑定', 'ClusterRoleBinding', 'clusterrolebindings', 'rbac.authorization.k8s.io', 'v1', false, 'Postcard'),
    ],
  },
  {
    title: '存储',
    items: [
      R('持久卷声明', 'PersistentVolumeClaim', 'persistentvolumeclaims', '', 'v1', true, 'FolderOpened'),
      R('持久卷', 'PersistentVolume', 'persistentvolumes', '', 'v1', false, 'Coin'),
      R('存储类', 'StorageClass', 'storageclasses', 'storage.k8s.io', 'v1', false, 'Management'),
    ],
  },
  {
    title: '集群',
    items: [
      R('节点', 'Node', 'nodes', '', 'v1', false, 'Monitor'),
      R('命名空间', 'Namespace', 'namespaces', '', 'v1', false, 'Collection'),
      R('事件', 'Event', 'events', '', 'v1', true, 'Bell'),
      R('自定义资源定义', 'CustomResourceDefinition', 'customresourcedefinitions', 'apiextensions.k8s.io', 'v1', false, 'SetUp'),
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
