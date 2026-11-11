const workloadKinds = ['Deployment', 'StatefulSet', 'ReplicaSet', 'DaemonSet', 'Job', 'CronJob']
const stateKinds = ['Pod', ...workloadKinds, 'Node', 'Namespace', 'PersistentVolume', 'PersistentVolumeClaim', 'Ingress', 'Event']
const text = value => String((Array.isArray(value) ? value[0] : value) ?? '').trim()
const timestamp = value => {
  const valueText = text(value)
  return valueText && Number.isFinite(Date.parse(valueText)) ? new Date(valueText).toISOString() : ''
}

export function filterCapabilities(kind) {
  return {state:stateKinds.includes(kind), pod:kind === 'Pod', node:kind === 'Pod', owner:kind === 'Pod' || workloadKinds.includes(kind), reason:kind === 'Pod' || kind === 'Event', image:kind === 'Pod' || workloadKinds.includes(kind)}
}

export function normalizeFilters(kind, source = {}) {
  const c = filterCapabilities(kind)
  const restarts = Number(text(source.minRestarts))
  const ready = text(source.ready)
  return {
    keyword:text(source.keyword ?? source.q), labels:text(source.labels),
    createdFrom:timestamp(source.createdFrom), createdTo:timestamp(source.createdTo),
    state:c.state ? text(source.state) : '', phase:c.pod ? text(source.phase) : '',
    reason:c.reason ? text(source.reason) : '', node:c.node ? text(source.node) : '',
    owner:c.owner ? text(source.owner) : '', minRestarts:c.pod && Number.isFinite(restarts) ? Math.max(0, Math.floor(restarts)) : 0,
    image:c.image ? text(source.image) : '', ready:c.pod && ['ready','not-ready'].includes(ready) ? ready : '',
  }
}

export function activeFilterCount(filters) {
  return Object.entries(filters).filter(([key, value]) => key !== 'keyword' && !!value).length
}

export function filterQuery(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([,value]) => !!value).map(([key,value]) => [key === 'keyword' ? 'q' : key, String(value)]))
}

export const filterQueryKeys = ['q', 'labels', 'createdFrom', 'createdTo', 'state', 'phase', 'reason', 'node', 'owner', 'minRestarts', 'image', 'ready']
