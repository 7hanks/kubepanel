import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.js'

export function readJson(name, fallback) {
  const file = path.join(config.dataDir, name)
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback)
    throw Object.assign(new Error(`数据文件 ${name} 无法读取，请从备份恢复；未覆盖原文件`), { status: 503 })
  }
}
export function writeJson(name, value) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
  const file = path.join(config.dataDir, name)
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' })
    fs.renameSync(temp, file)
    try { fs.chmodSync(file, 0o600) } catch { /* Windows ACL manages permissions */ }
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
}
