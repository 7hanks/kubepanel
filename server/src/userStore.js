import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { promisify } from 'node:util'
const scryptAsync = promisify(crypto.scrypt)

/**
 * 登录凭据持久化。
 *
 * 环境变量（DASHBOARD_PASSWORD）只能作为「初始密码」：容器里改不了也存不住。
 * 一旦在界面上改过密码，就以数据目录下的 auth.json 为准，环境变量被忽略。
 * 只保存 scrypt 哈希 + 随机盐，不保存明文。
 */

const FILE = path.join(config.dataDir, 'auth.json')
const ALGO = 'scrypt'
const KEY_LEN = 64

function scrypt(password, salt) {
  return crypto.scryptSync(String(password), salt, KEY_LEN)
}

/** 读取已落盘的凭据；文件不存在 / 损坏 / 用户名已变 都返回 null（回退到环境变量） */
export function readCredential() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8')
    const rec = JSON.parse(raw)
    if (!rec || !rec.salt || !rec.hash) throw new Error('凭据文件格式错误')
    // 换了 DASHBOARD_USERNAME 时，旧账号的密码哈希不再适用
    if (rec.username && rec.username !== config.username) return null
    return rec
  } catch (e) {
    if (e.code !== 'ENOENT') throw Object.assign(new Error('凭据文件不可用，已拒绝回退到初始密码；请恢复备份'), {status:503})
    return null
  }
}

export function credentialSource() {
  return readCredential() ? 'file' : 'env'
}

/** 校验密码：有落盘凭据用哈希比对，否则交给调用方按环境变量比较 */
export async function verifyPassword(password) {
  const rec = readCredential()
  if (!rec) return null
  const expected = Buffer.from(String(rec.hash), 'hex')
  const actual = await scryptAsync(String(password), rec.salt, KEY_LEN)
  if (expected.length !== actual.length) return false
  return crypto.timingSafeEqual(expected, actual)
}

/** 写入新密码（原子写 + 600 权限） */
export function savePassword(password) {
  const dir = config.dataDir
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const salt = crypto.randomBytes(16).toString('hex')
  const rec = {
    username: config.username,
    algo: ALGO,
    keylen: KEY_LEN,
    salt,
    hash: scrypt(password, salt).toString('hex'),
    updatedAt: new Date().toISOString(),
  }
  const tmp = `${FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, FILE)
  try { fs.chmodSync(FILE, 0o600) } catch (e) { /* 非 POSIX 文件系统忽略 */ }
  return rec
}

export function credentialMeta() {
  const rec = readCredential()
  return {
    source: rec ? 'file' : 'env',
    updatedAt: rec?.updatedAt || null,
    file: FILE,
  }
}

export function passwordFile() { return FILE }
