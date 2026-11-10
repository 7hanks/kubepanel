<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-logo">
        <div class="mark">K</div>
        <div class="login-title">KubePanel</div>
      </div>
      <p class="login-sub">Kubernetes 可视化控制台</p>
      <el-form :model="form" @keyup.enter="submit">
        <el-form-item>
          <el-input
            v-model="form.username"
            placeholder="用户名"
            size="large"
            :prefix-icon="User"
            autocomplete="username"
            @input="errorMsg = ''"
          />
        </el-form-item>
        <el-form-item>
          <el-input
            v-model="form.password"
            placeholder="密码"
            size="large"
            :prefix-icon="Lock"
            type="password"
            show-password
            autocomplete="current-password"
            @input="errorMsg = ''"
          />
        </el-form-item>
        <div v-if="errorMsg" class="login-error" role="alert">
          <el-icon><WarningFilled /></el-icon>
          <span>{{ errorMsg }}</span>
        </div>
        <el-button type="primary" size="large" style="width:100%" :loading="loading" @click="submit">登 录</el-button>
      </el-form>
      <div class="login-tip">
        初始密码由容器环境变量 <code>DASHBOARD_PASSWORD</code> 提供，登录后可在右上角用户菜单里修改。<br />
        K8s 凭据来自挂载的 kubeconfig 或 ServiceAccount，与登录账号无关。
      </div>
    </div>
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
