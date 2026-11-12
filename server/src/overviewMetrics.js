// CPU quantities are returned in millicores; memory quantities in bytes.
// Missing or malformed quantities must never become measured zero.
function quantity(value, kind) {
  if (value == null || value === '') return null
  const match = String(value).match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([a-zA-Z]*)$/)
  if (!match) return null
  const scales = kind === 'cpu'
    ? { '': 1000, m: 1, u: 1e-3, n: 1e-6 }
    : { '': 1, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18, Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6 }
  const scale = scales[match[2]]
  const result = Number(match[1]) * scale
  return scale != null && Number.isFinite(result) && result >= 0 ? result : null
}

export function aggregateNodeUsage(nodes, metrics) {
  const nodeList = nodes?.items || []
  const byName = new Map((metrics?.items || []).map(m => [m.metadata?.name, m]))
  const sampled = nodeList.filter(n => byName.has(n.metadata?.name)).length
  const unavailable = reason => ({ available: false, reason, sampled, total: nodes ? nodeList.length : null, cpu: null, memory: null })
  if (!nodes) return unavailable('nodes-unavailable')
  if (!metrics) return unavailable('metrics-unavailable')
  if (!nodeList.length) return unavailable('no-nodes')
  if (nodes.metadata?.continue || metrics.metadata?.continue || sampled !== nodeList.length) return unavailable('incomplete-metrics')
  const total = { cpu: { used: 0, allocatable: 0 }, memory: { used: 0, allocatable: 0 } }
  for (const node of nodeList) {
    const metric = byName.get(node.metadata?.name)
    for (const kind of ['cpu', 'memory']) {
      const used = quantity(metric?.usage?.[kind], kind)
      const allocatable = quantity(node.status?.allocatable?.[kind], kind)
      if (used == null) return unavailable('incomplete-metrics')
      if (allocatable == null || allocatable <= 0) return unavailable('allocatable-unavailable')
      total[kind].used += used
      total[kind].allocatable += allocatable
    }
  }
  for (const value of Object.values(total)) value.percent = Math.round(value.used / value.allocatable * 1000) / 10
  return { available: true, reason: null, sampled, total: nodeList.length, ...total }
}
