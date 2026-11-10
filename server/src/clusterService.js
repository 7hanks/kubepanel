import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { KubeConfig } from '@kubernetes/client-node'
import { config } from './config.js'
import {
  registerCluster, unregisterCluster, listClusters, getCluster,
  kubeRequest, clearDiscoveryCache, discoverResources, KubeError,
  validateKubeconfigText,
} from './kube.js'
import { clusterInfo, overview } from './actions.js'
import { canAccessCluster, resourceAllowed, assertClusterAccess } from './access.js'
import { scopedList } from './resourceScope.js'

const IN_CLUSTER_TOKEN = '/var/run/secrets/kubernetes.io/serviceaccount/token'
const CONFIG_EXT = ['.yaml', '.yml', '.conf', '.kubeconfig']
const CACHE_MS = 15000
let summaryCache = { at: 0, data: null }

function shortHash(str, len = 8) {
  return crypto.createHash('sha1').update(str).digest('hex').slice(0, len)
}
function slug(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'cluster'
}
function authModeOf(kc, mode) {
  const user = kc.getCurrentUser() || {}
  if (mode === 'in-cluster-serviceaccount') return 'ServiceAccount Token'
  if (user.certData || user.certFile) return '客户端证书 (mTLS)'
  if (user.token) return 'Bearer Token'
  if (user.exec || user.authProvider) return '外部凭据插件 (exec / auth-provider)'
  return 'anonymous'
}

/** Public client certificate expiry only; never reads certificate or private-key files. */
export function certificateExpiry(user, now = Date.now(), parse = bytes => new crypto.X509Certificate(bytes)) {
  const unknown = { notAfter: null, daysRemaining: null, status: 'unknown' }
  if (typeof user?.certData !== 'string' || !user.certData) return unknown
  try {
    const certificate = parse(Buffer.from(user.certData, 'base64'))
    const expiresAt = Date.parse(certificate.validTo)
    const remaining = expiresAt - Number(now)
    if (!Number.isFinite(remaining)) return unknown
    const day = 24 * 60 * 60 * 1000
    return {
      notAfter: new Date(expiresAt).toISOString(),
      daysRemaining: Math.floor(remaining / day),
      status: remaining <= 0 ? 'expired' : remaining <= 30 * day ? 'expiring' : 'valid',
    }
  } catch { return unknown }
}

/** 把一个 kubeconfig 文本展开成多个 {context, kc}，每个 context 一个独立客户端 */
function contextsFrom(content, mode = 'kubeconfig-file') {
  validateKubeconfigText(content)
  const base = new KubeConfig()
  base.loadFromString(content)
  const contexts = base.getContexts()
  if (!contexts.length) throw new Error('kubeconfig 中没有 context')
  return contexts.map(ctx => {
    const kc = new KubeConfig()
    kc.loadFromString(content)
    kc.setCurrentContext(ctx.name)
    return { context: ctx.name, kc, mode, authMode: authModeOf(kc, mode) }
  })
}

function safeRegister(entry) {
  try { registerCluster(entry); return true } catch (e) { console.error(`[KubePanel] 跳过集群 ${entry.name}：${e.message}`); return false }
}

/**
 * 启动时构建集群注册表。来源优先级：
 * 1) 可写目录 KUBE_CLUSTERS_DIR 下的所有 kubeconfig（推荐，支持界面添加）
 * 2) 显式 KUBECONFIG 文件（兼容旧部署方式）
 * 3) KUBE_CONFIG_B64 环境变量
 * 4) in-cluster ServiceAccount
 * 5) 都没有时回退到本机默认 kubeconfig（方便本地开发）
 */
export function initClusters() {
  const seen = new Set()
  let count = 0
  const warnings = []

  const addFromContent = (content, { source, mode, baseName, file, removable }) => {
    let contexts
    try { contexts = contextsFrom(content, mode) } catch (e) { warnings.push(`${source}: ${e.message}`); return }
    for (const { context, kc, authMode } of contexts) {
      const id = `c-${shortHash(`${source}|${context}`)}`
      if (seen.has(id)) continue
      seen.add(id)
      const name = contexts.length > 1 ? `${baseName} / ${context.split('@')[0]}` : baseName
      if (safeRegister({ id, name, kc, source, mode, authMode, file, removable, context })) count++
    }
  }

  // 1) 扫描集群目录
  const dir = config.clustersDir
  if (dir && fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter(f => CONFIG_EXT.includes(path.extname(f).toLowerCase())).sort()
    for (const f of files) {
      const full = path.join(dir, f)
      try {
        const content = fs.readFileSync(full, 'utf8')
        addFromContent(content, {
          source: `file:${f}`, mode: 'kubeconfig-file', baseName: f.replace(/\.[^.]+$/, ''),
          file: full, removable: true,
        })
      } catch (e) { warnings.push(`${f}: ${e.message}`) }
    }
  }

  // 2) 显式 KUBECONFIG（避免与目录重复）
  if (config.kubeconfigPath && fs.existsSync(config.kubeconfigPath)) {
    const inDir = dir && path.resolve(config.kubeconfigPath).startsWith(path.resolve(dir) + path.sep)
    if (!inDir) {
      try {
        const content = fs.readFileSync(config.kubeconfigPath, 'utf8')
        addFromContent(content, {
          source: `env:${path.basename(config.kubeconfigPath)}`, mode: 'kubeconfig-file',
          baseName: path.basename(config.kubeconfigPath).replace(/\.[^.]+$/, ''), removable: false,
        })
      } catch (e) { warnings.push(`KUBECONFIG: ${e.message}`) }
    }
  }

  // 3) base64 注入
  if (config.kubeConfigB64) {
    try {
      const content = Buffer.from(config.kubeConfigB64, 'base64').toString('utf8')
      addFromContent(content, { source: 'env:KUBE_CONFIG_B64', mode: 'kubeconfig-env-base64', baseName: 'env-cluster', removable: false })
    } catch (e) { warnings.push(`KUBE_CONFIG_B64: ${e.message}`) }
  }

  // 4) in-cluster ServiceAccount
  if (fs.existsSync(IN_CLUSTER_TOKEN)) {
    try {
      const kc = new KubeConfig()
      kc.loadFromCluster()
      if (safeRegister({
        id: 'in-cluster', name: '当前集群 (in-cluster)', kc,
        source: 'serviceaccount', mode: 'in-cluster-serviceaccount',
        authMode: authModeOf(kc, 'in-cluster-serviceaccount'), removable: false,
      })) count++
    } catch (e) { warnings.push(`in-cluster: ${e.message}`) }
  }

  // 5) 本地开发兜底
  if (count === 0) {
    try {
      const file = path.join(os.homedir(), '.kube', 'config')
      if (fs.existsSync(file)) addFromContent(fs.readFileSync(file, 'utf8'), {
        source: 'default-kubeconfig', mode: 'default-kubeconfig', baseName: '本地默认集群', file, removable: false,
      })
    } catch (e) { warnings.push(`default: ${e.message}`) }
  }

  summaryCache = { at: 0, data: null }
  return { count, warnings }
}

/** 集群列表页数据：并发探测每个集群的版本 / 节点数 / 命名空间数 */
export async function clusterSummaries(force = false, account) {
  if (!account && !force && summaryCache.data && Date.now() - summaryCache.at < CACHE_MS) return summaryCache.data
  const rows = await Promise.all(listClusters().filter(c => !account || canAccessCluster(account, c.id)).map(async c => {
    const base = {
      id: c.id, name: c.name, server: c.server, context: c.context,
      authMode: c.authMode, source: c.source, mode: c.mode, removable: c.removable,
      credentialExpiry: certificateExpiry(c.kc.getCurrentUser()),
      healthy: false, version: 'unknown', nodes: null, namespaces: null, error: '',
    }
    try {
      const [v, n, ns] = await Promise.all([
        kubeRequest('GET', '/version', { timeout: 5000, clusterId: c.id }),
        scopedList(account, { group: '', version: 'v1', plural: 'nodes', namespaced: false }, { clusterId: c.id, timeout: 5000 }).then(data => ({ data })).catch(() => null),
        scopedList(account, { group: '', version: 'v1', plural: 'namespaces', namespaced: false }, { clusterId: c.id, timeout: 5000 }).then(data => ({ data })).catch(() => null),
      ])
      base.healthy = true
      base.version = v.data?.gitVersion || 'unknown'
      base.nodes = n?.data?.items?.length ?? null
      base.namespaces = ns?.data?.items?.length ?? null
      base.platform = v.data?.platform || '-'
    } catch (e) { base.error = e.message }
    return base
  }))
  rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  if (!account) summaryCache = { at: Date.now(), data: rows }
  return rows
}

function ensureWritableDir() {
  const dir = config.clustersDir
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }) }
    catch (e) { throw new KubeError(400, `集群目录不可写：${e.message}。请把宿主机目录以可写方式挂载到 ${dir}`) }
  }
  try { fs.accessSync(dir, fs.constants.W_OK) }
  catch (e) { throw new KubeError(400, `集群目录只读，无法添加集群：${dir}。请用 -v <目录>:${dir}（去掉 :ro）重新运行容器`) }
  return dir
}

/** 界面添加集群：校验 kubeconfig → 落盘 → 注册。只接受单/多 context 的标准 kubeconfig */
export function addCluster(name, kubeconfigText) {
  const cleanName = String(name || '').trim()
  if (!cleanName) throw new KubeError(400, '请填写集群名称')
  if (!kubeconfigText || typeof kubeconfigText !== 'string' || kubeconfigText.length < 20) {
    throw new KubeError(400, '请粘贴完整的 kubeconfig 内容')
  }
  // 先校验再写盘，避免写入非法文件
  let contexts
  try { contexts = contextsFrom(kubeconfigText) } catch (e) { throw new KubeError(400, `kubeconfig 无效：${e.message}`) }
  for (const { kc } of contexts) {
    if (!kc.getCurrentCluster()?.server) throw new KubeError(400, 'kubeconfig 缺少 API Server 地址')
  }

  const dir = ensureWritableDir()
  const id = `c-${slug(cleanName)}-${shortHash(cleanName + Date.now(), 6)}`
  const file = path.join(dir, `${id}.yaml`)
  try { fs.writeFileSync(file, kubeconfigText, { mode: 0o600 }) }
  catch (e) { throw new KubeError(400, `写入 kubeconfig 失败：${e.message}`) }

  let added = 0
  const ids = []
  contexts.forEach(({ context, kc, authMode }) => {
    // Same derivation as startup: adding a cluster must not change its scope identity on restart.
    const cid = `c-${shortHash(`file:${path.basename(file)}|${context}`)}`
    ids.push(cid)
    if (safeRegister({
      id: cid, name: contexts.length > 1 ? `${cleanName} / ${context.split('@')[0]}` : cleanName,
      kc, source: `file:${path.basename(file)}`, mode: 'kubeconfig-file', authMode,
      file, removable: true, context,
    })) added++
  })
  summaryCache = { at: 0, data: null }
  return { added, ids }
}

/** 删除集群：移除 kubeconfig 文件并注销同源的全部 context */
export function removeCluster(id, account) {
  const c = getCluster(id)
  if (!c.removable) throw new KubeError(400, '该集群来自环境变量 / ServiceAccount / 只读挂载，不能在界面删除')
  const file = c.file
  const sameFile = listClusters().filter(x => x.file === file).map(x => x.id)
  if (account) for (const cid of sameFile) assertClusterAccess(account, cid)
  if (file && fs.existsSync(file)) {
    try { fs.unlinkSync(file) } catch (e) { throw new KubeError(400, `删除凭据文件失败：${e.message}`) }
  }
  for (const cid of sameFile) { unregisterCluster(cid); try { clearDiscoveryCache(cid) } catch (e) { /* 已注销 */ } }
  summaryCache = { at: 0, data: null }
  return { removed: sameFile }
}

export async function testCluster(id) {
  const c = getCluster(id)
  try {
    const r = await kubeRequest('GET', '/version', { timeout: 6000, clusterId: c.id })
    return { ok: true, version: r.data?.gitVersion, server: c.server }
  } catch (e) { return { ok: false, message: e.message } }
}

/**
 * 集群详情：聚合基本信息、版本、命名空间、资源统计、节点状态、近期事件与 API 组分布。
 * 这是平台级接口，不需要（也不改变）当前选中的 clusterId。
 */
export async function clusterDetail(id, account) {
  const c = getCluster(id)
  const [info, ov, disc] = await Promise.all([
    clusterInfo(c.id, account),
    overview(c.id, undefined, account),
    discoverResources(false, c.id).catch(() => null),
  ])

  return {
    id: c.id,
    name: c.name,
    server: c.server,
    context: c.context,
    authMode: c.authMode,
    credentialExpiry: certificateExpiry(c.kc.getCurrentUser()),
    source: c.source,
    mode: c.mode,
    removable: c.removable,
    version: info.version,
    platform: info.platform,
    resourceTypes: disc ? disc.filter(r => !account || resourceAllowed(account, r)).length : null,
    namespaces: info.namespaces,
    stat: ov.stat,
    nodes: ov.nodes,
    events: ov.events,
    podPhases: ov.podPhases,
    metricsAvailable: ov.metricsAvailable,
    partial: ov.partial,
    errors: ov.errors,
  }
}
