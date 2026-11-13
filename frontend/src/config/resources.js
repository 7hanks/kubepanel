import {resourceTitle} from '../utils/resource-ui.js'
// 资源导航与元数据定义
// group 为空字符串表示 core API 组；URL 中用 '_core' 占位，避免路径出现双斜杠
export const CORE = '_core'
export const ALL_NS = '_all' // 集群级资源 / 全部命名空间

const R = (label, kind, plural, group = '', version = 'v1', namespaced = true, icon = 'Document', aliases = '') => ({
  label: resourceTitle({kind,label}), kind, plural, group, version, namespaced, icon, aliases: `${aliases} ${label}`,
  key: `${group || CORE}/${version}/${plural}`,
  path: `/r/${group || CORE}/${version}/${plural}`,
})

export const navGroups = [
  { id: 'overview', title: '总览', icon: 'DataBoard', defaultOpen: true, items: [{ label: '集群概览', icon: 'DataBoard', path: '/overview' }] },
  {
    id: 'workloads', title: '工作负载', icon: 'Box', defaultOpen: true,
    items: [
      R('Pods', 'Pod', 'pods', '', 'v1', true, 'Box', '容器组'),
      R('Deployments', 'Deployment', 'deployments', 'apps', 'v1', true, 'Grid', '部署'),
      R('StatefulSets', 'StatefulSet', 'statefulsets', 'apps', 'v1', true, 'Files', '有状态副本集 有状态工作负载'),
      R('DaemonSets', 'DaemonSet', 'daemonsets', 'apps', 'v1', true, 'Operation', '守护进程集'),
      R('Jobs', 'Job', 'jobs', 'batch', 'v1', true, 'AlarmClock', '任务'),
      R('CronJobs', 'CronJob', 'cronjobs', 'batch', 'v1', true, 'Timer', '定时任务'),
    ],
  },
  {
    id: 'network', title: '网络', icon: 'Connection',
    items: [
      R('Services', 'Service', 'services', '', 'v1', true, 'Connection', '服务'),
      R('Ingresses', 'Ingress', 'ingresses', 'networking.k8s.io', 'v1', true, 'Share', '路由 入口'),
      R('NetworkPolicies', 'NetworkPolicy', 'networkpolicies', 'networking.k8s.io', 'v1', true, 'Lock', '网络策略'),
    ],
  },
  {
    id: 'configuration', title: '配置', icon: 'Tickets',
    items: [
      R('ConfigMaps', 'ConfigMap', 'configmaps', '', 'v1', true, 'Tickets', '配置项 配置映射'),
      R('Secrets', 'Secret', 'secrets', '', 'v1', true, 'Key', '密钥 保密字典'),
    ],
  },
  {
    id: 'storage', title: '存储', icon: 'FolderOpened',
    items: [
      R('PVCs', 'PersistentVolumeClaim', 'persistentvolumeclaims', '', 'v1', true, 'FolderOpened', '持久卷声明'),
      R('PVs', 'PersistentVolume', 'persistentvolumes', '', 'v1', false, 'Coin', '持久卷'),
      R('StorageClasses', 'StorageClass', 'storageclasses', 'storage.k8s.io', 'v1', false, 'Management', '存储类'),
    ],
  },
  {
    id: 'cluster', title: '集群管理', icon: 'Monitor',
    items: [
      { label: 'Kubernetes 集群', icon: 'OfficeBuilding', path: '/clusters' },
      R('Nodes', 'Node', 'nodes', '', 'v1', false, 'Monitor', '节点'),
      R('Namespaces', 'Namespace', 'namespaces', '', 'v1', false, 'Collection', '命名空间'),
      R('Events', 'Event', 'events', '', 'v1', true, 'Bell', '事件'),
      R('CRDs', 'CustomResourceDefinition', 'customresourcedefinitions', 'apiextensions.k8s.io', 'v1', false, 'SetUp', '自定义资源定义'),
      { label: '自定义资源', icon: 'Grid', path: '/custom-resources' },
    ],
  },
  {
    id: 'access', title: '访问控制', icon: 'Lock',
    items: [
      R('ServiceAccounts', 'ServiceAccount', 'serviceaccounts', '', 'v1', true, 'User', '服务账户 服务账号'),
      R('Roles', 'Role', 'roles', 'rbac.authorization.k8s.io', 'v1', true, 'UserFilled', '角色 RBAC'),
      R('RoleBindings', 'RoleBinding', 'rolebindings', 'rbac.authorization.k8s.io', 'v1', true, 'Stamp', '角色绑定 RBAC'),
      R('ClusterRoles', 'ClusterRole', 'clusterroles', 'rbac.authorization.k8s.io', 'v1', false, 'Avatar', '集群角色 RBAC'),
      R('ClusterRoleBindings', 'ClusterRoleBinding', 'clusterrolebindings', 'rbac.authorization.k8s.io', 'v1', false, 'Postcard', '集群角色绑定 RBAC'),
    ],
  },
  {
    id: 'advanced', title: '高级资源', icon: 'SetUp',
    items: [
      R('HPA', 'HorizontalPodAutoscaler', 'horizontalpodautoscalers', 'autoscaling', 'v2', true, 'TrendCharts', '水平自动扩缩 自动伸缩'),
      R('ResourceQuotas', 'ResourceQuota', 'resourcequotas', '', 'v1', true, 'PieChart', '资源配额'),
      R('LimitRanges', 'LimitRange', 'limitranges', '', 'v1', true, 'ScaleToOriginal', '限制范围 资源限制'),
      R('ReplicaSets', 'ReplicaSet', 'replicasets', 'apps', 'v1', true, 'CopyDocument', '副本集'),
      R('Endpoints', 'Endpoints', 'endpoints', '', 'v1', true, 'Link', '端点'),
      R('EndpointSlices', 'EndpointSlice', 'endpointslices', 'discovery.k8s.io', 'v1', true, 'Link', '端点切片'),
    ],
  },
  { id: 'tools', title: '工具', icon: 'EditPen', items: [{ label: 'YAML 工作台', icon: 'EditPen', path: '/workbench' }] },
]

// 扁平索引：key = "group/version/plural"，core 组为 "_core"
export const resourceMap = {}
for (const g of navGroups) {
  for (const it of g.items) if (it.key) resourceMap[it.key] = it
}

export function metaFromRoute(params, discovery = []) {
  const key = `${params.group}/${params.version}/${params.plural}`
  const group = params.group === CORE ? '' : params.group
  const discovered = discovery.find(r => r.group === group && r.version === params.version && r.plural === params.plural)
  return discovered ? { ...resourceMap[key], ...discovered, key, label: resourceMap[key]?.label || discovered.kind } : resourceMap[key] || {
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
  if (/notready|nothealthy|unhealthy|failed|error|crashloop|imagepull|unschedulable|evicted|unknown|backoff/.test(t)) return 'danger'
  if (/^(running|ready|active|bound|succeeded|true|available|healthy|completed)$/.test(t)) return 'success'
  if (/pending|creating|progressing|waiting|terminating/.test(t)) return 'warning'
  if (/failed|error|crashloop|imagepull|notready|unschedulable|evicted|unknown/.test(t)) return 'danger'
  return 'info'
}
