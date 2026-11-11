<template>
  <div class="login-page">
    <aside class="login-visual">
      <div class="login-brand"><span class="mark">K</span><span>KubePanel</span></div>
      <div class="login-headline">
        <h1>Kubernetes<br />多集群管理</h1>
        <p>统一查看集群状态、排查工作负载、编辑资源与常用运维操作。</p>
      </div>
      <div class="login-art" aria-hidden="true">
        <svg viewBox="0 0 560 460" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="lwRing" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#93c5fd" /><stop offset="52%" stop-color="#60a5fa" /><stop offset="100%" stop-color="#6366f1" />
            </linearGradient>
            <linearGradient id="lwBadge" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#3b82f6" /><stop offset="100%" stop-color="#4f46e5" />
            </linearGradient>
            <radialGradient id="lwGlow" cx="50%" cy="48%" r="52%">
              <stop offset="0%" stop-color="#dbeafe" stop-opacity=".9" />
              <stop offset="100%" stop-color="#dbeafe" stop-opacity="0" />
            </radialGradient>
            <radialGradient id="lwNodeGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#bfdbfe" stop-opacity=".9" />
              <stop offset="100%" stop-color="#bfdbfe" stop-opacity="0" />
            </radialGradient>
          </defs>

          <ellipse cx="280" cy="222" rx="238" ry="204" fill="url(#lwGlow)" />

          <!-- 外圈刻度环 -->
          <circle cx="280" cy="222" r="186" fill="none" stroke="#dbe7fb" stroke-width="1.2" stroke-dasharray="2 10" />

          <!-- 六边形主体（集群拓扑） -->
          <path d="M280 76 L406 148 L406 296 L280 368 L154 296 L154 148 Z"
                fill="rgba(255,255,255,.46)" stroke="url(#lwRing)" stroke-width="2.2" stroke-linejoin="round" />

          <!-- 中心到各节点的辐条 -->
          <g stroke="#c3d8fa" stroke-width="1.5" opacity=".95">
            <path d="M280 222 L280 76" /><path d="M280 222 L406 148" /><path d="M280 222 L406 296" />
            <path d="M280 222 L280 368" /><path d="M280 222 L154 296" /><path d="M280 222 L154 148" />
          </g>

          <!-- 节点外光晕 -->
          <g fill="url(#lwNodeGlow)">
            <circle cx="280" cy="76" r="30" /><circle cx="406" cy="148" r="30" /><circle cx="406" cy="296" r="30" />
            <circle cx="280" cy="368" r="30" /><circle cx="154" cy="296" r="30" /><circle cx="154" cy="148" r="30" />
          </g>

          <!-- 节点 -->
          <g fill="#fff" stroke="url(#lwRing)" stroke-width="2.4">
            <circle cx="280" cy="76" r="14" /><circle cx="406" cy="148" r="14" /><circle cx="406" cy="296" r="14" />
            <circle cx="280" cy="368" r="14" /><circle cx="154" cy="296" r="14" /><circle cx="154" cy="148" r="14" />
          </g>
          <g>
            <circle cx="280" cy="76" r="5.5" fill="#34d399" />
            <circle cx="406" cy="296" r="5.5" fill="#60a5fa" />
            <circle cx="154" cy="148" r="5.5" fill="#818cf8" />
            <circle cx="280" cy="368" r="5.5" fill="#38bdf8" opacity=".9" />
          </g>

          <!-- 中心徽章 -->
          <g>
            <rect x="246" y="188" width="68" height="68" rx="20" fill="url(#lwBadge)" />
            <rect x="246" y="188" width="68" height="68" rx="20" fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="1.4" />
            <path d="M280 207 L293 214.5 L293 229.5 L280 237 L267 229.5 L267 214.5 Z"
                  fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round" />
          </g>

          <!-- 点缀 -->
          <g fill="#93c5fd">
            <circle cx="212" cy="112" r="2.6" opacity=".8" />
            <circle cx="462" cy="206" r="2.6" opacity=".7" />
            <circle cx="352" cy="392" r="2.6" opacity=".7" />
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
