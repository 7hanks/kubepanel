export const WORKLOAD_KINDS = ['Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob']

/** Match forms by API group and kind so custom resources can reuse built-in names. */
export function resourceFormType(meta = {}) {
  const group = meta.group === '_core' ? '' : (meta.group || '')
  const { kind, version } = meta
  const v1 = !version || version === 'v1'
  if (group === '' && kind === 'Pod'
    || group === 'apps' && ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet'].includes(kind)
    || group === 'batch' && ['Job', 'CronJob'].includes(kind)) return 'workload'
  if (group === '' && ['Service', 'ConfigMap', 'Secret'].includes(kind)) return 'core'
  if (group === '' && ['PersistentVolumeClaim', 'PersistentVolume'].includes(kind)
    || group === 'storage.k8s.io' && kind === 'StorageClass') return 'storage'
  if (group === 'rbac.authorization.k8s.io' && v1 && ['Role', 'ClusterRole', 'RoleBinding', 'ClusterRoleBinding'].includes(kind)) return 'rbac'
  if (group === 'networking.k8s.io' && v1 && ['Ingress', 'NetworkPolicy'].includes(kind)) return 'network'
  if (group === 'apiextensions.k8s.io' && v1 && kind === 'CustomResourceDefinition') return 'crd'
  if (group === 'autoscaling' && (!version || version === 'v2') && kind === 'HorizontalPodAutoscaler'
    || group === '' && v1 && ['ResourceQuota', 'LimitRange', 'Endpoints'].includes(kind)
    || group === 'discovery.k8s.io' && v1 && kind === 'EndpointSlice') return 'advanced'
  return 'generic'
}
