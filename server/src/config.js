import crypto from 'node:crypto'
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
const generatedSecret = !process.env.DASHBOARD_SECRET ? randomSecret(32) : null

export const config = {
  prod,
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  username: process.env.DASHBOARD_USERNAME || 'admin',
  password: process.env.DASHBOARD_PASSWORD || generatedPassword,
  passwordGenerated: !!generatedPassword,
  secret: process.env.DASHBOARD_SECRET || generatedSecret,
  secretGenerated: !!generatedSecret,
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
  dataDir: process.env.DATA_DIR || path.join(serverRoot, 'data'),
  discoveryCacheMs: 5 * 60 * 1000,
  requestTimeoutMs: Number(process.env.KUBE_REQUEST_TIMEOUT || 30000),
}
