<template>
  <el-dialog
    :model-value="modelValue" :title="`扩缩容 · ${name}`" width="420px" top="18vh"
    destroy-on-close @update:model-value="v => emit('update:modelValue', v)"
  >
    <div class="scale-head">
      <div class="scale-head-item">
        <span class="scale-label">当前副本</span>
        <span class="scale-old">{{ current }}</span>
      </div>
      <el-icon class="scale-arrow"><Right /></el-icon>
      <div class="scale-head-item">
        <span class="scale-label">目标副本</span>
        <span class="scale-new">{{ target }}</span>
      </div>
    </div>

    <div class="scale-stepper">
      <el-button size="large" circle :disabled="target <= 0" @click="target = Math.max(0, target - 1)">
        <el-icon><Minus /></el-icon>
      </el-button>
      <div class="scale-value">{{ target }}</div>
      <el-button size="large" circle @click="target = Math.min(999, target + 1)">
        <el-icon><Plus /></el-icon>
      </el-button>
    </div>

    <div class="scale-presets">
      <span class="scale-label">快捷设置</span>
      <el-tag
        v-for="n in presets" :key="n" :class="{ 'is-current': target === n }"
        effect="plain" size="small" @click="target = n"
      >{{ n }}</el-tag>
    </div>

    <el-alert type="info" :closable="false" class="scale-tip">
      <template #default>
        调整 <code>spec.replicas</code>，由控制器创建或删除 Pod；设为 0 会停止所有实例但保留工作负载。
      </template>
    </el-alert>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="target === current" @click="emit('save', target)">
        确定{{ target === current ? '' : `（${current} → ${target}）` }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { Minus, Plus, Right } from '@element-plus/icons-vue'

const props = defineProps({
  modelValue: Boolean,
  name: { type: String, default: '' },
  current: { type: Number, default: 0 },
  saving: Boolean,
})
const emit = defineEmits(['update:modelValue', 'save'])
const presets = [0, 1, 2, 3, 5, 10]
const target = ref(props.current)

watch(() => props.modelValue, open => { if (open) target.value = props.current })
watch(() => props.current, v => { target.value = v })
</script>

<style scoped>
.scale-head {
  display: flex; align-items: center; justify-content: center; gap: 22px;
  padding: 6px 0 18px; border-bottom: 1px solid var(--kp-border);
}
.scale-head-item { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 88px; }
.scale-label { font-size: 12px; color: var(--kp-muted); }
.scale-old { font-size: 23px; font-weight: 600; color: var(--kp-muted); letter-spacing: -.02em; }
.scale-new { font-size: 23px; font-weight: 650; color: var(--kp-brand); letter-spacing: -.02em; }
.scale-arrow { font-size: 15px; color: var(--kp-faint); }
.scale-stepper {
  display: flex; align-items: center; justify-content: center; gap: 28px; padding: 24px 0 20px;
}
.scale-stepper .el-button { width: 44px; height: 44px; font-size: 16px; }
.scale-value {
  min-width: 96px; text-align: center; font-size: 37px; font-weight: 650;
  letter-spacing: -.04em; color: var(--kp-text); font-variant-numeric: tabular-nums;
}
.scale-presets { display: flex; align-items: center; justify-content: center; gap: 7px; flex-wrap: wrap; }
.scale-presets .el-tag { cursor: pointer; transition: all .14s; }
.scale-presets .el-tag:hover { border-color: var(--kp-brand); color: var(--kp-brand); }
.scale-presets .el-tag.is-current { background: var(--kp-brand-soft); border-color: var(--kp-brand-border); color: var(--kp-brand); font-weight: 600; }
.scale-tip { margin-top: 20px; font-size: 12px; line-height: 1.6; }
</style>
