import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { verifyPassword, savePassword, credentialMeta } from './userStore.js'
import {
  resolveAccount, verifyUserPassword, changeOwnPassword, validatePassword,
} from './userService.js'
import { SUPER_ROLE } from './permissions.js'

/** 定时安全比较，避免普通字符串比较泄露时间信息 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

/**
 * 密码校验：内置 admin 走 auth.json / 环境变量，其他账号走 users.json。
 * 返回账号对象（含角色与权限），失败返回 null。
 */
function authenticate(username, password) {
  if (!username || password === undefined || password === null) return null
  if (username === config.username) {
    const hashed = verifyPassword(password)
    const ok = hashed !== null ? hashed : safeEqual(password, config.password)
    if (!ok) return null
    return resolveAccount(config.username)
  }
  if (!verifyUserPassword(username, password)) return null
  return resolveAccount(username)
}

export function signToken(username, role) {
  return jwt.sign({ sub: username, role, scope: 'kubepanel' }, config.secret, { expiresIn: config.tokenTtl })
}

/** 匿名模式（关闭认证）时的账号：等同超级管理员 */
export const ANONYMOUS = {
  username: 'anonymous',
  nickname: '',
  role: SUPER_ROLE.id,
  roleName: SUPER_ROLE.name,
  permissions: ['*'],
  builtin: true,
}

/** POST /api/auth/login */
export function login(req, res) {
  const { username, password } = req.body || {}
  if (!config.authEnabled) {
    return res.json({
      token: 'auth-disabled', username: 'anonymous', role: SUPER_ROLE.id,
      roleName: SUPER_ROLE.name, permissions: ['*'], expiresIn: 'never',
    })
  }
  const account = authenticate(String(username || '').trim(), password)
  if (!account) {
    return res.status(401).json({ message: '用户名或密码错误' })
  }
  return res.json({
    token: signToken(account.username, account.role),
    username: account.username,
    nickname: account.nickname || '',
    role: account.role,
    roleName: account.roleName,
    permissions: account.permissions,
    expiresIn: config.tokenTtl,
    passwordSource: account.builtin ? credentialMeta().source : 'file',
  })
}

export function logout(req, res) {
  // JWT 无状态，前端清除本地 token 即可；保留接口便于未来接入黑名单
  res.json({ ok: true })
}

/** GET /api/v1/auth/profile —— 给「修改密码」弹窗与前端菜单权限使用 */
export function profile(req, res) {
  const account = req.account || ANONYMOUS
  const meta = account.builtin ? credentialMeta() : { source: 'file', updatedAt: null }
  res.json({
    username: account.username,
    nickname: account.nickname || '',
    role: account.role,
    roleName: account.roleName,
    permissions: account.permissions,
    authEnabled: config.authEnabled,
    passwordSource: meta.source,       // file = 已改过密码；env = 仍用环境变量初始密码
    passwordUpdatedAt: meta.updatedAt,
  })
}

/** POST /api/v1/auth/password */
export function changePassword(req, res) {
  if (!config.authEnabled) {
    return res.status(400).json({ message: '当前已关闭登录认证（DASHBOARD_AUTH_ENABLED=false），无需修改密码' })
  }
  const account = req.account
  if (!account) return res.status(401).json({ message: '未登录或登录已过期' })
  const { currentPassword, newPassword } = req.body || {}
  const current = String(currentPassword ?? '')
  if (!authenticate(account.username, current)) {
    return res.status(400).json({ message: '当前密码不正确' })
  }
  const pwd = String(newPassword ?? '')
  const pwdErr = validatePassword(pwd)
  if (pwdErr) return res.status(400).json({ message: pwdErr })
  if (safeEqual(pwd, current)) return res.status(400).json({ message: '新密码不能与当前密码相同' })

  if (account.builtin) {
    const rec = savePassword(pwd)
    console.log(`[KubePanel] 登录密码已更新（来源：${credentialMeta().file}），旧环境变量密码已失效`)
    return res.json({
      ok: true,
      message: '密码已更新，请使用新密码重新登录',
      passwordSource: 'file',
      updatedAt: rec.updatedAt,
    })
  }
  const updatedAt = changeOwnPassword(account.username, pwd)
  console.log(`[KubePanel] 用户 ${account.username} 修改了自己的密码`)
  return res.json({
    ok: true,
    message: '密码已更新，请使用新密码重新登录',
    passwordSource: 'file',
    updatedAt,
  })
}

/**
 * 认证中间件。JWT 支持两种传递方式：
 * - Authorization: Bearer <token>（常规 XHR）
 * - ?token=<token>（EventSource / WebSocket 无法自定义请求头）
 * /healthz 与登录接口不需要认证。
 *
 * 角色与权限每次请求实时解析：改角色、禁用或删除账号立即生效，不必等 token 过期。
 */
export function authMiddleware(req, res, next) {
  if (!config.authEnabled) { req.account = ANONYMOUS; return next() }
  const header = req.headers.authorization || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  const token = bearer || (typeof req.query.token === 'string' ? req.query.token : '')
  if (!token || token === 'auth-disabled') {
    return res.status(401).json({ message: '未登录或登录已过期' })
  }
  let payload
  try {
    payload = jwt.verify(token, config.secret)
  } catch (e) {
    return res.status(401).json({ message: '登录已过期，请重新登录' })
  }
  req.user = payload
  const account = resolveAccount(payload.sub)
  if (!account) {
    return res.status(401).json({ message: '账号不存在或已被禁用，请重新登录' })
  }
  req.account = account
  return next()
}

/** WebSocket 升级阶段的认证（ws 不经过 Express 中间件）：返回账号或 null */
export function accountFromWsToken(url) {
  if (!config.authEnabled) return ANONYMOUS
  const token = url.searchParams.get('token')
  if (!token) return null
  try {
    const payload = jwt.verify(token, config.secret)
    return resolveAccount(payload.sub)
  } catch (e) {
    return null
  }
}

/** 保留旧名，供只关心「是否已登录」的调用方使用 */
export function verifyWsToken(url) {
  return !!accountFromWsToken(url)
}
