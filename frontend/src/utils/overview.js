const compact = n => Number(n.toFixed(2)).toLocaleString('en-US', { maximumFractionDigits: 2 })

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
