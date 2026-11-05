import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { verifyPassword, savePassword, credentialMeta } from './userStore.js'

/** 定时安全比较，避免普通字符串比较泄露时间信息 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

/**
 * 密码校验：界面上改过密码就以 auth.json 的 scrypt 哈希为准，
 * 否则回退到 DASHBOARD_PASSWORD（初始密码）。
 */
function checkCredentials(username, password) {
  if (!safeEqual(username, config.username)) return false
  const hashed = verifyPassword(password)
  if (hashed !== null) return hashed
  return safeEqual(password, config.password)
}

export function signToken(username) {
  return jwt.sign({ sub: username, scope: 'kubepanel' }, config.secret, { expiresIn: config.tokenTtl })
}

/** POST /api/auth/login */
export function login(req, res) {
  const { username, password } = req.body || {}
  if (!config.authEnabled) {
    return res.json({ token: 'auth-disabled', username: 'anonymous', expiresIn: 'never' })
  }
  if (!checkCredentials(username, password)) {
    return res.status(401).json({ message: '用户名或密码错误' })
  }
  return res.json({
    token: signToken(config.username),
    username: config.username,
    expiresIn: config.tokenTtl,
    passwordSource: credentialMeta().source,
  })
}

export function logout(req, res) {
  // JWT 无状态，前端清除本地 token 即可；保留接口便于未来接入黑名单
  res.json({ ok: true })
}

/** GET /api/v1/auth/profile —— 给「修改密码」弹窗展示来源与更新时间 */
export function profile(req, res) {
  const meta = credentialMeta()
  res.json({
    username: config.username,
    authEnabled: config.authEnabled,
    passwordSource: meta.source,       // file = 已改过密码；env = 仍用环境变量初始密码
    passwordUpdatedAt: meta.updatedAt,
  })
}

const MIN_LEN = 8
const MAX_LEN = 128

/** 至少包含两类字符（小写/大写/数字/符号），避免改成 88888888 这种 */
function strengthOk(pwd) {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(re => re.test(pwd)).length
  return classes >= 2
}

/** POST /api/v1/auth/password */
export function changePassword(req, res) {
  if (!config.authEnabled) {
    return res.status(400).json({ message: '当前已关闭登录认证（DASHBOARD_AUTH_ENABLED=false），无需修改密码' })
  }
  const { currentPassword, newPassword } = req.body || {}
  if (!checkCredentials(req.user?.sub || config.username, String(currentPassword ?? ''))) {
    return res.status(400).json({ message: '当前密码不正确' })
  }
  const pwd = String(newPassword ?? '')
  if (pwd.length < MIN_LEN) return res.status(400).json({ message: `新密码至少 ${MIN_LEN} 位` })
  if (pwd.length > MAX_LEN) return res.status(400).json({ message: `新密码最多 ${MAX_LEN} 位` })
  if (!strengthOk(pwd)) return res.status(400).json({ message: '新密码需包含大写字母、小写字母、数字、符号中的至少两类' })
  if (safeEqual(pwd, String(currentPassword ?? ''))) return res.status(400).json({ message: '新密码不能与当前密码相同' })

  const rec = savePassword(pwd)
  console.log(`[KubePanel] 登录密码已更新（来源：${credentialMeta().file}），旧环境变量密码已失效`)
  res.json({
    ok: true,
    message: '密码已更新，请使用新密码重新登录',
    passwordSource: 'file',
    updatedAt: rec.updatedAt,
  })
}

/**
 * 认证中间件。JWT 支持两种传递方式：
 * - Authorization: Bearer <token>（常规 XHR）
 * - ?token=<token>（EventSource / WebSocket 无法自定义请求头）
 * /healthz 与登录接口不需要认证。
 */
export function authMiddleware(req, res, next) {
  if (!config.authEnabled) return next()
  const header = req.headers.authorization || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  const token = bearer || (typeof req.query.token === 'string' ? req.query.token : '')
  if (!token || token === 'auth-disabled') {
    return res.status(401).json({ message: '未登录或登录已过期' })
  }
  try {
    req.user = jwt.verify(token, config.secret)
    return next()
  } catch (e) {
    return res.status(401).json({ message: '登录已过期，请重新登录' })
  }
}

/** WebSocket 升级阶段的认证（ws 不经过 Express 中间件） */
export function verifyWsToken(url) {
  if (!config.authEnabled) return true
  const token = url.searchParams.get('token')
  if (!token) return false
  try { jwt.verify(token, config.secret); return true } catch (e) { return false }
}
