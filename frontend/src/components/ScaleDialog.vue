<template>
  <el-dialog
    :model-value="modelValue" :title="`扩缩容 · ${name}`" width="min(440px,94vw)" top="16vh"
    destroy-on-close :before-close="beforeClose" @update:model-value="v => {if(!saving&&!loading)emit('update:modelValue', v)}"
  >
    <p v-if="context" class="scale-context">{{context}}</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="scale-error"><el-button :disabled="saving||loading" link @click="emit('retry')">重新读取</el-button></el-alert>
    <div v-loading="loading">
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
      <el-button size="large" circle :disabled="saving||loading||!!error||target <= 0" aria-label="减少副本" @click="target = Math.max(0, target - 1)">
        <el-icon><Minus /></el-icon>
      </el-button>
      <el-input-number v-model="target" class="scale-value" :controls="false" :min="0" :max="999" :precision="0" :disabled="saving||loading||!!error" aria-label="目标副本数"/>
      <el-button size="large" circle :disabled="saving||loading||!!error||target>=999" aria-label="增加副本" @click="target = Math.min(999, target + 1)">
        <el-icon><Plus /></el-icon>
      </el-button>
    </div>

    <div class="scale-presets">
      <span class="scale-label">快捷设置</span>
      <el-button
        v-for="n in presets" :key="n" :class="{ 'is-current': target === n }"
        :disabled="saving||loading||!!error" :aria-pressed="target===n" size="small" @click="target = n"
      >{{ n }}</el-button>
    </div>
    </div>
    <template #footer>
      <el-button :disabled="saving||loading" @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="loading||!!error||target === current||!Number.isInteger(target)" @click="emit('save', target)">
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
  loading:Boolean,
  error:String,
  context:String,
})
const emit = defineEmits(['update:modelValue', 'save','retry'])
const presets = [0, 1, 2, 3, 5, 10]
const target = ref(props.current)

watch(() => props.modelValue, open => { if (open) target.value = props.current })
watch(() => props.current, v => { target.value = v })
function beforeClose(done){if(!props.saving&&!props.loading)done()}
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
  width:110px; text-align: center; font-size: 37px; font-weight: 650;
  letter-spacing: -.04em; color: var(--kp-text); font-variant-numeric: tabular-nums;
}
.scale-value :deep(.el-input__wrapper){box-shadow:none;background:transparent;padding:0}.scale-value :deep(.el-input__inner){font-size:37px;font-weight:650;height:54px;line-height:54px;color:var(--kp-text)}.scale-context{color:var(--kp-muted);font-size:13px;margin:0 0 18px;text-align:center}.scale-error{margin-bottom:16px}.scale-presets .el-button{min-width:30px;margin:0;padding:5px 8px}.scale-presets .el-button.is-current{color:var(--kp-brand);border-color:var(--kp-brand);background:var(--kp-side-active)}
.scale-presets { display: flex; align-items: center; justify-content: center; gap: 7px; flex-wrap: wrap; }
.scale-presets .el-tag { cursor: pointer; transition: all .14s; }
.scale-presets .el-tag:hover { border-color: var(--kp-brand); color: var(--kp-brand); }
.scale-presets .el-tag.is-current { background: var(--kp-brand-soft); border-color: var(--kp-brand-border); color: var(--kp-brand); font-weight: 600; }
.scale-tip { margin-top: 20px; font-size: 12px; line-height: 1.6; }
</style>
