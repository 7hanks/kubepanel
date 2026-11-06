import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import { config } from './config.js'
import { kubeRequest, KubeError } from './kube.js'

/**
 * 监控：对接多个外部 Grafana 实例（按环境分组管理），并提供不依赖 Grafana 的内置指标。
 *
 * Grafana 只做「配置托管 + 链接/嵌入」，不代理它的所有请求：
 * 浏览器 iframe 直连 Grafana，避免把大流量和大响应体塞进本服务。
 *
 * 存储格式（monitor.json）：
 *   { version: 2, instances: [ { id, name, environment, url, token, enabled, updatedAt } ] }
 * 兼容旧的「单实例」格式 { url, token, enabled, updatedAt }：读取时自动迁移成一条实例。
 */

const FILE = path.join(config.dataDir, 'monitor.json')
const DEFAULT_ENV = '默认'

function newId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function normalizeUrl(url) {
  let u = String(url || '').trim()
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`
  return u.replace(/\/+$/, '')
}

/** 把任意输入归一成一条实例；url 为空视为无效（返回 null） */
function normalizeInstance(x) {
  if (!x || !x.id) return null
  const url = normalizeUrl(x.url)
  if (!url) return null
  return {
    id: String(x.id),
    name: String(x.name || '').trim() || '未命名 Grafana',
    environment: String(x.environment || '').trim() || DEFAULT_ENV,
    url,
    token: String(x.token || ''),
    enabled: x.enabled !== false,
    updatedAt: x.updatedAt || null,
  }
}

/**
 * 读取存储并归一成 { instances }。
 * 兼容旧的单实例配置：内存里迁移，不改写磁盘；首次写操作会落盘成新格式。
 */
function readStore() {
  let raw = {}
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch (e) { raw = {} }

  if (Array.isArray(raw.instances)) {
    return { instances: raw.instances.map(normalizeInstance).filter(Boolean) }
  }
  // 旧格式：只有一条连接。立即落盘成新格式，保证自动生成的 id 稳定
  // （否则每次读取都换 id，前端拿到的 id 在下次 PATCH/DELETE 时会对不上）。
  if (raw.url) {
    const inst = normalizeInstance({
      id: newId(),
      name: '默认 Grafana',
      environment: DEFAULT_ENV,
      url: raw.url,
      token: raw.token,
      enabled: raw.enabled,
      updatedAt: raw.updatedAt,
    })
    const store = { instances: inst ? [inst] : [] }
    try { writeStore(store) } catch (e) { /* 数据目录只读时仅内存迁移，不影响读取 */ }
    return store
  }
  return { instances: [] }
}

function writeStore(store) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
  const payload = { version: 2, instances: store.instances }
  const tmp = `${FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, FILE)
  try { fs.chmodSync(FILE, 0o600) } catch (e) { /* ignore */ }
}

function getInstance(id) {
  if (!id) return null
  return readStore().instances.find(x => x.id === String(id)) || null
}

/** 给前端看的视图：隐藏 token，只告知是否已配置 */
function instanceView(x) {
  return {
    id: x.id,
    name: x.name,
    environment: x.environment,
    url: x.url,
    enabled: x.enabled,
    hasToken: !!x.token,
    updatedAt: x.updatedAt,
    embedHint: `${x.url}/d/<uid>?kiosk&theme=light`,
  }
}

/**
 * 列表视图。除了新的 instances 数组，仍返回单实例的顶层字段（url/enabled/hasToken/
 * updatedAt/embedHint），兼容旧前端与冒烟脚本对 /v1/monitor 的读取。
 */
export function monitorView() {
  const s = readStore()
  const primary = s.instances.find(x => x.enabled) || s.instances[0]
  const p = primary ? instanceView(primary) : null
  return {
    instances: s.instances.map(instanceView),
    url: p?.url || '',
    enabled: p?.enabled || false,
    hasToken: p?.hasToken || false,
    updatedAt: p?.updatedAt || null,
    embedHint: p?.embedHint || '',
  }
}

function requireName(name) {
  const n = String(name || '').trim()
  if (!n) throw new KubeError(400, '请填写实例名称')
  return n
}

export function createMonitor(draft) {
  const s = readStore()
  const inst = normalizeInstance({
    id: newId(),
    name: requireName(draft?.name),
    environment: draft?.environment,
    url: draft?.url,
    token: draft?.token || '',
    enabled: draft?.enabled !== false,
    updatedAt: new Date().toISOString(),
  })
  if (!inst) throw new KubeError(400, '请填写有效的 Grafana 地址')
  s.instances.push(inst)
  writeStore(s)
  return monitorView()
}

export function updateMonitor(id, patch) {
  const s = readStore()
  const idx = s.instances.findIndex(x => x.id === String(id))
  if (idx < 0) throw new KubeError(404, 'Grafana 实例不存在')
  const cur = s.instances[idx]
  const next = normalizeInstance({
    ...cur,
    name: patch.name !== undefined ? requireName(patch.name) : cur.name,
    environment: patch.environment !== undefined ? patch.environment : cur.environment,
    url: patch.url !== undefined ? patch.url : cur.url,
    // token 留空 = 保持原值；clearToken = 显式清空
    token: patch.token ? String(patch.token) : (patch.clearToken ? '' : cur.token),
    enabled: patch.enabled !== undefined ? !!patch.enabled : cur.enabled,
    updatedAt: new Date().toISOString(),
  })
  if (!next) throw new KubeError(400, '请填写有效的 Grafana 地址')
  s.instances[idx] = next
  writeStore(s)
  return monitorView()
}

export function deleteMonitor(id) {
  const s = readStore()
  const before = s.instances.length
  s.instances = s.instances.filter(x => x.id !== String(id))
  if (s.instances.length === before) throw new KubeError(404, 'Grafana 实例不存在')
  writeStore(s)
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

/** 测试连接：可测某条已保存实例（id），也可测草稿（url + token） */
export async function testMonitor(draft) {
  let cfg
  if (draft?.id) {
    const inst = getInstance(draft.id)
    if (!inst) throw new KubeError(404, 'Grafana 实例不存在')
    cfg = { url: inst.url, token: draft.token || inst.token }
  } else {
    cfg = { url: normalizeUrl(draft?.url), token: draft?.token || '' }
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

/** 列出指定实例的仪表盘；未指定时取第一个启用的实例 */
export async function listDashboards(id) {
  const s = readStore()
  const inst = (id && s.instances.find(x => x.id === String(id)))
    || s.instances.find(x => x.enabled)
    || s.instances[0]
  if (!inst) throw new KubeError(400, '尚未配置 Grafana 实例')
  const list = await grafanaRequest(inst, '/api/search?type=dash-db&limit=1000')
  const base = inst.url.replace(/\/+$/, '')
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
