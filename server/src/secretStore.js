import crypto from 'node:crypto'
import { config } from './config.js'

// Derived from the persisted signing key; backups must preserve .jwt-secret.
const encryptionKey = () => crypto.createHmac('sha256', config.secret).update('kubepanel.integration.secrets.v1').digest()
export function sealSecret(value) {
  if (!value) return ''
  if (String(value).startsWith('enc:v1:')) { openSecret(value); return value }
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()])
  return `enc:v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`
}
export function openSecret(value) {
  if (!String(value || '').startsWith('enc:v1:')) return String(value || '')
  const [,,iv,tag,ciphertext] = value.split(':')
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv,'base64url'))
    decipher.setAuthTag(Buffer.from(tag,'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(ciphertext,'base64url')),decipher.final()]).toString('utf8')
  } catch { throw Object.assign(new Error('集成凭据解密失败，请恢复配套密钥或重新配置凭据'),{status:503}) }
}
