<template>
  <div class="login-page">
    <aside class="login-visual">
      <div class="login-brand"><span class="mark">K</span><span>KubePanel</span></div>
      <div class="login-headline">
        <h1>多集群，<br />尽在掌握<span>。</span></h1>
        <p>Kubernetes 多集群管理平台<br />集中管理集群资源、工作负载与访问权限。</p>
      </div>
      <div class="login-art" aria-hidden="true">
        <svg viewBox="0 0 640 440" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="cluster-top" x1="0" y1="0" x2="1" y2="1">
              <stop stop-color="#fff" /><stop offset="1" stop-color="#e7effc" />
            </linearGradient>
            <linearGradient id="cluster-blue" x1="0" y1="0" x2="1" y2="1">
              <stop stop-color="#5188f8" /><stop offset="1" stop-color="#2563eb" />
            </linearGradient>
            <filter id="cluster-shadow" x="-50%" y="-50%" width="200%" height="230%">
              <feDropShadow dx="0" dy="14" stdDeviation="13" flood-color="#6b8ec7" flood-opacity=".13" />
            </filter>
            <g id="cluster-server">
              <path d="M0 21 66-17 132 21v23L66 82 0 44Z" fill="#dae6f8" stroke="#b8cdec" />
              <path d="m0 21 66 38 66-38M66 59v23" stroke="#b8cdec" />
              <path d="m0 21 66-38 66 38-66 38Z" fill="url(#cluster-top)" stroke="#c2d3ec" stroke-linejoin="round" />
              <path d="M0-11 66-49l66 38v23L66 50 0 12Z" fill="#e4edfa" stroke="#b8cdec" />
              <path d="m0-11 66 38 66-38M66 27v23" stroke="#b8cdec" />
              <path d="m0-11 66-38 66 38-66 38Z" fill="url(#cluster-top)" stroke="#c2d3ec" stroke-linejoin="round" />
              <path d="m43-11 23-13 23 13-23 13Z" fill="#d4e3fc" stroke="#9ebff8" stroke-linejoin="round" />
              <path d="m12 8 20 12m-20 21 20 12" stroke="#a5bce0" stroke-width="3" stroke-linecap="round" />
              <circle cx="116" cy="10" r="3" fill="#38bda3" />
              <circle cx="116" cy="42" r="3" fill="#38bda3" />
            </g>
          </defs>
          <path d="M36 247 310 88l294 170-274 159Z" fill="#edf3fc" />
          <g stroke="#dce6f4" stroke-dasharray="3 7">
            <path d="m86 276 274-159M140 307l274-159M194 338l274-159M248 369l274-159" />
            <path d="m91 215 294 170M146 183l294 170M201 151l294 170M256 119l294 170" />
          </g>
          <g stroke="#8aaff1" stroke-width="2" stroke-linejoin="round">
            <path d="m157 234 156 90 170-98" />
            <path d="m313 324 1-121 105-61" />
            <path d="m157 234 157-91 169 98" stroke-dasharray="5 7" opacity=".55" />
          </g>
          <g fill="#fff" stroke="#8aaff1" stroke-width="2">
            <ellipse cx="313" cy="324" rx="7" ry="4" />
            <ellipse cx="252" cy="289" rx="5" ry="3" />
            <ellipse cx="381" cy="285" rx="5" ry="3" />
          </g>
          <g filter="url(#cluster-shadow)">
            <use href="#cluster-server" x="91" y="167" />
            <use href="#cluster-server" x="353" y="75" />
            <use href="#cluster-server" x="417" y="223" />
          </g>
          <g filter="url(#cluster-shadow)">
            <path d="m262 161 52-30 52 30v46l-52 30-52-30Z" fill="#2563eb" />
            <path d="m262 161 52 30 52-30-52-30Z" fill="url(#cluster-blue)" stroke="#76a2fb" />
            <path d="M314 191v46" stroke="#79a4ff" />
            <g stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="m294 161 20-12 20 12-20 12Z" />
              <path d="m314 149v-7m20 19 7 4m-27 8v7m-20-19-7 4" />
            </g>
          </g>
          <g fill="#c6d7f2">
            <circle cx="129" cy="102" r="4" /><circle cx="529" cy="152" r="4" /><circle cx="220" cy="361" r="4" />
          </g>
        </svg>
      </div>
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
