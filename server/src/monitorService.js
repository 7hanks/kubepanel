import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { config } from './config.js'
import { kubeRequest, KubeError } from './kube.js'

/**
 * 监控：对接外部 Grafana（配置 + 仪表盘清单），并提供不依赖 Grafana 的内置指标。
 *
 * Grafana 只做「配置托管 + 链接/嵌入」，不代理它的所有请求：
 * 浏览器 iframe 直连 Grafana，避免把大流量和大响应体塞进本服务。
 */

const FILE = path.join(config.dataDir, 'monitor.json')

const DEFAULTS = { url: '', token: '', enabled: false, updatedAt: null }

export function readMonitor() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return { ...DEFAULTS, ...raw }
  } catch (e) {
    return { ...DEFAULTS }
  }
}

/** 给前端看的视图：token 只告知是否已配置 */
export function monitorView() {
  const m = readMonitor()
  return {
    url: m.url || '',
    enabled: !!m.enabled,
    hasToken: !!m.token,
    updatedAt: m.updatedAt,
    embedHint: m.url ? `${m.url.replace(/\/+$/, '')}/d/<uid>?kiosk&theme=light` : '',
  }
}

function normalizeUrl(url) {
  let u = String(url || '').trim()
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`
  return u.replace(/\/+$/, '')
}

export function saveMonitor({ url, token, enabled, clearToken }) {
  const cur = readMonitor()
  const next = {
    url: url !== undefined ? normalizeUrl(url) : cur.url,
    // token 留空 = 保持原值；clearToken = 显式清空
    token: token ? String(token) : (clearToken ? '' : cur.token),
    enabled: enabled !== undefined ? !!enabled : cur.enabled,
    updatedAt: new Date().toISOString(),
  }
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
  const tmp = `${FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, FILE)
  try { fs.chmodSync(FILE, 0o600) } catch (e) { /* ignore */ }
  return monitorView()
}

function grafanaRequest(cfg, reqPath, { timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    let base
    try { base = new URL(cfg.url) } catch (e) { return reject(new KubeError(400, 'Grafana 地址不合法')) }
    const isHttps = base.protocol === 'https:'
    const mod = isHttps ? https : http
    const headers = { Accept: 'application/json' }
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`
    const req = mod.request({
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port || (isHttps ? 443 : 80),
      path: reqPath,
      method: 'GET',
      headers,
      rejectUnauthorized: false,
      timeout,
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode === 401 || res.statusCode === 403) {
          return reject(new KubeError(401, `Grafana 拒绝访问（${res.statusCode}）：请检查服务账号 Token`))
        }
        if (res.statusCode >= 400) return reject(new KubeError(res.statusCode, `Grafana 返回 ${res.statusCode}`))
        try { resolve(JSON.parse(body)) } catch (e) { resolve(body) }
      })
    })
    req.on('error', e => reject(new KubeError(502, `连接 Grafana 失败：${e.code || e.message}`)))
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.end()
  })
}

export async function testMonitor(draft) {
  const cfg = {
    url: normalizeUrl(draft?.url ?? readMonitor().url),
    token: draft?.token || readMonitor().token,
  }
  if (!cfg.url) throw new KubeError(400, '请先填写 Grafana 地址')
  const started = Date.now()
  const health = await grafanaRequest(cfg, '/api/health')
  const version = health?.version || ''
  let dashboards = 0
  try {
    const list = await grafanaRequest(cfg, '/api/search?type=dash-db&limit=1000')
    dashboards = Array.isArray(list) ? list.length : 0
  } catch (e) { /* 没有 token 时搜索会 401，不算连接失败 */ }
  return { ok: true, version, dashboards, ms: Date.now() - started, url: cfg.url }
}

export async function listDashboards() {
  const m = readMonitor()
  if (!m.url) throw new KubeError(400, '尚未配置 Grafana 地址')
  const list = await grafanaRequest(m, '/api/search?type=dash-db&limit=1000')
  const base = m.url.replace(/\/+$/, '')
  return (Array.isArray(list) ? list : []).map(d => ({
    uid: d.uid,
    title: d.title,
    url: `${base}${d.url || `/d/${d.uid}`}`,
    embedUrl: `${base}/d/${d.uid}?kiosk&theme=light`,
    tags: d.tags || [],
    folder: d.folderTitle || '',
  }))
}

/** 内置 Pod 指标（metrics-server / metrics.k8s.io），Grafana 未接入时也能看到东西 */
export async function podMetrics(clusterId, namespace) {
  const query = namespace && namespace !== 'all' ? { namespace } : {}
  const path = namespace && namespace !== 'all'
    ? `/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/pods`
    : '/apis/metrics.k8s.io/v1beta1/pods'
  const r = await kubeRequest('GET', path, { clusterId, query })
  const items = (r.data.items || []).map(p => {
    const containerUsage = (p.containers || []).reduce((acc, c) => {
      acc.cpu += parseCpu(c.usage?.cpu)
      acc.mem += parseMem(c.usage?.memory)
      return acc
    }, { cpu: 0, mem: 0 })
    return {
      namespace: p.metadata?.namespace,
      name: p.metadata?.name,
      cpu: containerUsage.cpu,
      cpuText: `${containerUsage.cpu.toFixed(1)}m`,
      memory: containerUsage.mem,
      memoryText: fmtBytes(containerUsage.mem),
      timestamp: p.timestamp,
    }
  })
  items.sort((a, b) => b.cpu - a.cpu)
  return {
    items,
    totalCpu: items.reduce((a, b) => a + b.cpu, 0),
    totalMemory: items.reduce((a, b) => a + b.memory, 0),
  }
}

/**
 * 资源使用率 TOP N 的 Pod。
 * 用量来自 metrics-server；使用率 = 用量 / 该 Pod 声明的 requests（没声明 requests 时为 null）。
 */
export async function topPods(clusterId, limit = 10) {
  const [m, pods] = await Promise.all([
    kubeRequest('GET', '/apis/metrics.k8s.io/v1beta1/pods', { clusterId, timeout: 6000 }),
    kubeRequest('GET', '/api/v1/pods', { clusterId, timeout: 6000 }).catch(() => null),
  ])

  // 每个 Pod 的 requests 汇总，用来算「使用率」；拿不到 pods 列表时只显示用量
  const requests = {}
  for (const p of pods?.data?.items || []) {
    const key = `${p.metadata?.namespace}/${p.metadata?.name}`
    requests[key] = (p.spec?.containers || []).reduce((acc, c) => {
      acc.cpu += parseCpu(c.resources?.requests?.cpu)
      acc.mem += parseMem(c.resources?.requests?.memory)
      return acc
    }, { cpu: 0, mem: 0 })
  }

  const items = (m.data.items || []).map(p => {
    const key = `${p.metadata?.namespace}/${p.metadata?.name}`
    const usage = (p.containers || []).reduce((acc, c) => {
      acc.cpu += parseCpu(c.usage?.cpu)
      acc.mem += parseMem(c.usage?.memory)
      return acc
    }, { cpu: 0, mem: 0 })
    const req = requests[key] || { cpu: 0, mem: 0 }
    return {
      namespace: p.metadata?.namespace,
      name: p.metadata?.name,
      cpu: usage.cpu,
      cpuText: fmtCpu(usage.cpu),
      cpuPercent: req.cpu > 0 ? Math.round((usage.cpu / req.cpu) * 100) : null,
      memory: usage.mem,
      memoryText: fmtBytes(usage.mem),
      memoryPercent: req.mem > 0 ? Math.round((usage.mem / req.mem) * 100) : null,
      requestsCpu: req.cpu,
      requestsMemory: req.mem,
      timestamp: p.timestamp,
    }
  })

  items.sort((a, b) => b.cpu - a.cpu)
  return {
    items: items.slice(0, Math.max(1, Number(limit) || 10)),
    total: items.length,
    totalCpu: items.reduce((a, b) => a + b.cpu, 0),
    totalMemory: items.reduce((a, b) => a + b.memory, 0),
    timestamp: items[0]?.timestamp || null,
  }
}

export function fmtCpu(milli) {
  if (!milli) return '0'
  return milli >= 1000 ? `${(milli / 1000).toFixed(2)} core` : `${milli.toFixed(1)}m`
}

export function parseCpu(v) {
  const s = String(v || '0')
  if (s.endsWith('n')) return Number(s.slice(0, -1)) / 1e6
  if (s.endsWith('u')) return Number(s.slice(0, -1)) / 1e3
  if (s.endsWith('m')) return Number(s.slice(0, -1))
  return Number(s) * 1000 || 0
}

export function parseMem(v) {
  const s = String(v || '0')
  const units = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, K: 1e3, M: 1e6, G: 1e9 }
  const m = s.match(/^([\d.]+)([A-Za-z]*)$/)
  if (!m) return 0
  return Number(m[1]) * (units[m[2]] || 1)
}

export function fmtBytes(n) {
  if (!n) return '0'
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GiB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MiB`
  return `${Math.round(n / 1024)} KiB`
}
