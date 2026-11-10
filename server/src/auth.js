import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { verifyPassword, savePassword, credentialMeta } from './userStore.js'
import { resolveAccount, verifyUserPassword, changeOwnPassword, validatePassword, credentialStamp } from './userService.js'
import { SUPER_ROLE, can } from './permissions.js'
import { assertResourceAccess } from './access.js'
import { createSession, getSession, sessionById, revokeSession, revokeUserSessions, createStreamTicket, consumeStreamTicket } from './sessionService.js'

const COOKIE = 'kp_session'
const limits = new Map()
const MAX_ATTEMPTS = 10
const WINDOW_MS = 15 * 60 * 1000
function safeEqual(a,b) {
  const left=Buffer.from(String(a)),right=Buffer.from(String(b))
  return left.length===right.length && crypto.timingSafeEqual(left,right)
}
export function originAllowed(req) {
  const origin=req.headers?.origin
  if (!origin) return true
  try {
    const url=new URL(origin)
    return url.host===req.headers.host && url.protocol===(req.secure ? 'https:' : 'http:')
  } catch { return false }
}
async function authenticate(username,password) {
  if (typeof password!=='string'||!password||password.length>128||typeof username!=='string'||username.length>64) return null
  const observed=credentialStamp(username)
  if (username===config.username) {
    const hashed=await verifyPassword(password)
    return (hashed!==null ? hashed : safeEqual(password,config.password)) && safeEqual(observed,credentialStamp(username)) ? resolveAccount(username) : null
  }
  return await verifyUserPassword(username,password) && safeEqual(observed,credentialStamp(username)) ? resolveAccount(username) : null
}
function cookie(res,req,token,expiresAt) {
  const secure=req.secure||config.cookieSecure
  const age=Math.max(0,Math.floor((expiresAt-Date.now())/1000))
  res.setHeader('Set-Cookie',COOKIE+'='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+age+(secure?'; Secure':''))
  res.setHeader('Cache-Control','no-store')
}
function tokenOf(req) {
  const header=req.headers?.authorization||''
  if(header.startsWith('Bearer ')) return {token:header.slice(7),bearer:true}
  const value=String(req.headers?.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))
  return {token:value?.slice(COOKIE.length+1)||'',bearer:false}
}
function boundAccount(session) {
  if(!session) return null
  const account=resolveAccount(session.username)
  return account&&getSession(session.id,account.username,credentialStamp(account.username)) ? account : null
}
export function signToken(username,role,observedStamp=credentialStamp(username)) {
  if(!safeEqual(observedStamp,credentialStamp(username))) throw Object.assign(new Error('凭据在登录期间已更改，请重新登录'),{status:401})
  const temporary=jwt.sign({sub:username,role,scope:'kubepanel'},config.secret,{expiresIn:config.tokenTtl,algorithm:'HS256'})
  const expiresAt=jwt.decode(temporary).exp*1000
  const session=createSession(username,observedStamp,expiresAt)
  return jwt.sign({sub:username,role,scope:'kubepanel',jti:session.id},config.secret,{expiresIn:config.tokenTtl,algorithm:'HS256'})
}
export const ANONYMOUS={username:'anonymous',nickname:'',role:SUPER_ROLE.id,roleName:SUPER_ROLE.name,permissions:['*'],builtin:true}

export async function login(req,res) {
  if(!originAllowed(req)) return res.status(403).json({message:'登录来源不受信任'})
  if(!config.authEnabled) return res.json({token:'auth-disabled',...ANONYMOUS,authEnabled:false,csrfToken:'',expiresIn:'never'})
  const username=String(req.body?.username||'').trim(),now=Date.now()
  for(const [key,value] of limits) if(now-value.at>WINDOW_MS) limits.delete(key)
  if(limits.size>=10000) return res.status(429).json({message:'登录请求过多，请稍后重试'})
  const keys=['ip:'+(req.ip||req.socket?.remoteAddress||'unknown'),'user:'+username.toLowerCase()]
  const blocked=keys.map(k=>limits.get(k)).find(x=>x&&x.count>=MAX_ATTEMPTS&&now-x.at<WINDOW_MS)
  if(blocked) {
    res.setHeader('Retry-After',String(Math.ceil((WINDOW_MS-(now-blocked.at))/1000)))
    return res.status(429).json({message:'登录失败次数过多，请稍后重试'})
  }
  const observedStamp=credentialStamp(username)
  const account=await authenticate(username,req.body?.password)
  if(!account) {
    for(const key of keys) {const old=limits.get(key);limits.set(key,{count:(old?.count||0)+1,at:old?.at||now})}
    return res.status(401).json({message:'用户名或密码错误'})
  }
  for(const key of keys) limits.delete(key)
  const token=signToken(account.username,account.role,observedStamp),payload=jwt.decode(token),session=sessionById(payload.jti)
  cookie(res,req,token,payload.exp*1000)
  req.account=account
  return res.json({token,username:account.username,nickname:account.nickname||'',role:account.role,roleName:account.roleName,permissions:account.permissions,scope:account.scope,csrfToken:session.csrfToken,expiresIn:config.tokenTtl,passwordSource:account.builtin?credentialMeta().source:'file'})
}
export function logout(req,res) {
  if(req.user?.jti) revokeSession(req.user.jti)
  cookie(res,req,'',0)
  return res.json({ok:true})
}
export function profile(req,res) {
  const account=req.account||ANONYMOUS
  const meta=account.builtin?credentialMeta():{source:'file',updatedAt:null}
  res.setHeader('Cache-Control','no-store')
  return res.json({username:account.username,nickname:account.nickname||'',role:account.role,roleName:account.roleName,permissions:account.permissions,scope:account.scope,csrfToken:req.session?.csrfToken||'',authEnabled:config.authEnabled,passwordSource:meta.source,passwordUpdatedAt:meta.updatedAt})
}
export async function changePassword(req,res) {
  if(!config.authEnabled) return res.status(400).json({message:'当前已关闭登录认证'})
  const account=req.account,{currentPassword,newPassword}=req.body||{}
  const observedStamp=credentialStamp(account.username)
  if(!await authenticate(account.username,currentPassword) || !safeEqual(observedStamp,credentialStamp(account.username))) return res.status(400).json({message:'当前密码不正确或凭据已更改，请重新登录'})
  const error=validatePassword(newPassword)
  if(error) return res.status(400).json({message:error})
  if(safeEqual(currentPassword,newPassword)) return res.status(400).json({message:'新密码不能与当前密码相同'})
  const updatedAt=account.builtin?savePassword(newPassword).updatedAt:changeOwnPassword(account.username,newPassword)
  revokeUserSessions(account.username)
  cookie(res,req,'',0)
  return res.json({ok:true,message:'密码已更新，所有旧会话已失效，请重新登录',passwordSource:'file',updatedAt})
}
export function authMiddleware(req,res,next) {
  if(!config.authEnabled){req.account=ANONYMOUS;return next()}
  const {token,bearer}=tokenOf(req)
  let payload,session,account
  try {
    payload=jwt.verify(token,config.secret,{algorithms:['HS256']})
    if(payload.scope!=='kubepanel'||!payload.jti) throw new Error('legacy or invalid session')
    session=getSession(payload.jti,payload.sub,credentialStamp(payload.sub))
    account=boundAccount(session)
  } catch(error) {
    if(error.status===503) return next(error)
    return res.status(401).json({message:'登录已失效，请重新登录'})
  }
  if(!account) return res.status(401).json({message:'会话或账号已失效，请重新登录'})
  if(!originAllowed(req)) return res.status(403).json({message:'请求来源不受信任'})
  if(!bearer&&!['GET','HEAD','OPTIONS'].includes(req.method||'GET')&&!safeEqual(req.headers?.['x-csrf-token']||'',session.csrfToken)) return res.status(403).json({message:'会话校验失败，请刷新页面后重试'})
  req.user=payload;req.session=session;req.account=account
  return next()
}
export function issueStreamTicket(req,res) {
  const {purpose,clusterId,namespace,pod}=req.body||{}
  if(!['logs','exec'].includes(purpose)||![clusterId,namespace,pod].every(x=>typeof x==='string'&&x.length>0&&x.length<=253)) return res.status(400).json({message:'缺少合法的流连接目标'})
  if(!can(req.account,purpose==='exec'?'pod:exec':'pod:logs')) return res.status(403).json({message:'没有日志或终端访问权限'})
  assertResourceAccess(req.account,{clusterId,namespace,group:'',plural:'pods',verb:'get'})
  if(!config.authEnabled) return res.json({ticket:'auth-disabled'})
  return res.json({ticket:createStreamTicket(req.session.id,{purpose,clusterId,namespace,pod}),expiresIn:60})
}
export function accountFromWsToken(url) {
  if(!config.authEnabled) return ANONYMOUS
  const target={purpose:'exec',clusterId:url.searchParams.get('clusterId'),namespace:url.searchParams.get('namespace'),pod:url.searchParams.get('pod')}
  const session=consumeStreamTicket(url.searchParams.get('ticket')||'',target)
  const account=boundAccount(session)
  if(account){account.sessionId=session.id;account.sessionExpiresAt=session.expiresAt}
  return account
}
export function activeStreamAccount(account) {
  if(!config.authEnabled) return ANONYMOUS
  return boundAccount(sessionById(account.sessionId))
}
export function verifyWsToken(url){return !!accountFromWsToken(url)}
