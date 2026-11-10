import https from 'node:https'
import http from 'node:http'
import { load } from 'js-yaml'
import { config } from './config.js'

/** 带状态码的 K8s 错误，交给统一错误处理中间件转成 HTTP 响应 */
export class KubeError extends Error {
  constructor(status, message, details) {
    super(message)
    this.name = 'KubeError'
    this.status = status
    this.details = details
  }
}

// ---------------------------------------------------------------------------
// 多集群注册表：每个集群持有独立的 KubeConfig、baseURL 与 discovery 缓存
// ---------------------------------------------------------------------------
const registry = new Map()
let defaultClusterId = null

function validateServer(server) {
  let url
  try { url = new URL(server) } catch { throw new KubeError(400, 'API Server 必须是有效的 http(s) URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new KubeError(400, 'API Server 必须是无内嵌凭据的 http(s) URL')
  }
  return url
}

/** Validate raw YAML before the SDK can resolve any file or credential provider. */
export function validateKubeconfigText(content) {
  const doc = load(content)
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new KubeError(400, 'kubeconfig 必须是对象')
  for (const { cluster = {} } of doc.clusters || []) {
    validateServer(cluster.server)
    for (const key of ['certificate-authority', 'proxy-url']) {
      if (cluster[key] !== undefined) throw new KubeError(400, `kubeconfig 不允许 ${key}，请使用内联证书数据`)
    }
  }
  for (const { user = {} } of doc.users || []) {
    for (const key of ['exec', 'auth-provider', 'client-certificate', 'client-key', 'tokenFile', 'token-file']) {
      if (user[key] !== undefined) throw new KubeError(400, `kubeconfig 不允许 ${key}，请使用内联凭据`)
    }
  }
  return doc
}

/** Defense in depth for already loaded configs, including the local default config. */
export function validateKubeConfig(kc, trustedInCluster = false) {
  kc.setExecCredentialPluginPolicy?.({ credentialPluginPolicy: 'DenyAll' })
  for (const c of kc.getClusters?.() || [kc.getCurrentCluster()]) {
    validateServer(c.server)
    if (c.proxyUrl || (c.caFile && !(trustedInCluster && c.caFile === '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'))) {
      throw new KubeError(400, 'kubeconfig 不允许代理或外部 CA 文件')
    }
  }
  for (const u of kc.getUsers?.() || [kc.getCurrentUser()].filter(Boolean)) {
    const serviceAccount = trustedInCluster && u.authProvider?.name === 'tokenFile'
      && u.authProvider?.config?.tokenFile === '/var/run/secrets/kubernetes.io/serviceaccount/token'
    if (u.exec || (u.authProvider && !serviceAccount) || u.certFile || u.keyFile || u.tokenFile) {
      throw new KubeError(400, 'kubeconfig 不允许外部凭据插件或证书、密钥、Token 文件')
    }
  }
}

/**
 * 注册一个集群。entry 由 clusterService 构造：
 * { id, name, kc, source, mode, authMode, removable }
 */
export function registerCluster(entry) {
  if (!entry?.kc) throw new Error('registerCluster 需要 KubeConfig 实例')
  validateKubeConfig(entry.kc, entry.mode === 'in-cluster-serviceaccount' && entry.source === 'serviceaccount')
  const cluster = entry.kc.getCurrentCluster()
  if (!cluster?.server) throw new Error(`集群 ${entry.name || entry.id} 缺少 API Server 地址`)
  const record = {
    ...entry,
    server: cluster.server,
    context: entry.kc.getCurrentContext(),
    baseURL: validateServer(cluster.server),
    discoveryCache: { at: 0, data: null },
  }
  registry.set(entry.id, record)
  if (!defaultClusterId) defaultClusterId = entry.id
  return record
}

export function unregisterCluster(id) {
  registry.delete(id)
  if (defaultClusterId === id) defaultClusterId = registry.keys().next().value || null
}

export function getDefaultClusterId() { return defaultClusterId }
export function setDefaultClusterId(id) { if (registry.has(id)) defaultClusterId = id }
export function listClusters() { return [...registry.values()] }

/** 取集群（未指定则用默认集群）；不存在时抛 404，前端可据此提示用户重新选择 */
export function getCluster(clusterId) {
  const id = clusterId || defaultClusterId
  const c = registry.get(id)
  if (!c) throw new KubeError(404, `集群不存在或未配置：${id || '(空)'}`)
  return c
}

export function getKubeConfig(clusterId) { return getCluster(clusterId).kc }

export function kubeContext(clusterId) {
  const c = getCluster(clusterId)
  const cluster = c.kc.getCurrentCluster()
  const user = c.kc.getCurrentUser()
  return {
    id: c.id,
    name: c.name,
    server: cluster?.server,
    skipTLSVerify: !!cluster?.skipTLSVerify,
    user: user?.name,
    context: c.context,
    mode: c.mode,
    authMode: c.authMode,
    source: c.source,
  }
}

export function clearDiscoveryCache(clusterId) {
  const c = getCluster(clusterId)
  c.discoveryCache = { at: 0, data: null }
}
export function discoveryErrors(clusterId) { return getCluster(clusterId).discoveryCache.errors || [] }

// ---------------------------------------------------------------------------
// REST 路径与请求
// ---------------------------------------------------------------------------

/** 构造 K8s REST 路径：core 组走 /api/{v}，其余走 /apis/{group}/{v} */
export function apiPath({ group = '', version = 'v1', plural, namespace, name, sub }) {
  for (const value of [group || 'core', version, plural, ...(sub ? [sub] : [])]) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) || value === '..') {
      throw new KubeError(400, '无效的资源路径')
    }
  }
  for (const value of [namespace, name].filter(v => v !== undefined && v !== null && v !== '')) {
    if (typeof value !== 'string' || value === '.' || value === '..' || /[/\\%\s?#\x00-\x1f]/.test(value)) throw new KubeError(400, '无效的资源路径名称')
  }
  const core = !group || group === '_core'
  let p = core ? `/api/${version}` : `/apis/${group}/${version}`
  if (namespace && namespace !== '_all') {
    p += `/namespaces/${encodeURIComponent(namespace)}`
  }
  p += `/${plural}`
  if (name) p += `/${encodeURIComponent(name)}`
  if (sub) p += `/${sub}`
  return p
}

function queryString(query) {
  if (!query) return ''
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    usp.append(k, String(v))
  }
  const s = usp.toString()
  return s ? `?${s}` : ''
}

/** 组装带认证信息的 https.RequestOptions（复用 client-node 的认证链） */
async function buildOptions(c, method, pathWithQuery, headers = {}, timeout) {
  const opts = {
    method,
    hostname: c.baseURL.hostname,
    port: c.baseURL.port || (c.baseURL.protocol === 'https:' ? 443 : 80),
    path: (c.baseURL.pathname === '/' ? '' : c.baseURL.pathname.replace(/\/$/, '')) + pathWithQuery,
    headers: { Accept: 'application/json', ...headers },
    // timeout === 0 表示禁用超时（日志 follow 长连接），不能用 || 兜底
    timeout: timeout === 0 ? 0 : (timeout || config.requestTimeoutMs),
  }
  await c.kc.applyToHTTPSOptions(opts)
  return opts
}

function transportFor(c) {
  return c.baseURL.protocol === 'https:' ? https : http
}

/**
 * 普通 REST 请求，返回解析后的 JSON / 文本。
 * 非 2xx 抛 KubeError，message 取自 K8s Status 对象。
 */
export async function kubeRequest(method, pathWithQuery, { body, headers = {}, timeout, clusterId } = {}) {
  const c = getCluster(clusterId)
  // Internal dependency injection for deterministic tests; never populated from imported kubeconfig.
  if (c.request) return c.request(method, pathWithQuery, { body, headers, timeout, clusterId: c.id })
  const payload = body === undefined ? null
    : typeof body === 'string' || Buffer.isBuffer(body) ? body
      : JSON.stringify(body)
  const h = { ...headers }
  if (payload && !h['Content-Type']) h['Content-Type'] = 'application/json'
  if (payload) h['Content-Length'] = Buffer.byteLength(payload)
  const opts = await buildOptions(c, method, pathWithQuery, h, timeout)

  return new Promise((resolve, reject) => {
    const req = transportFor(c).request(opts, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let parsed = raw
        try { parsed = raw ? JSON.parse(raw) : null } catch (e) { /* 保留文本 */ }
        if (res.statusCode >= 400) {
          const msg = parsed?.message || (typeof parsed === 'string' ? parsed.slice(0, 300) : `API Server 返回 ${res.statusCode}`)
          return reject(new KubeError(res.statusCode, msg, parsed))
        }
        resolve({ status: res.statusCode, data: parsed })
      })
    })
    req.on('timeout', () => req.destroy(new Error(`请求 API Server 超时 (${opts.timeout}ms)`)))
    req.on('error', err => reject(new KubeError(502, `连接 API Server 失败：${err.message}`)))
    if (payload) req.write(payload)
    req.end()
  })
}

/** 流式 REST 请求，返回 IncomingMessage（用于日志 follow / 大响应） */
export async function kubeStream(method, pathWithQuery, { headers = {}, timeout, clusterId } = {}) {
  const c = getCluster(clusterId)
  const opts = await buildOptions(c, method, pathWithQuery, headers, timeout)
  return new Promise((resolve, reject) => {
    const req = transportFor(c).request(opts, res => {
      if (res.statusCode >= 400) {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          let msg = raw.slice(0, 300)
          try { msg = JSON.parse(raw).message || msg } catch (e) { /* ignore */ }
          reject(new KubeError(res.statusCode, msg))
        })
        return
      }
      resolve(res)
    })
    req.on('error', err => reject(new KubeError(502, `连接 API Server 失败：${err.message}`)))
    req.end()
  })
}

/** 通用资源请求封装，自动拼接路径与查询参数 */
export function resRequest(method, meta, { namespace, name, sub, query, body, headers, timeout, clusterId } = {}) {
  const p = apiPath({ group: meta.group, version: meta.version, plural: meta.plural, namespace, name, sub })
  return kubeRequest(method, p + queryString(query), { body, headers, timeout, clusterId })
}

/** 便捷方法：JSON / merge-patch / apply-patch */
export const KUBE_HEADERS = {
  mergePatch: { 'Content-Type': 'application/merge-patch+json' },
  strategicPatch: { 'Content-Type': 'application/strategic-merge-patch+json' },
  jsonPatch: { 'Content-Type': 'application/json-patch+json' },
  applyYaml: { 'Content-Type': 'application/apply-patch+yaml' },
}

/**
 * API 资源发现：遍历 /api/v1 与所有 /apis/<groupVersion>，
 * 产出前端可用的扁平资源清单（含 CRD 自定义资源）。缓存按集群隔离。
 */
export async function discoverResources(force = false, clusterId) {
  const c = getCluster(clusterId)
  if (!force && c.discoveryCache.data && Date.now() - c.discoveryCache.at < config.discoveryCacheMs) {
    if (!c.discoveryCache.data.length && c.discoveryCache.errors?.length) throw new KubeError(c.discoveryCache.errors[0].status, `资源发现失败：${c.discoveryCache.errors[0].message}`, c.discoveryCache.errors)
    return c.discoveryCache.data
  }

  const gvList = [{ group: '', version: 'v1' }]
  const errors = []
  try {
    const { data } = await kubeRequest('GET', '/apis', { clusterId: c.id })
    for (const g of data.groups || []) {
      const pv = g.preferredVersion
      // APIGroup.preferredVersion 只有 groupVersion/version，组名在 APIGroup.name 上
      const group = g.name || pv?.group || (pv?.groupVersion ? pv.groupVersion.split('/')[0] : '')
      if (!group) continue
      for (const v of g.versions?.length ? g.versions : [pv].filter(Boolean)) {
        if (v.version) gvList.push({ group, version: v.version, preferred: v.version === pv?.version })
      }
    }
  } catch (e) {
    errors.push({ path: '/apis', status: e.status || 502, message: e.message })
  }

  const results = await Promise.all(gvList.map(async ({ group, version, preferred }) => {
    try {
      const p = group ? `/apis/${group}/${version}` : `/api/${version}`
      const { data } = await kubeRequest('GET', p, { timeout: 10000, clusterId: c.id })
      return (data.resources || [])
        .filter(r => !r.name.includes('/')) // 排除 pods/log、deployments/scale 等子资源
        .map(r => ({
          group, version, preferred: preferred !== false, kind: r.kind, plural: r.name,
          namespaced: r.namespaced, verbs: r.verbs || [],
          shortNames: r.shortNames || [], categories: r.categories || [],
          singularName: r.singularName || '',
        }))
    } catch (e) {
      errors.push({ path: group ? `/apis/${group}/${version}` : `/api/${version}`, status: e.status || 502, message: e.message })
      return []
    }
  }))

  const flat = results.flat()
  const seen = new Set()
  const out = []
  for (const r of flat) {
    const key = `${r.group || ''}/${r.version}/${r.plural}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...r, group: r.group || '' })
  }
  out.sort((a, b) => (a.group || '').localeCompare(b.group || '') || a.kind.localeCompare(b.kind))
  c.discoveryCache = { at: Date.now(), data: out, errors }
  if (!out.length && errors.length) throw new KubeError(errors[0].status, `资源发现失败：${errors[0].message}`, errors)
  return out
}

/** 根据 apiVersion + kind 在发现表里找到资源定义，用于 apply */
export async function findResource(apiVersion, kind, clusterId) {
  if (typeof apiVersion !== 'string' || !/^(?:[a-z0-9.-]+\/)?[a-z0-9]+$/.test(apiVersion)) throw new KubeError(400, '无效的 apiVersion')
  const list = await discoverResources(false, clusterId)
  const [group, version] = apiVersion.includes('/')
    ? apiVersion.split('/') : ['', apiVersion]
  const result = list.find(r => r.kind === kind && r.version === version && (r.group || '') === group)
  if (!result) assertDiscovered(group, version, clusterId)
  return result || null
}

function assertDiscovered(group, version, clusterId) {
  const failure = discoveryErrors(clusterId).find(e => e.path === (group ? `/apis/${group}/${version}` : `/api/${version}`) || (group && e.path === '/apis'))
  if (failure) throw new KubeError(failure.status, `无法确认资源类型：${failure.message}`)
}

/** Exact GVR metadata, never trusts URL namespace/scope or silently swaps a version. */
export async function resourceMeta(meta, clusterId) {
  apiPath(meta)
  const group = meta.group === '_core' ? '' : meta.group || ''
  const r = (await discoverResources(false, clusterId)).find(r => r.group === group && r.version === meta.version && r.plural === meta.plural)
  if (!r) { assertDiscovered(group, meta.version, clusterId); throw new KubeError(404, `集群未提供资源 ${group || 'core'}/${meta.version}/${meta.plural}`) }
  return r
}
