import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { config } from './config.js'
import { sealSecret, openSecret } from './secretStore.js'
import { KubeError } from './kube.js'
import { scopedList } from './resourceScope.js'

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
    if (!Array.isArray(list)) throw new Error('expected array')
    return list.map(record => ({ ...record, password: openSecret(record.password) }))
  } catch (e) {
    if (e.code === 'ENOENT') return []
    throw new KubeError(503, '镜像仓库配置读取失败或损坏，请恢复备份')
  }
}

function writeAll(list) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
  const tmp = `${FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(list.map(record => ({ ...record, password: sealSecret(record.password) })), null, 2), { mode: 0o600 })
  fs.renameSync(tmp, FILE)
  try { fs.chmodSync(FILE, 0o600) } catch (e) { /* ignore */ }
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
    insecure: r.insecure === true,
    hasCa: !!r.ca,
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
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = `https://${u}`
  let parsed
  try { parsed = new URL(u) } catch { throw new KubeError(400, '仓库地址不合法') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new KubeError(400, '仓库地址不合法')
  return parsed.toString().replace(/\/+$/, '')
}

export function registryTlsOptions(cfg = {}) {
  return { rejectUnauthorized: cfg.insecure !== true, ...(cfg.ca ? { ca: String(cfg.ca) } : {}) }
}

/** 通用 Harbor 请求：只接受预期的 API 响应，同源重定向最多跟随 3 次。 */
function harborRequest(cfg, reqPath, { method = 'GET', timeout = 12000, response = 'json' } = {}, redirects = 0, target) {
  return new Promise((resolve, reject) => {
    const base = new URL(cfg.url)
    const url = target || new URL(base.pathname.replace(/\/$/, '') + reqPath, base.origin)
    const isHttps = url.protocol === 'https:'
    const mod = isHttps ? https : http
    const headers = { Accept: 'application/json', 'User-Agent': 'KubePanel' }
    if (cfg.username) {
      headers.Authorization = 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password || ''}`).toString('base64')
    }
    const req = mod.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers,
      ...registryTlsOptions(cfg),
      timeout,
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          let next
          try { next = new URL(res.headers.location, url) } catch { /* rejected below */ }
          if (!res.headers.location || !next || !['http:', 'https:'].includes(next.protocol) || next.username || next.password) {
            return reject(new KubeError(502, 'Harbor 返回了无效的重定向地址，请检查仓库地址'))
          }
          // 不把 Basic 凭据转发给另一个 origin，也不允许 HTTPS 降级。
          if (next.origin !== base.origin) {
            return reject(new KubeError(502, `仓库地址重定向至 ${next.origin}，请使用正确的 Harbor HTTPS / NodePort 地址`))
          }
          if (redirects >= 3) return reject(new KubeError(502, 'Harbor 地址重定向次数过多，请检查仓库地址'))
          return resolve(harborRequest(cfg, reqPath, { method, timeout, response }, redirects + 1, next))
        }
        if (res.statusCode === 401) {
          return reject(new KubeError(401, 'Harbor 账号密码认证失败（401），请检查账号、密码或机器人密钥', { source: 'harbor', upstreamStatus: 401 }))
        }
        if (res.statusCode === 403) {
          return reject(new KubeError(403, 'Harbor 拒绝访问（403），请检查账号的项目和仓库权限', { source: 'harbor', upstreamStatus: 403 }))
        }
        if (res.statusCode >= 400) {
          return reject(new KubeError(res.statusCode, `Harbor 返回 ${res.statusCode}，请检查仓库地址及访问权限`))
        }
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new KubeError(502, `Harbor 返回了异常响应（${res.statusCode}）`))
        if (/\btext\/html\b/i.test(res.headers['content-type'] || '') || /^\s*</.test(body)) {
          return reject(new KubeError(502, '仓库返回了 HTML 页面，未收到 Harbor API 响应，请检查 HTTPS / NodePort 地址和反向代理配置'))
        }
        if (response === 'ping') {
          if (!/^pong$/i.test(body.trim())) return reject(new KubeError(502, 'Harbor ping 响应不合法，请检查仓库地址'))
          return resolve({ status: res.statusCode, data: body.trim(), headers: res.headers })
        }
        try { resolve({ status: res.statusCode, data: JSON.parse(body), headers: res.headers }) }
        catch (e) { reject(new KubeError(502, 'Harbor 返回的 API 响应不是有效 JSON，请检查仓库地址和反向代理配置')) }
      })
    })
    req.on('error', e => reject(new KubeError(502, `连接仓库失败：${e.code || e.message}`)))
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.end()
  })
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function verifyHarborAuthentication(rec) {
  if (!rec.username) return false
  // /ping、/systeminfo 和公开项目列表均不能证明 Basic 凭据有效。
  // 此接口要求已认证，且适用于普通用户及 /users/current 不支持的 robot。
  const { data } = await harborRequest(rec, '/api/v2.0/users/current/permissions')
  // Harbor 的空权限切片可能序列化为 null。
  if (data !== null && (!Array.isArray(data) || !data.every(p => isObject(p) && typeof p.resource === 'string' && typeof p.action === 'string'))) {
    throw new KubeError(502, 'Harbor 认证接口响应不合法，无法验证账号密码，请检查仓库地址')
  }
  return true
}

async function harborList(rec, reqPath) {
  await verifyHarborAuthentication(rec)
  const result = await harborRequest(rec, reqPath)
  if (!Array.isArray(result.data) || !result.data.every(isObject)) {
    throw new KubeError(502, 'Harbor 列表响应格式不合法，预期为 JSON 数组，请检查仓库地址和反向代理配置')
  }
  return result
}

export function listRegistries() {
  return readAll().map(publicView)
}

export function getRegistry(id) {
  const r = readAll().find(x => x.id === id)
  if (!r) throw new KubeError(404, '镜像仓库不存在，请刷新列表')
  return r
}

export async function addRegistry({ name, url, username, password, insecure, ca }) {
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
    insecure: insecure === true,
    ca: String(ca || ''),
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
    insecure: patch.insecure !== undefined ? patch.insecure === true : cur.insecure === true,
    ca: patch.ca !== undefined ? String(patch.ca || '') : cur.ca || '',
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
  const authMode = rec.username ? 'basic' : 'anonymous'
  let authenticated = false
  try {
    authenticated = await verifyHarborAuthentication(rec)
    await harborRequest(rec, '/api/v2.0/ping', { response: 'ping' })
    const info = await harborRequest(rec, '/api/v2.0/systeminfo')
    if (!isObject(info.data) || !(typeof info.data.harbor_version === 'string' || typeof info.data.registry_url === 'string')) {
      throw new KubeError(502, 'Harbor 系统信息响应不合法，请检查仓库地址')
    }
    const version = info.data.harbor_version || info.data.registry_url || ''
    const health = { at: Date.now(), ok: true, ms: Date.now() - started, version, authMode, authenticated, message: authenticated ? '连接正常，账号认证通过' : '匿名连接正常，仅可访问公开项目' }
    healthCache.set(id, health)
    return { ok: true, ...health, host: hostOf(rec.url) }
  } catch (e) {
    const health = { at: Date.now(), ok: false, ms: Date.now() - started, authMode, authenticated, message: e.message }
    healthCache.set(id, health)
    return { ok: false, ...health }
  }
}

function pagination(options, defaultSize = 100) {
  const page = Number(options?.page ?? 1)
  const pageSize = Number(options?.pageSize ?? defaultSize)
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new KubeError(400, '分页参数不合法')
  return { page, pageSize, query: 'page=' + page + '&page_size=' + pageSize }
}
function pageResult(items, headers, options, paging) {
  if (options === undefined) return items
  const count = Number(headers['x-total-count'])
  return { items, total: Number.isSafeInteger(count) && count >= 0 ? count : null, page: paging.page, pageSize: paging.pageSize }
}
export async function listProjects(id, options) {
  const rec = getRegistry(id)
  const paging = pagination(options)
  const { data: items, headers } = await harborList(rec, `/api/v2.0/projects?${paging.query}&with_detail=true`)
  return pageResult(items.map(p => ({
    name: p.name,
    repoCount: p.repo_count ?? 0,
    public: [true, 'true'].includes(p.metadata?.public ?? p.public),
    createdAt: p.creation_time,
    updatedAt: p.update_time,
    pullCount: p.pull_count ?? 0,
  })), headers, options, paging)
}

/** Harbor 的仓库名是 project/repo，调用 artifacts 时需要去掉 project 前缀 */
export async function listRepositories(id, project, options) {
  const rec = getRegistry(id)
  if (!project) throw new KubeError(400, '缺少 project 参数')
  const paging = pagination(options)
  const { data: items, headers } = await harborList(rec,
    `/api/v2.0/projects/${encodeURIComponent(project)}/repositories?${paging.query}`)
  return pageResult(items.map(r => {
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
  }), headers, options, paging)
}

export async function listArtifacts(id, project, repository, options) {
  const rec = getRegistry(id)
  if (!project || !repository) throw new KubeError(400, '缺少 project / repository 参数')
  const short = repository.startsWith(`${project}/`) ? repository.slice(project.length + 1) : repository
  const paging = pagination(options, 50)
  const { data: items, headers } = await harborList(rec,
    `/api/v2.0/projects/${encodeURIComponent(project)}/repositories/${encodeURIComponent(encodeURIComponent(short))}/artifacts?${paging.query}&with_tag=true&with_label=false&with_scan_overview=false`)
  const host = hostOf(rec.url)
  return pageResult(items.map(a => ({
    digest: a.digest,
    shortDigest: String(a.digest || '').replace('sha256:', '').slice(0, 12),
    tags: (a.tags || []).map(t => t.name),
    size: a.size ?? 0,
    type: a.type || 'IMAGE',
    pushTime: a.push_time,
    pullRefs: (a.tags || []).length
      ? a.tags.map(t => `${host}/${project}/${short}:${t.name}`)
      : [`${host}/${project}/${short}@${a.digest}`],
  })), headers, options, paging)
}

/**
 * 从集群里自动发现 Harbor：找命名空间里带 NodePort 的 Service，
 * 用「节点 IP + nodePort」拼出可访问地址（优先 https 端口）。
 */
export async function discoverRegistries(clusterId, namespace = 'harbor', { account } = {}) {
  const out = []
  const response = await scopedList(account, { group: '', version: 'v1', plural: 'services', namespaced: true }, { clusterId, namespace })
  const services = response.items || []
  let nodeIp = ''
  try {
    const nodes = await scopedList(account, { group: '', version: 'v1', plural: 'nodes', namespaced: false }, { clusterId })
    const addrs = nodes.items?.[0]?.status?.addresses || []
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
