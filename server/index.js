import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { config } from './src/config.js'
import { kubeRequest, KubeError, listClusters } from './src/kube.js'
import { initClusters } from './src/clusterService.js'
import { attachTerminal } from './src/terminal.js'
import { credentialMeta } from './src/userStore.js'
import router from './src/routes.js'
import { auditMiddleware } from './src/auditService.js'

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', config.trustProxy)
app.use((req,res,next) => {
  res.setHeader('X-Content-Type-Options','nosniff')
  res.setHeader('X-Frame-Options','SAMEORIGIN')
  res.setHeader('Referrer-Policy','no-referrer')
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()')
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-src http: https:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'")
  if (req.secure) res.setHeader('Strict-Transport-Security','max-age=31536000')
  if (req.path.startsWith('/api')) res.setHeader('Cache-Control','no-store')
  next()
})
app.use(express.json({ limit: '8mb' }))
app.use('/api', auditMiddleware)

// 启动时构建多集群注册表
let boot = { count: 0, warnings: [] }
try {
  boot = initClusters()
  console.log(`[KubePanel] 已加载 ${boot.count} 个集群：${listClusters().map(c => `${c.name} (${c.server})`).join('、') || '无'}`)
  for (const w of boot.warnings) console.warn(`[KubePanel] 集群加载警告：${w}`)
} catch (e) {
  console.error(`[KubePanel] 集群注册表初始化失败：${e.message}`)
}

// Probes are constant-time and never wait on a remote API or expose cluster metadata.
const probe = () => ({status:'ok',service:'kubepanel',version:config.version,revision:config.revision,sourceManifestSha256:config.sourceManifestSha256})
app.get(['/livez','/healthz'], (req,res) => res.json(probe()))
app.get('/readyz', (req,res) => {
  try {
    fs.accessSync(config.dataDir,fs.constants.R_OK|fs.constants.W_OK)
    res.json(probe())
  } catch { res.status(503).json({status:'not-ready',message:'运行数据目录不可用'}) }
})

// 一个集群都没有时，除「平台级」接口（集群/仓库/监控/账号/用户角色）外的接口给出明确提示
app.use('/api/v1', (req, res, next) => {
  const platform = ['/v1/clusters', '/v1/auth', '/v1/registries', '/v1/monitor', '/v1/users', '/v1/roles', '/v1/audit']
  if (listClusters().length === 0 && !platform.some(p => req.originalUrl.includes(p))) {
    return res.status(503).json({ message: '尚未配置任何集群，请先在集群列表页导入 kubeconfig' })
  }
  next()
})
app.use('/api', router)

// 前端静态资源（Docker 构建阶段由 frontend/dist 拷入 /app/public）
const publicDir = config.publicDir
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir, { index: false, maxAge: '1h' }))
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.setHeader('Cache-Control','no-cache')
      return res.sendFile(path.join(publicDir, 'index.html'))
    }
    next()
  })
} else {
  app.get('/', (req, res) => res.status(200).type('html').send(
    `<h2>KubePanel 后端已启动</h2><p>未找到前端构建产物：${publicDir}</p>
     <p>本地开发请执行 <code>cd frontend && npm run dev</code>；生产请用 Dockerfile 构建。</p>`
  ))
}

// 统一错误处理：KubeError 保留 API Server 的状态码与原始 message
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  if (err instanceof KubeError || (err?.status >= 400 && err?.status < 600)) {
    return res.status(err.status || 500).json({ message: err.message, details: err.details })
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ message: '请求体不是合法 JSON' })
  }
  console.error('[KubePanel] 未处理异常：', err)
  res.status(500).json({ message: err.message || '服务内部错误' })
})

const server = http.createServer(app)
attachTerminal(server, {isSecureRequest:req => !!req.socket.encrypted ||
  (app.get('trust proxy fn')(req.socket.remoteAddress,0) && String(req.headers['x-forwarded-proto']||'').split(',')[0].trim()==='https')})

server.listen(config.port, config.host, () => {
  console.log('')
  console.log('  ╔══════════════════════════════════════════════════════════╗')
  console.log(`  KubePanel v${config.version} · ${config.revision}`)
  console.log('  ╚══════════════════════════════════════════════════════════╝')
  console.log(`  监听地址      : http://${config.host}:${config.port}`)
  console.log(`  集群数量      : ${boot.count}`)
  console.log(`  集群目录      : ${config.clustersDir}`)
  console.log(`  登录账号      : ${config.authEnabled ? config.username : '（认证已关闭）'}`)
  if (config.authEnabled) {
    const meta = credentialMeta()
    if (meta.source === 'file') {
      console.log(`  登录密码      : 已在界面上自定义（${meta.updatedAt || '时间未知'}更新，哈希存于数据目录）`)
      console.log('  提示          : 此时 DASHBOARD_PASSWORD 已失效，忘记密码见 README「重置密码」')
    } else {
      console.log(config.passwordGenerated ? '  初始密码保存在数据目录 .initial-password（仅管理员可读）' : '  登录密码已通过环境配置提供（不记录明文）')
      console.log(`  数据目录      : ${config.dataDir}（界面改密码后的哈希存这里）`)
    }
  }
  if (config.secretGenerated) {
    console.log(
      config.secretPersisted
        ? `  提示          : 未设置 DASHBOARD_SECRET，已自动生成密钥并保存在数据目录（重启后复用）`
        : '  提示          : 未设置 DASHBOARD_SECRET 且数据目录不可写，本次使用临时密钥；重启后已登录会话会失效',
    )
  }
  console.log('')
})

process.on('unhandledRejection', err => console.error('[KubePanel] unhandledRejection:', err))
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{
  server.close(()=>process.exit(0))
  setTimeout(()=>process.exit(0),10000).unref()
})
