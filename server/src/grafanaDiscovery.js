import { assertClusterAccess } from './access.js'
import { getCluster, KubeError } from './kube.js'
import { scopedList } from './resourceScope.js'

const grafanaName = value => /(?:^|[-_/ .])grafana(?:$|[-_/ .])/i.test(String(value || ''))
function resourceNames(resource) {
  const labels = resource.metadata?.labels || {}
  return [resource.metadata?.name, labels['app.kubernetes.io/name'], labels['app.kubernetes.io/component'], labels.app, labels['k8s-app']]
}
const excludedGrafana = resource => resourceNames(resource).some(value => /renderer|grafana[-_ ]?(agent|alloy)/i.test(String(value || '')))
const likelyGrafana = resource => !excludedGrafana(resource) && resourceNames(resource).some(grafanaName)
function webPorts(service) {
  return (service.spec?.ports || []).filter(port => (!port.protocol || port.protocol === 'TCP') && !/metrics|grpc/i.test(port.name || ''))
}
function browserUrl(scheme, host, port, pathname = '') {
  if (typeof host !== 'string' || !host || /[\s/*@?#\\]/.test(host)) return ''
  const hostname = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  if (pathname && (!pathname.startsWith('/') || /[?#\s()[\]{}|*^$\\]/.test(pathname))) return ''
  try {
    const url = new URL(`${scheme}://${hostname}${port ? `:${port}` : ''}${pathname}`)
    if (url.username || url.password) return ''
    return url.toString().replace(/\/+$/, '')
  } catch { return '' }
}
const schemeFor = port => port.port === 443 || /https|tls/i.test(port.name || '') || port.appProtocol === 'https' ? 'https' : 'http'

/** Read only authorized Service/Ingress metadata. Discovery never probes endpoints or reads credentials. */
export async function discoverGrafanas(clusterId, namespace = '', { account } = {}) {
  if (typeof clusterId !== 'string' || !clusterId.trim() || clusterId.length > 253) throw new KubeError(400, '请先选择集群')
  if (typeof namespace !== 'string' || (namespace && !/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(namespace))) throw new KubeError(400, '命名空间格式不合法')
  assertClusterAccess(account, clusterId)
  const cluster = getCluster(clusterId)
  const targets = [
    { label: 'Service', group: '', version: 'v1', plural: 'services', namespaced: true },
    { label: 'Ingress', group: 'networking.k8s.io', version: 'v1', plural: 'ingresses', namespaced: true },
  ]
  const results = await Promise.allSettled(targets.map(async meta => {
    const result = await scopedList(account, meta, { clusterId, namespace: namespace || undefined, timeout: 10000 })
    if (!Array.isArray(result?.items)) throw new KubeError(502, `${meta.label} 返回无效列表`)
    return result.items
  }))
  const warnings = results.flatMap((result, index) => result.status === 'rejected' ? [`${targets[index].label} 扫描失败：${result.reason?.message || '读取失败'}`] : [])
  if (results.every(result => result.status === 'rejected')) {
    throw new KubeError(results[0].reason?.status || 502, warnings.join('；'))
  }
  const services = results[0].status === 'fulfilled' ? results[0].value : []
  const ingresses = results[1].status === 'fulfilled' ? results[1].value : []
  const matching = services.filter(service => !excludedGrafana(service) && (likelyGrafana(service) || webPorts(service).some(port => port.port === 3000 || port.targetPort === 3000 || grafanaName(port.name))))
  const byName = new Map(matching.map(service => [`${service.metadata?.namespace}/${service.metadata?.name}`, service]))
  const items = [], seen = new Set()
  function add(resource, candidate) {
    const ns = resource.metadata?.namespace || '', name = resource.metadata?.name || ''
    const result = { name: `${ns}/${name}`, namespace: ns, ...candidate }
    const key = `${result.source}/${ns}/${name}/${result.url}`
    if (!seen.has(key)) { seen.add(key); items.push(result) }
  }
  for (const service of matching) {
    const before = items.length
    for (const port of webPorts(service)) {
      const scheme = schemeFor(port)
      const addresses = [
        ...(service.status?.loadBalancer?.ingress || []).map(address => address.hostname || address.ip),
        ...(service.spec?.externalIPs || []),
      ]
      for (const address of addresses) {
        const url = browserUrl(scheme, address, port.port)
        if (url) add(service, { service: service.metadata?.name, source: 'Service', url, exposure: service.spec?.type || 'ExternalIP', hint: '外部地址，添加后请测试连接' })
      }
      if (!addresses.length && port.nodePort && cluster.mode !== 'in-cluster-serviceaccount') {
        const host = cluster.baseURL.hostname
        const url = /(?:\.svc(?:\.|$)|\.cluster\.local$|^kubernetes$)/i.test(host) ? '' : browserUrl(scheme, host, port.nodePort)
        if (url) add(service, { service: service.metadata?.name, source: 'Service', url, exposure: 'NodePort', hint: '使用集群 API 地址的主机名，请确认 NodePort 可访问' })
      }
    }
    if (items.length === before) add(service, { service: service.metadata?.name, source: 'Service', url: '', exposure: service.spec?.type || 'ClusterIP', hint: !service.spec?.type || service.spec.type === 'ClusterIP' ? '仅发现集群内服务（ClusterIP），请填写浏览器可访问地址' : '未发现可靠的外部地址，请填写浏览器可访问地址' })
  }
  for (const ingress of ingresses) {
    for (const rule of ingress.spec?.rules || []) {
      for (const entry of rule.http?.paths || []) {
        const backend = entry.backend?.service?.name
        if (!likelyGrafana(ingress) && !byName.has(`${ingress.metadata?.namespace}/${backend}`) && !grafanaName(backend)) continue
        const tls = (ingress.spec?.tls || []).some(config => !config.hosts?.length || config.hosts.includes(rule.host))
        const url = browserUrl(tls ? 'https' : 'http', rule.host, undefined, entry.path || '/')
        add(ingress, { service: backend || '', source: 'Ingress', url, exposure: 'Ingress', hint: url ? 'Ingress 地址，添加后请测试连接' : '未发现可直接使用的 Ingress 域名或路径，请手动填写地址' })
      }
    }
  }
  items.sort((a, b) => Number(!!b.url) - Number(!!a.url) || Number(b.source === 'Ingress') - Number(a.source === 'Ingress') || a.name.localeCompare(b.name) || a.url.localeCompare(b.url))
  return { items, warnings }
}
