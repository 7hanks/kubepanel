import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { SUPER_ROLE } from './permissions.js'
import { getRole, permissionsOf, roleName as roleNameOf } from './roleService.js'
import { normalizeScope } from './access.js'
import { promisify } from 'node:util'
import { credentialMeta } from './userStore.js'

/**
 * 非 admin 账号的持久化。
 *
 * 环境变量里的 admin 仍然是「内置超级管理员」，密码哈希在 auth.json（见 userStore.js）；
 * 这里是界面上创建的其他账号，落在数据目录的 users.json，同样只保存 scrypt 哈希 + 随机盐。
 */

const FILE = path.join(config.dataDir, 'users.json')
const ALGO = 'scrypt'
const KEY_LEN = 64
const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,31}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const scryptAsync = promisify(crypto.scrypt)

function scrypt(password, salt) {
  return crypto.scryptSync(String(password), salt, KEY_LEN)
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  return { algo: ALGO, keylen: KEY_LEN, salt, hash: scrypt(password, salt).toString('hex') }
}

function verifyHash(password, rec) {
  if (!rec?.salt || !rec?.hash) return false
  const expected = Buffer.from(String(rec.hash), 'hex')
  const actual = scrypt(password, rec.salt)
  if (expected.length !== actual.length) return false
  return crypto.timingSafeEqual(expected, actual)
}

/** 读取原始记录；文件不存在 / 损坏时视为空表 */
function readStore() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8')
    const doc = JSON.parse(raw)
    if (!Array.isArray(doc?.users)) throw new Error('账号数据格式错误')
    return doc.users
  } catch (e) {
    if (e.code !== 'ENOENT') throw Object.assign(new Error('账号数据无法读取，请从备份恢复'), {status:503})
    return []
  }
}

function writeStore(users) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
  const tmp = `${FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ users }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, FILE)
  try { fs.chmodSync(FILE, 0o600) } catch (e) { /* 非 POSIX 文件系统忽略 */ }
}

export function validatePassword(pwd) {
  const p = String(pwd ?? '')
  if (p.length < 8) return '密码至少 8 位'
  if (p.length > 128) return '密码最多 128 位'
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(re => re.test(p)).length
  if (classes < 2) return '密码需包含大写字母、小写字母、数字、符号中的至少两类'
  return ''
}

function validateRole(roleId) {
  if (!getRole(roleId)) return '请选择一个有效的角色'
  return ''
}

/** 对外展示用的账号视图（绝不含盐与哈希） */
function publicUser(rec) {
  return {
    username: rec.username,
    nickname: rec.nickname || '',
    email: rec.email || '',
    role: rec.role,
    roleName: roleNameOf(rec.role),
    enabled: rec.enabled !== false,
    builtin: false,
    createdAt: rec.createdAt || null,
    updatedAt: rec.updatedAt || null,
  }
}

const adminUser = () => ({
  username: config.username,
  nickname: '内置管理员',
  email: '',
  role: SUPER_ROLE.id,
  roleName: SUPER_ROLE.name,
  enabled: true,
  builtin: true,
  createdAt: null,
  updatedAt: null,
})

/** 用户列表：内置 admin 排在最前 */
export function listUsers() {
  return [adminUser(), ...readStore().map(publicUser)]
}

function findRaw(username) {
  const u = String(username || '').toLowerCase()
  return readStore().find(r => String(r.username).toLowerCase() === u) || null
}

/**
 * 解析登录账号：admin 走环境变量/凭据文件，其他账号走 users.json。
 * 账号被删除或禁用时返回 null，存量 token 立即失效。
 */
export function resolveAccount(username) {
  if (!username) return null
  if (username === config.username) {
    return {
      username: config.username,
      nickname: '内置管理员',
      role: SUPER_ROLE.id,
      roleName: SUPER_ROLE.name,
      permissions: ['*'],
      builtin: true,
      scope: normalizeScope(),
    }
  }
  const rec = findRaw(username)
  if (!rec || rec.enabled === false) return null
  return {
    username: rec.username,
    nickname: rec.nickname || '',
    role: rec.role,
    roleName: roleNameOf(rec.role),
    permissions: permissionsOf(rec.role),
    builtin: false,
    scope: normalizeScope(getRole(rec.role)?.scope),
  }
}

export function credentialStamp(username) {
  if (username === config.username) {
    const meta = credentialMeta()
    return crypto.createHash('sha256').update(`${meta.source}:${meta.updatedAt || config.password}`).digest('hex')
  }
  const rec = findRaw(username)
  return rec ? crypto.createHash('sha256').update(`${rec.salt}:${rec.hash}`).digest('hex') : ''
}

/** 某个角色下绑定的账号数（删除角色前校验） */
export function countUsersByRole(roleId) {
  return readStore().filter(r => r.role === roleId).length
}

/** 校验非 admin 账号的密码 */
export async function verifyUserPassword(username, password) {
  const rec = findRaw(username)
  if (!rec || rec.enabled === false) return false
  const expected = Buffer.from(String(rec.hash), 'hex')
  const actual = await scryptAsync(String(password), rec.salt, KEY_LEN)
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}

export function userExists(username) {
  return !!findRaw(username)
}

export function createUser(input = {}) {
  const username = String(input.username || '').trim()
  const nickname = String(input.nickname || '').trim().slice(0, 64)
  const email = String(input.email || '').trim().slice(0, 128)
  const role = String(input.role || '').trim()

  if (!USERNAME_RE.test(username)) {
    throw Object.assign(new Error('用户名需为 2-32 位字母、数字、点、下划线或短横线，且以字母或数字开头'), { status: 400 })
  }
  if (username.toLowerCase() === String(config.username).toLowerCase()) {
    throw Object.assign(new Error(`用户名 ${config.username} 是内置管理员，请换一个`), { status: 400 })
  }
  if (userExists(username)) throw Object.assign(new Error(`用户 ${username} 已存在`), { status: 409 })
  if (email && !EMAIL_RE.test(email)) throw Object.assign(new Error('邮箱格式不正确'), { status: 400 })
  const roleErr = validateRole(role)
  if (roleErr) throw Object.assign(new Error(roleErr), { status: 400 })
  const pwdErr = validatePassword(input.password)
  if (pwdErr) throw Object.assign(new Error(pwdErr), { status: 400 })

  const now = new Date().toISOString()
  const rec = {
    username,
    nickname,
    email,
    role,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...hashPassword(input.password),
  }
  const users = readStore()
  users.push(rec)
  writeStore(users)
  return publicUser(rec)
}

export function updateUser(username, patch = {}) {
  const users = readStore()
  const idx = users.findIndex(r => String(r.username).toLowerCase() === String(username).toLowerCase())
  if (idx < 0) throw Object.assign(new Error('用户不存在'), { status: 404 })
  const rec = users[idx]

  if (patch.nickname !== undefined) rec.nickname = String(patch.nickname).trim().slice(0, 64)
  if (patch.email !== undefined) {
    const email = String(patch.email).trim().slice(0, 128)
    if (email && !EMAIL_RE.test(email)) throw Object.assign(new Error('邮箱格式不正确'), { status: 400 })
    rec.email = email
  }
  if (patch.role !== undefined && patch.role !== rec.role) {
    const roleErr = validateRole(patch.role)
    if (roleErr) throw Object.assign(new Error(roleErr), { status: 400 })
    rec.role = String(patch.role)
  }
  if (patch.enabled !== undefined) rec.enabled = !!patch.enabled
  if (patch.password) {
    const pwdErr = validatePassword(patch.password)
    if (pwdErr) throw Object.assign(new Error(pwdErr), { status: 400 })
    Object.assign(rec, hashPassword(patch.password))
  }
  rec.updatedAt = new Date().toISOString()
  users[idx] = rec
  writeStore(users)
  return publicUser(rec)
}

export function deleteUser(username) {
  const users = readStore()
  const idx = users.findIndex(r => String(r.username).toLowerCase() === String(username).toLowerCase())
  if (idx < 0) throw Object.assign(new Error('用户不存在'), { status: 404 })
  const [removed] = users.splice(idx, 1)
  writeStore(users)
  return { removed: removed.username }
}

/** 账号自己改密码（admin 由 userStore.savePassword 处理） */
export function changeOwnPassword(username, password) {
  const pwdErr = validatePassword(password)
  if (pwdErr) throw Object.assign(new Error(pwdErr), { status: 400 })
  const users = readStore()
  const rec = users.find(r => String(r.username).toLowerCase() === String(username).toLowerCase())
  if (!rec) throw Object.assign(new Error('用户不存在'), { status: 404 })
  Object.assign(rec, hashPassword(password))
  rec.updatedAt = new Date().toISOString()
  writeStore(users)
  return rec.updatedAt
}
