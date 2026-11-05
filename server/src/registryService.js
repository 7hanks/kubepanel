import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { config } from './config.js'
import { kubeRequest, KubeError } from './kube.js'

/**
 * 镜像仓库（Harbor）对接。
 *
 * - 配置落盘在 DATA_DIR/registries.json，密码只保存在服务端，接口返回时打码
 * - 后端代理 Harbor API v2.0，避免浏览器直连的 CORS / 自签证书 / 凭据外泄问题
 * - 支持从当前集群「自动发现」Harbor：扫描命名空间里的 Service + NodePort
 */

const FILE = path.join(config.dataDir, 'registries.json')
const healthCache = new Map()   // id -> { at, ok, version, message }

function readAll() {
  try {
    const list = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return Array.isArray(list) ? list : []
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[KubePanel] 镜像仓库配置不可用：${e.message}`)
    return []
  }
}

function writeAll(list) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
  const tmp = `${FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, FILE)
  try { fs.chmodSync(FILE, 0o600) } catch (e) { /* ignore */ }
}

function maskPassword(pwd) {
  if (!pwd) return ''
  return '••••••••'
}

function publicView(r) {
  return {
    id: r.id,
    name: r.name,
    type: r.type || 'harbor',
    url: r.url,
    host: hostOf(r.url),
    username: r.username || '',
    hasPassword: !!r.password,
    insecure: r.insecure !== false,
    createdAt: r.createdAt,
    health: healthCache.get(r.id) || null,
  }
}

export function hostOf(url) {
  try { return new URL(url).host } catch (e) { return String(url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '') }
}

function normalizeUrl(url) {
  let u = String(url || '').trim()
  if (!u) throw new KubeError(400, '请填写仓库地址')
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  return u.replace(/\/+$/, '')
}

/** 通用 Harbor 请求：自签证书场景可关闭校验 */
function harborRequest(cfg, reqPath, { method = 'GET', timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const base = new URL(cfg.url)
    const isHttps = base.protocol === 'https:'
    const mod = isHttps ? https : http
    const headers = { Accept: 'application/json', 'User-Agent': 'KubePanel' }
    if (cfg.username) {
      headers.Authorization = 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password || ''}`).toString('base64')
    }
    const req = mod.request({
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port || (isHttps ? 443 : 80),
      path: reqPath,
      method,
      headers,
      // NodePort + IP 访问时证书通常不匹配，默认放开校验（可在界面关闭）
      rejectUnauthorized: cfg.insecure === false,
      timeout,
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode === 401 || res.statusCode === 403) {
          return reject(new KubeError(401, `仓库拒绝访问（${res.statusCode}）：请填写有权限的账号密码`))
        }
        if (res.statusCode >= 400) {
          return reject(new KubeError(res.statusCode, `Harbor 返回 ${res.statusCode}：${body.slice(0, 200)}`))
        }
        try { resolve({ status: res.statusCode, data: JSON.parse(body), headers: res.headers }) }
        catch (e) { resolve({ status: res.statusCode, data: body, headers: res.headers }) }
      })
    })
    req.on('error', e => reject(new KubeError(502, `连接仓库失败：${e.code || e.message}`)))
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.end()
  })
}

export function listRegistries() {
  return readAll().map(publicView)
}

export function getRegistry(id) {
  const r = readAll().find(x => x.id === id)
  if (!r) throw new KubeError(404, '镜像仓库不存在，请刷新列表')
  return r
}

export async function addRegistry({ name, url, username, password, insecure }) {
  const finalUrl = normalizeUrl(url)
  const list = readAll()
  if (list.some(r => r.url === finalUrl)) throw new KubeError(400, '该地址已经添加过了')
  const rec = {
    id: 'r-' + crypto.randomBytes(5).toString('hex'),
    name: String(name || hostOf(finalUrl)).trim() || hostOf(finalUrl),
    type: 'harbor',
    url: finalUrl,
    username: String(username || '').trim(),
    password: String(password || ''),
    insecure: insecure !== false,
    createdAt: new Date().toISOString(),
  }
  list.push(rec)
  writeAll(list)
  return publicView(rec)
}

export async function updateRegistry(id, patch = {}) {
  const list = readAll()
  const i = list.findIndex(r => r.id === id)
  if (i < 0) throw new KubeError(404, '镜像仓库不存在')
  const cur = list[i]
  const next = {
    ...cur,
    name: patch.name !== undefined ? String(patch.name).trim() || cur.name : cur.name,
    url: patch.url !== undefined ? normalizeUrl(patch.url) : cur.url,
    username: patch.username !== undefined ? String(patch.username).trim() : cur.username,
    insecure: patch.insecure !== undefined ? !!patch.insecure : cur.insecure,
  }
  // 密码留空表示「不修改」
  if (patch.password) next.password = String(patch.password)
  if (patch.clearPassword) next.password = ''
  list[i] = next
  writeAll(list)
  healthCache.delete(id)
  return publicView(next)
}

export function removeRegistry(id) {
  const list = readAll()
  const next = list.filter(r => r.id !== id)
  if (next.length === list.length) throw new KubeError(404, '镜像仓库不存在')
  writeAll(next)
  healthCache.delete(id)
  return { ok: true, removed: id }
}

export async function testRegistry(id) {
  const rec = getRegistry(id)
  const started = Date.now()
  try {
    await harborRequest(rec, '/api/v2.0/ping')
    const info = await harborRequest(rec, '/api/v2.0/systeminfo').catch(() => ({ data: {} }))
    const version = info?.data?.harbor_version || info?.data?.registry_url || ''
    const health = { at: Date.now(), ok: true, ms: Date.now() - started, version, message: '连接正常' }
    healthCache.set(id, health)
    return { ok: true, ...health, host: hostOf(rec.url) }
  } catch (e) {
    const health = { at: Date.now(), ok: false, ms: Date.now() - started, message: e.message }
    healthCache.set(id, health)
    return { ok: false, ...health }
  }
}

export async function listProjects(id) {
  const rec = getRegistry(id)
  const { data } = await harborRequest(rec, '/api/v2.0/projects?page=1&page_size=100&with_detail=true')
  const items = Array.isArray(data) ? data : []
  return items.map(p => ({
    name: p.name,
    repoCount: p.repo_count ?? 0,
    public: !!p.public,
    createdAt: p.creation_time,
    updatedAt: p.update_time,
    pullCount: p.pull_count ?? 0,
  }))
}

/** Harbor 的仓库名是 project/repo，调用 artifacts 时需要去掉 project 前缀 */
export async function listRepositories(id, project) {
  const rec = getRegistry(id)
  if (!project) throw new KubeError(400, '缺少 project 参数')
  const { data } = await harborRequest(rec,
    `/api/v2.0/projects/${encodeURIComponent(project)}/repositories?page=1&page_size=100`)
  const items = Array.isArray(data) ? data : []
  return items.map(r => {
    const full = r.name || ''
    const short = full.startsWith(`${project}/`) ? full.slice(project.length + 1) : full
    return {
      name: full,
      shortName: short,
      artifactCount: r.artifact_count ?? 0,
      pullCount: r.pull_count ?? 0,
      updatedAt: r.update_time,
      pullRef: `${hostOf(rec.url)}/${full}`,
    }
  })
}

export async function listArtifacts(id, project, repository) {
  const rec = getRegistry(id)
  if (!project || !repository) throw new KubeError(400, '缺少 project / repository 参数')
  const short = repository.startsWith(`${project}/`) ? repository.slice(project.length + 1) : repository
  const { data } = await harborRequest(rec,
    `/api/v2.0/projects/${encodeURIComponent(project)}/repositories/${encodeURIComponent(short)}/artifacts?page=1&page_size=50&with_tag=true&with_label=false&with_scan_overview=false`)
  const items = Array.isArray(data) ? data : []
  const host = hostOf(rec.url)
  return items.map(a => ({
    digest: a.digest,
    shortDigest: String(a.digest || '').replace('sha256:', '').slice(0, 12),
    tags: (a.tags || []).map(t => t.name),
    size: a.size ?? 0,
    type: a.type || 'IMAGE',
    pushTime: a.push_time,
    pullRefs: (a.tags || []).length
      ? a.tags.map(t => `${host}/${project}/${short}:${t.name}`)
      : [`${host}/${project}/${short}@${a.digest}`],
  }))
}

/**
 * 从集群里自动发现 Harbor：找命名空间里带 NodePort 的 Service，
 * 用「节点 IP + nodePort」拼出可访问地址（优先 https 端口）。
 */
export async function discoverRegistries(clusterId, namespace = 'harbor') {
  const out = []
  let services = []
  try {
    const r = await kubeRequest('GET', '/api/v1/services', { clusterId, query: namespace ? { namespace } : {} })
    services = r.data.items || []
  } catch (e) {
    // 指定命名空间不存在时退回全集群扫描
    const r = await kubeRequest('GET', '/api/v1/services', { clusterId })
    services = r.data.items || []
  }
  let nodeIp = ''
  try {
    const nodes = await kubeRequest('GET', '/api/v1/nodes', { clusterId })
    const addrs = nodes.data.items?.[0]?.status?.addresses || []
    nodeIp = (addrs.find(a => a.type === 'InternalIP') || addrs[0] || {}).address || ''
  } catch (e) { /* 没有节点读权限时留空 */ }

  for (const s of services) {
    const ports = s.spec?.ports || []
    const nodePorts = ports.filter(p => p.nodePort)
    if (!nodePorts.length) continue
    const name = s.metadata?.name || ''
    for (const p of nodePorts) {
      const scheme = p.port === 443 || p.name === 'https' ? 'https' : 'http'
      if (!nodeIp) continue
      out.push({
        name: `${s.metadata?.namespace || ''}/${name}`,
        namespace: s.metadata?.namespace || '',
        service: name,
        url: `${scheme}://${nodeIp}:${p.nodePort}`,
        nodePort: p.nodePort,
        port: p.port,
        scheme,
        likelyHarbor: /harbor/i.test(name) || /harbor/i.test(s.metadata?.namespace || ''),
      })
    }
  }
  // https 优先、harbor 命名优先
  out.sort((a, b) => (b.likelyHarbor - a.likelyHarbor) || (b.scheme === 'https') - (a.scheme === 'https'))
  return out
}
