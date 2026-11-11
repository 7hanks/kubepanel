<template>
  <el-dialog
    :model-value="modelValue" title="修改登录密码" width="440px" top="6vh"
    destroy-on-close :close-on-click-modal="false"
    @update:model-value="v => emit('update:modelValue', v)"
  >
    <div class="pwd-head">
      <span class="pwd-avatar"><el-icon><UserFilled /></el-icon></span>
      <div class="pwd-head-text">
        <div class="pwd-user">{{ profile.username || 'admin' }}</div>
        <div class="pwd-source">
          密码来源：{{ profile.passwordSource === 'file' ? '已自定义（保存于数据目录）' : '环境变量 DASHBOARD_PASSWORD' }}
          <template v-if="profile.passwordUpdatedAt"> · {{ fmtTime(profile.passwordUpdatedAt) }} 更新</template>
        </div>
      </div>
    </div>

    <el-form label-position="top" class="pwd-form" @submit.prevent>
      <el-form-item label="当前密码">
        <el-input v-model="form.current" type="password" show-password autocomplete="current-password" placeholder="请输入当前登录密码" />
      </el-form-item>
      <el-form-item label="新密码">
        <el-input v-model="form.next" type="password" show-password autocomplete="new-password" placeholder="至少 8 位，含大写/小写/数字/符号中至少两类" />
        <div v-if="form.next" class="pwd-strength">
          <span v-for="i in 4" :key="i" class="pwd-bar" :class="i <= strength.score ? `lv${strength.score}` : ''" />
          <span class="pwd-strength-text" :class="`lv${strength.score}`">{{ strength.text }}</span>
        </div>
      </el-form-item>
      <el-form-item label="确认新密码" :error="confirmError">
        <el-input v-model="form.confirm" type="password" show-password autocomplete="new-password" placeholder="再次输入新密码" @keyup.enter="submit" />
      </el-form-item>
    </el-form>

    <el-alert type="warning" :closable="false" class="pwd-tip">
      <template #default>
        改完后<strong>环境变量里的初始密码立即失效</strong>；密码以 scrypt 哈希保存在数据目录，需挂载持久卷。保存成功会退回登录页。
      </template>
    </el-alert>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canSubmit" @click="submit">保存并重新登录</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { UserFilled } from '@element-plus/icons-vue'
import api from '../api'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'success'])

const form = reactive({ current: '', next: '', confirm: '' })
const saving = ref(false)
const profile = reactive({ username: '', passwordSource: 'env', passwordUpdatedAt: null })

function reset() {
  form.current = ''
  form.next = ''
  form.confirm = ''
}

async function loadProfile() {
  try {
    const p = await api.profile()
    profile.username = p.username
    profile.passwordSource = p.passwordSource
    profile.passwordUpdatedAt = p.passwordUpdatedAt
  } catch (e) { /* 拿不到就按默认显示 */ }
}

watch(() => props.modelValue, open => { if (open) { reset(); loadProfile() } })

const strength = computed(() => {
  const p = form.next || ''
  if (!p) return { score: 0, text: '' }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(re => re.test(p)).length
  let score = 0
  if (p.length >= 8) score++
  if (p.length >= 12) score++
  if (classes >= 2) score++
  if (classes >= 3) score++
  score = Math.min(4, Math.max(p.length >= 8 && classes >= 2 ? 1 : 0, score))
  return { score, text: ['', '弱', '一般', '较强', '很强'][score] || '' }
})

const confirmError = computed(() =>
  form.confirm && form.confirm !== form.next ? '两次输入的新密码不一致' : ''
)

const canSubmit = computed(() =>
  !!form.current && form.next.length >= 8 && form.confirm === form.next && form.next !== form.current
)

function fmtTime(v) {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function submit() {
  if (!canSubmit.value || saving.value) return
  saving.value = true
  try {
    const r = await api.changePassword(form.current, form.next)
    ElMessage.success(r.message || '密码已更新')
    emit('update:modelValue', false)
    emit('success')
  } catch (e) {
    // 拦截器已弹出错误信息，这里只需要把焦点留在弹窗
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.pwd-head {
  display: flex; align-items: center; gap: 10px;
  padding: 0 0 12px; border-bottom: 1px solid var(--kp-border); margin-bottom: 14px;
}
.pwd-avatar {
  width: 34px; height: 34px; border-radius: 9px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--kp-brand-soft); color: var(--kp-brand); font-size: 15px;
}
.pwd-head-text { min-width: 0; }
.pwd-user { font-size: 13.5px; font-weight: 600; color: var(--kp-text); line-height: 1.3; }
.pwd-source { font-size: 11.5px; color: var(--kp-muted); margin-top: 2px; line-height: 1.45; }
.pwd-form :deep(.el-form-item) { margin-bottom: 12px; }
.pwd-form :deep(.el-form-item__label) { font-size: 12px; color: var(--kp-text-2); padding-bottom: 3px; line-height: 1.4; }
.pwd-form :deep(.el-input__wrapper) { padding: 1px 11px; }
.pwd-strength { display: flex; align-items: center; gap: 5px; width: 100%; margin-top: 6px; }
.pwd-bar {
  height: 4px; flex: 1; border-radius: 2px; background: var(--kp-border);
  transition: background .18s;
}
.pwd-bar.lv1 { background: #ef4444; }
.pwd-bar.lv2 { background: #f59e0b; }
.pwd-bar.lv3 { background: #10b981; }
.pwd-bar.lv4 { background: #059669; }
.pwd-strength-text { font-size: 11.5px; width: 34px; text-align: right; color: var(--kp-muted); }
.pwd-strength-text.lv1 { color: #ef4444; }
.pwd-strength-text.lv2 { color: #d97706; }
.pwd-strength-text.lv3 { color: #059669; }
.pwd-strength-text.lv4 { color: #047857; }
.pwd-tip { font-size: 11.5px; line-height: 1.55; }
.pwd-tip.el-alert { padding: 7px 10px; }
.pwd-tip :deep(.el-alert__content) { padding: 0; }

/* 压缩弹窗本体留白，保证 900×520 这类矮视口下页脚按钮也在可视区 */
:deep(.el-dialog__header) { padding-bottom: 12px; margin-right: 0; }
:deep(.el-dialog__body) { padding-top: 2px; padding-bottom: 4px; }
:deep(.el-dialog__footer) { padding-top: 12px; }
</style>
