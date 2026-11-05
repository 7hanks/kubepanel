import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const serverRoot = path.resolve(__dirname, '..')

function randomSecret(n = 24) {
  return crypto.randomBytes(n).toString('hex')
}

const prod = process.env.NODE_ENV === 'production'

// 未显式设置密码时自动生成随机密码并打印到启动日志，避免固定弱口令上线
const generatedPassword = !process.env.DASHBOARD_PASSWORD ? randomSecret(8) : null

const dataDir = process.env.DATA_DIR || path.join(serverRoot, 'data')

/**
 * JWT 签名密钥：DASHBOARD_SECRET 未设置时，在数据目录生成一次并落盘复用。
 * 这样不配这个变量也不会「每次重启把所有人踢下线」；数据目录不可写时退回内存随机值。
 */
function loadOrCreateSecret(dir) {
  const file = path.join(dir, '.jwt-secret')
  try {
    const saved = fs.readFileSync(file, 'utf8').trim()
    if (saved.length >= 32) return { value: saved, source: 'file' }
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[KubePanel] 读取密钥文件失败（${file}）：${e.message}`)
  }
  const value = randomSecret(32)
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    fs.writeFileSync(file, value, { mode: 0o600 })
    try { fs.chmodSync(file, 0o600) } catch (e) { /* 非 POSIX 文件系统忽略 */ }
    return { value, source: 'file' }
  } catch (e) {
    console.warn(`[KubePanel] 密钥无法写入数据目录（${file}）：${e.message}；本次使用临时密钥，重启后登录状态会失效`)
    return { value, source: 'memory' }
  }
}

const savedSecret = process.env.DASHBOARD_SECRET ? null : loadOrCreateSecret(dataDir)

export const config = {
  prod,
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  username: process.env.DASHBOARD_USERNAME || 'admin',
  password: process.env.DASHBOARD_PASSWORD || generatedPassword,
  passwordGenerated: !!generatedPassword,
  secret: process.env.DASHBOARD_SECRET || savedSecret.value,
  // true = 没配 DASHBOARD_SECRET，密钥自动生成；secretPersisted = 是否已落盘复用
  secretGenerated: !!savedSecret,
  secretPersisted: savedSecret?.source === 'file',
  authEnabled: process.env.DASHBOARD_AUTH_ENABLED !== 'false',
  tokenTtl: process.env.DASHBOARD_TOKEN_TTL || '12h',
  kubeconfigPath: process.env.KUBECONFIG || '',
  // 可写目录：每个 kubeconfig 文件 = 一个（或多个 context）集群，界面添加的集群也落在这里
  clustersDir: process.env.KUBE_CLUSTERS_DIR || '/app/kube/clusters',
  // 可选：直接注入 kubeconfig 内容（base64），避免挂载文件；适合 CI / Secret 场景
  kubeConfigB64: process.env.KUBE_CONFIG_B64 || '',
  // 前端构建产物目录：Docker 中为 /app/public，本地开发为 ../frontend/dist
  publicDir: process.env.PUBLIC_DIR || path.resolve(__dirname, '../../frontend/dist'),
  // 可写数据目录：界面修改后的登录密码（scrypt 哈希）落在这里，重启不丢
  dataDir,
  discoveryCacheMs: 5 * 60 * 1000,
  requestTimeoutMs: Number(process.env.KUBE_REQUEST_TIMEOUT || 30000),
}
