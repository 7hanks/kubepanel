import crypto from 'node:crypto'
import { readJson, writeJson } from './jsonStore.js'

const tickets = new Map()
const nonce = () => crypto.randomBytes(32).toString('base64url')
const key = token => crypto.createHash('sha256').update(String(token)).digest('hex')
function readSessions() {
  const data = readJson('sessions.json', { sessions: [] })
  if (!Array.isArray(data?.sessions)) throw Object.assign(new Error('会话数据损坏，已拒绝认证'), { status: 503 })
  return data.sessions
}
export function createSession(username, stamp, expiresAt) {
  const now = Date.now()
  const record = { id: nonce(), username, stamp, csrfToken: nonce(), createdAt: now, expiresAt }
  const sessions = readSessions().filter(s => s.expiresAt > now)
  if (sessions.length >= 10000) throw Object.assign(new Error('活动会话已达上限'), { status: 503 })
  sessions.push(record)
  writeJson('sessions.json', { sessions })
  return record
}
export function sessionById(id) { return readSessions().find(s => s.id === id && s.expiresAt > Date.now()) || null }
export function getSession(id, username, stamp) {
  const record = sessionById(id)
  return record?.username === username && record.stamp === stamp ? record : null
}
export function revokeSession(id) { writeJson('sessions.json', {sessions:readSessions().filter(s => s.id !== id && s.expiresAt > Date.now())}) }
export function revokeUserSessions(username) { writeJson('sessions.json', {sessions:readSessions().filter(s => s.username !== username && s.expiresAt > Date.now())}) }
export function createStreamTicket(sessionId, target) {
  if (!sessionById(sessionId)) throw Object.assign(new Error('会话已失效'), { status: 401 })
  const now = Date.now()
  for (const [id,ticket] of tickets) if (ticket.expiresAt < now) tickets.delete(id)
  if (tickets.size >= 10000) throw Object.assign(new Error('流连接票据过多，请稍后重试'), { status: 429 })
  const ticket = nonce()
  tickets.set(key(ticket), { sessionId, target: {purpose:target.purpose,clusterId:target.clusterId,namespace:target.namespace,pod:target.pod}, expiresAt:now+60000 })
  return ticket
}
export function consumeStreamTicket(ticket, target) {
  const hash = key(ticket), record = tickets.get(hash)
  if (!record || record.expiresAt < Date.now()) { tickets.delete(hash); return null }
  if (Object.keys(record.target).some(k => record.target[k] !== target[k])) return null
  tickets.delete(hash)
  return sessionById(record.sessionId)
}
