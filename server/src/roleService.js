import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { PERMISSIONS, SUPER_ROLE, normalizePermissions } from './permissions.js'
import { normalizeScope } from './access.js'

/**
 * 角色的持久化与 CRUD。
 *
 * 角色是管理员在界面上创建的数据（对象 × 动作的勾选组合），落在数据目录的 roles.json。
 * 首次启动时写入 5 个预置角色作为起点，之后可以随意改名、改权限、删除（有账号在用时不允许删）。
 * 环境变量里的 admin 是内置超级管理员，不在这个文件里。
 */

const FILE = path.join(config.dataDir, 'roles.json')
const NAME_MAX = 32
const DESC_MAX = 128

/** 预置角色：只在 roles.json 不存在时写入一次 */
const PRESET_ROLES = [
  {
    id: 'common',
    name: '普通用户',
    description: '只拥有集群对象的访问权限',
    permissions: ['cluster:list', 'cluster:detail', 'pod:logs'],
  },
  {
    id: 'cluster-admin',
    name: '集群管理员',
    description: '拥有集群对象的所有权限',
    permissions: ['cluster:list', 'cluster:detail', 'cluster:create', 'cluster:update', 'cluster:delete', 'pod:logs', 'pod:exec', 'node:maintain'],
  },
  {
    id: 'registry-admin',
    name: '镜像仓库管理员',
    description: '拥有镜像仓库对象的所有权限',
    permissions: ['registry:list', 'registry:detail', 'registry:create', 'registry:update', 'registry:delete'],
  },
  {
    id: 'rbac-admin',
    name: '角色与用户管理员',
    description: '拥有用户管理对象的所有权限',
    permissions: ['user:list', 'user:detail', 'user:create', 'user:update', 'user:delete'],
  },
  {
    id: 'readonly',
    name: '只读用户',
    description: '拥有所有对象的访问权限（只读）',
    permissions: PERMISSIONS.filter(p => p.action === 'list' || p.action === 'detail').map(p => p.key),
  },
]

function nowIso() {
  return new Date().toISOString()
}

function readFile() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8')
    const doc = JSON.parse(raw)
    if (Array.isArray(doc?.roles)) return doc.roles
    throw new Error('角色数据格式错误')
  } catch (e) {
    if (e.code !== 'ENOENT') throw Object.assign(new Error('角色数据无法读取，已停止自动初始化；请从备份恢复'), {status:503})
  }
  return null
}

function writeFile(roles) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
  const tmp = `${FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ roles }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, FILE)
  try { fs.chmodSync(FILE, 0o600) } catch (e) { /* 非 POSIX 文件系统忽略 */ }
}

/** 首次使用时写入预置角色 */
function seed() {
  const t = nowIso()
  const roles = PRESET_ROLES.map(r => ({ ...r, builtin: true, createdAt: t, updatedAt: t }))
  writeFile(roles)
  console.log(`[KubePanel] 已初始化 ${roles.length} 个预置角色（${FILE}）`)
  return roles
}

function readStore() {
  const roles = readFile()
  if (roles) return roles
  return seed()
}

function publicRole(rec) {
  return {
    id: rec.id,
    name: rec.name,
    description: rec.description || '',
    permissions: normalizePermissions(rec.permissions),
    scope: normalizeScope(rec.scope),
    builtin: !!rec.builtin,
    createdAt: rec.createdAt || null,
    updatedAt: rec.updatedAt || null,
  }
}

export function listRoles() {
  return readStore().map(publicRole)
}

/** 内置查询：给鉴权与用户列表用，未命中返回 null（未知角色 = 零权限） */
export function getRole(roleId) {
  if (!roleId || roleId === SUPER_ROLE.id) return null
  const rec = readStore().find(r => r.id === roleId)
  return rec ? publicRole(rec) : null
}

export function roleName(roleId) {
  if (roleId === SUPER_ROLE.id) return SUPER_ROLE.name
  return getRole(roleId)?.name || String(roleId || '')
}

/** 角色对应的权限码；未知角色返回空数组，避免权限外溢 */
export function permissionsOf(roleId) {
  if (roleId === SUPER_ROLE.id) return ['*']
  return getRole(roleId)?.permissions || []
}

function normalizeName(v) {
  return String(v ?? '').trim().replace(/\s+/g, ' ')
}

function validateName(name, exceptId) {
  if (!name) return '角色名称不能为空'
  if (name.length > NAME_MAX) return `角色名称最多 ${NAME_MAX} 个字符`
  const dup = readStore().find(r => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase())
  if (dup) return `角色「${name}」已存在`
  return ''
}

function validateDescription(v) {
  if (String(v ?? '').length > DESC_MAX) return `角色描述最多 ${DESC_MAX} 个字符`
  return ''
}

function validatePermissions(list) {
  if (list === undefined) return ''
  if (!Array.isArray(list)) return '权限必须是数组'
  const known = new Set(PERMISSIONS.map(p => p.key))
  const bad = list.filter(p => !known.has(p))
  if (bad.length) return `存在无法识别的权限：${bad.join('、')}`
  return ''
}

function newId() {
  return `role-${crypto.randomBytes(4).toString('hex')}`
}

export function createRole(input = {}) {
  const name = normalizeName(input.name)
  const description = String(input.description ?? '').trim()
  const nameErr = validateName(name)
  if (nameErr) throw Object.assign(new Error(nameErr), { status: 400 })
  const descErr = validateDescription(description)
  if (descErr) throw Object.assign(new Error(descErr), { status: 400 })
  const permErr = validatePermissions(input.permissions)
  if (permErr) throw Object.assign(new Error(permErr), { status: 400 })

  const t = nowIso()
  const rec = {
    id: newId(),
    name,
    description,
    permissions: normalizePermissions(input.permissions || []),
    scope: normalizeScope(input.scope),
    builtin: false,
    createdAt: t,
    updatedAt: t,
  }
  const roles = readStore()
  roles.push(rec)
  writeFile(roles)
  return publicRole(rec)
}

export function updateRole(roleId, patch = {}) {
  const roles = readStore()
  const idx = roles.findIndex(r => r.id === roleId)
  if (idx < 0) throw Object.assign(new Error('角色不存在'), { status: 404 })
  const rec = roles[idx]

  if (patch.name !== undefined) {
    const name = normalizeName(patch.name)
    const err = validateName(name, roleId)
    if (err) throw Object.assign(new Error(err), { status: 400 })
    rec.name = name
  }
  if (patch.description !== undefined) {
    const description = String(patch.description ?? '').trim()
    const err = validateDescription(description)
    if (err) throw Object.assign(new Error(err), { status: 400 })
    rec.description = description
  }
  if (patch.permissions !== undefined) {
    const err = validatePermissions(patch.permissions)
    if (err) throw Object.assign(new Error(err), { status: 400 })
    rec.permissions = normalizePermissions(patch.permissions)
  }
  if (patch.scope !== undefined) rec.scope = normalizeScope(patch.scope)
  rec.updatedAt = nowIso()
  roles[idx] = rec
  writeFile(roles)
  return publicRole(rec)
}

export function deleteRole(roleId) {
  const roles = readStore()
  const idx = roles.findIndex(r => r.id === roleId)
  if (idx < 0) throw Object.assign(new Error('角色不存在'), { status: 404 })
  const [removed] = roles.splice(idx, 1)
  writeFile(roles)
  return { removed: removed.id, name: removed.name }
}

/** 角色是否存在（供用户绑定校验） */
export function roleExists(roleId) {
  return !!getRole(roleId)
}
