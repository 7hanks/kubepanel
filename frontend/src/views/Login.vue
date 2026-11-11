<template>
  <div class="login-page">
    <aside class="login-visual">
      <div class="login-brand"><span class="mark">K</span><span>KubePanel</span></div>
      <div class="login-headline">
        <h1>Kubernetes<br />多集群管理</h1>
        <p>统一查看集群状态、排查工作负载、编辑资源与常用运维操作。</p>
      </div>
      <div class="login-art" aria-hidden="true">
        <svg viewBox="0 0 560 440" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="lpTopGreen" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#eafff5" /><stop offset="100%" stop-color="#86efac" />
            </linearGradient>
            <linearGradient id="lpTopBlue" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#ffffff" /><stop offset="100%" stop-color="#e3edff" />
            </linearGradient>
            <linearGradient id="lpLeft" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#dbe8ff" /><stop offset="100%" stop-color="#a9c6ff" />
            </linearGradient>
            <linearGradient id="lpRight" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#bcd5ff" /><stop offset="100%" stop-color="#7fabff" />
            </linearGradient>
            <linearGradient id="lpLeftDeep" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#c3d9ff" /><stop offset="100%" stop-color="#8fb5ff" />
            </linearGradient>
            <linearGradient id="lpRightDeep" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#a9c6ff" /><stop offset="100%" stop-color="#6d9bf5" />
            </linearGradient>
            <radialGradient id="lpGlow" cx="50%" cy="46%" r="52%">
              <stop offset="0%" stop-color="#dbeafe" stop-opacity=".85" />
              <stop offset="100%" stop-color="#dbeafe" stop-opacity="0" />
            </radialGradient>
            <radialGradient id="lpShadow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#1d4ed8" stop-opacity=".16" />
              <stop offset="100%" stop-color="#1d4ed8" stop-opacity="0" />
            </radialGradient>
          </defs>

          <ellipse cx="280" cy="220" rx="230" ry="200" fill="url(#lpGlow)" />

          <!-- 连接线 -->
          <g stroke="#9dbdf5" stroke-width="1.4" stroke-dasharray="4 7" opacity=".75" fill="none">
            <path d="M128 187 L192 240" />
            <path d="M452 160 L352 240" />
            <path d="M166 300 L192 288" />
            <path d="M352 288 L390 286" />
          </g>
          <g fill="#7fa8ee">
            <circle cx="128" cy="187" r="3" /><circle cx="452" cy="160" r="3" />
            <circle cx="166" cy="300" r="2.6" /><circle cx="390" cy="286" r="2.6" />
          </g>

          <!-- 阴影 -->
          <ellipse cx="272" cy="360" rx="96" ry="15" fill="url(#lpShadow)" />
          <ellipse cx="132" cy="356" rx="44" ry="9" fill="url(#lpShadow)" />
          <ellipse cx="430" cy="350" rx="46" ry="9" fill="url(#lpShadow)" />

          <!-- 主立方体 -->
          <g>
            <path d="M192 240 L272 280 L272 352 L192 312 Z" fill="url(#lpLeftDeep)" />
            <path d="M352 240 L272 280 L272 352 L352 312 Z" fill="url(#lpRightDeep)" />
            <path d="M272 200 L352 240 L272 280 L192 240 Z" fill="url(#lpTopGreen)" stroke="#a7f3d0" stroke-width="1" />
          </g>

          <!-- 左小立方体 -->
          <g>
            <path d="M98 300 L132 317 L132 351 L98 334 Z" fill="url(#lpLeft)" />
            <path d="M166 300 L132 317 L132 351 L166 334 Z" fill="url(#lpRight)" />
            <path d="M132 283 L166 300 L132 317 L98 300 Z" fill="url(#lpTopBlue)" stroke="#dbeafe" stroke-width="1" />
          </g>

          <!-- 右小立方体 -->
          <g>
            <path d="M390 286 L430 306 L430 346 L390 326 Z" fill="url(#lpLeft)" />
            <path d="M470 286 L430 306 L430 346 L470 326 Z" fill="url(#lpRight)" />
            <path d="M430 266 L470 286 L430 306 L390 286 Z" fill="url(#lpTopBlue)" stroke="#dbeafe" stroke-width="1" />
          </g>

          <!-- 悬浮小立方体 -->
          <g opacity=".92">
            <path d="M96 178 L110 185 L110 203 L96 196 Z" fill="url(#lpLeft)" />
            <path d="M124 178 L110 185 L110 203 L124 196 Z" fill="url(#lpRight)" />
            <path d="M110 171 L124 178 L110 185 L96 178 Z" fill="url(#lpTopBlue)" />
          </g>
          <g opacity=".92">
            <path d="M441 151 L452 156.5 L452 170 L441 164.5 Z" fill="url(#lpLeft)" />
            <path d="M463 151 L452 156.5 L452 170 L463 164.5 Z" fill="url(#lpRight)" />
            <path d="M452 145.5 L463 151 L452 156.5 L441 151 Z" fill="url(#lpTopBlue)" />
          </g>
        </svg>
      </div>
      <div class="login-note">轻量 · 单镜像 · 非 root 运行</div>
    </aside>

    <main class="login-main">
      <div class="login-card">
        <div class="login-head">
          <div class="login-compact-brand"><span class="mark">K</span><span>KubePanel</span></div>
          <h2>欢迎回来</h2>
          <p>登录以继续管理你的集群</p>
        </div>
        <el-form :model="form" @keyup.enter="submit">
          <label class="login-label" for="login-username">用户名</label>
          <el-input
            id="login-username"
            v-model="form.username"
            class="login-field"
            placeholder="请输入用户名"
            size="large"
            :prefix-icon="User"
            autocomplete="username"
            @input="errorMsg = ''"
          />
          <label class="login-label" for="login-password">密码</label>
          <el-input
            id="login-password"
            v-model="form.password"
            class="login-field"
            placeholder="请输入密码"
            size="large"
            :prefix-icon="Lock"
            type="password"
            show-password
            autocomplete="current-password"
            @input="errorMsg = ''"
          />
          <div v-if="errorMsg" class="login-error" role="alert">
            <el-icon><WarningFilled /></el-icon>
            <span>{{ errorMsg }}</span>
          </div>
          <el-button type="primary" size="large" class="login-btn" :loading="loading" @click="submit">登 录</el-button>
        </el-form>
      </div>
    </main>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { WarningFilled, User, Lock } from '@element-plus/icons-vue'
import api from '../api'
import { saveSession, landingPath, canSee } from '../utils/perm'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const errorMsg = ref('')
const form = reactive({ username: 'admin', password: '' })

async function submit() {
  if (loading.value) return
  errorMsg.value = ''
  if (!form.username || !form.password) {
    errorMsg.value = '请输入用户名和密码'
    return
  }
  loading.value = true
  try {
    const data = await api.login(form.username, form.password)
    saveSession(data)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    // 目标页越权时退回该账号的落地页，避免登录后立刻 403
    const target = redirect && canForPath(redirect) ? redirect : landingPath()
    router.push(target)
  } catch (e) {
    // 账号或密码错误（401）由后端给出文案，其他失败兜底成网络异常提示
    errorMsg.value = e?.status
      ? String(e.message || '登录失败，请重试').slice(0, 200)
      : '无法连接服务器，请检查网络后重试'
  } finally {
    loading.value = false
  }
}

/** 粗略判断跳转目标是否在权限范围内 */
function canForPath(path) {
  if (path.startsWith('/clusters') || path.startsWith('/c/')) return canSee('cluster')
  if (path.startsWith('/registries')) return canSee('registry')
  if (path.startsWith('/users') || path.startsWith('/roles')) return canSee('user')
  if (path.startsWith('/monitor')) return canSee('monitor')
  return true
}
</script>
