const compact = n => Number(n.toFixed(2)).toLocaleString('en-US', { maximumFractionDigits: 2 })
const memoryUnits = {
  '': 1, n: 1e-9, u: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6,
  G: 1e9, T: 1e12, P: 1e15, E: 1e18,
  Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6,
}

export function memoryQuantityGi(quantity) {
  if (typeof quantity !== 'number' && typeof quantity !== 'string') return '—'
  const match = String(quantity).trim().match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([a-zA-Z]*)$/)
  if (!match || !Object.hasOwn(memoryUnits, match[2])) return '—'
  const gi = Number(match[1]) * (memoryUnits[match[2]] / 1024 ** 3)
  return Number.isFinite(gi) ? `${compact(gi)} Gi` : '—'
}

export function usagePresentation(metric, kind) {
  if (!metric || ![metric.used, metric.allocatable, metric.percent].every(Number.isFinite) || metric.allocatable <= 0) return { value: '—', percent: 0, detail: '指标不可用', available: false }
  const divisor = kind === 'cpu' ? 1000 : 1024 ** 3
  return { value: `${metric.percent}%`, percent: Math.max(0, Math.min(100, metric.percent)), detail: `${compact(metric.used / divisor)} / ${compact(metric.allocatable / divisor)} ${kind === 'cpu' ? '核' : 'GiB'}`, available: true }
}

export function overviewHealth({ loaded, loading, partial, error, unhealthyPods, nodes, badNodes = 0 } = {}) {
  if (!loading && (unhealthyPods > 0 || badNodes > 0)) return { label: '发现异常', type: 'danger' }
  if (!loaded || loading || partial || error || unhealthyPods == null || nodes == null) return { label: loading ? '读取中' : '待确认', type: 'info' }
  return { label: '范围内正常', type: 'success' }
}

export function recentWarningCount(data, loaded) {
  if (!loaded || data.errors?.events || !Array.isArray(data.events)) return null
  return data.events.filter(event => event.type === 'Warning').length
}
