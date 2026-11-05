<template>
  <el-dialog
    :model-value="modelValue" :title="dialogTitle" :width="full ? '96%' : width" top="5vh"
    destroy-on-close @update:model-value="v => emit('update:modelValue', v)" @closed="reset"
  >
    <el-alert v-if="shownTip" :title="shownTip" type="info" :closable="false" style="margin-bottom:12px" />
    <div class="yaml-bar">
      <!-- 查看态：不提供导入/保存，必须先点「编辑」 -->
      <el-button v-if="editing" size="small" :icon="Upload" @click="pickFile">导入 .yaml 文件</el-button>
      <el-button size="small" :icon="CopyDocument" @click="copyAll">复制</el-button>
      <el-button size="small" :icon="Download" @click="downloadFile">下载 .yaml</el-button>
      <el-button size="small" :icon="full ? Aim : FullScreen" @click="full = !full">{{ full ? '还原窗口' : '全屏' }}</el-button>
      <input ref="fileInput" type="file" accept=".yaml,.yml,.txt" style="display:none" @change="onFileChange" />
      <span style="flex:1" />
      <el-tag v-if="!editing" type="info" size="small" effect="plain">只读预览</el-tag>
      <span v-else class="kp-muted" style="font-size:12px">编辑中 · 保存等价于 kubectl replace</span>
    </div>
    <slot name="toolbar" />
    <textarea
      v-model="text" class="kp-yaml" spellcheck="false" :readonly="!editing"
      :class="{ 'is-readonly': !editing }"
      :style="full ? { minHeight: 'calc(100vh - 250px)', height: 'calc(100vh - 250px)', maxHeight: 'none' } : {}"
    />
    <template #footer>
      <div style="display:flex;align-items:center;gap:8px;width:100%">
        <span class="kp-muted" style="font-size:12px">{{ text.split('\n').length }} 行 · {{ text.length }} 字符</span>
        <span style="flex:1" />
        <template v-if="editing">
          <el-button @click="cancelEdit">{{ canGoBackToView ? '取消编辑' : '取消' }}</el-button>
          <el-button type="primary" :loading="saving" @click="save">{{ submitLabel }}</el-button>
        </template>
        <template v-else>
          <el-button @click="emit('update:modelValue', false)">关闭</el-button>
          <el-button v-if="!readonly" type="primary" :icon="EditPen" @click="startEdit">编辑</el-button>
        </template>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Upload, Download, FullScreen, Aim, EditPen, CopyDocument } from '@element-plus/icons-vue'

/**
 * mode: 'view' 只读查看（详情/列表点 YAML），'edit' 直接进入编辑（新建、编辑入口）
 * readonly: 永久只读，连「编辑」按钮都不给（如某些内置对象查看）
 */
const props = defineProps({
  modelValue: Boolean,
  title: { type: String, default: 'YAML' },
  content: { type: String, default: '' },
  tip: { type: String, default: '' },
  mode: { type: String, default: 'edit' },
  readonly: Boolean,
  submitLabel: { type: String, default: '保存' },
  saving: Boolean,
  width: { type: String, default: '800px' },
})
const emit = defineEmits(['update:modelValue', 'save'])

const text = ref(props.content)
const full = ref(false)
const editing = ref(props.mode !== 'view')
const fileInput = ref(null)

const dialogTitle = computed(() => {
  if (editing.value) return props.title.replace(/^查看\s*/, '编辑 ')
  return props.title.replace(/^编辑\s*/, '查看 ')
})
/** 从只读切到编辑后，顶部提示要跟着换，否则还写着「点右下角编辑」 */
const shownTip = computed(() => {
  if (editing.value && props.mode === 'view') {
    return '编辑中：保存等价于 kubectl replace，会整体更新该资源；字段非法时 API Server 会拒绝并提示原因。'
  }
  return props.tip
})
const canGoBackToView = computed(() => props.mode === 'view')

watch(() => props.content, v => { text.value = v })
watch(() => props.modelValue, open => {
  if (open) {
    text.value = props.content
    full.value = false
    editing.value = props.mode !== 'view'
  }
})
function reset() { text.value = props.content; full.value = false; editing.value = props.mode !== 'view' }
function save() { emit('save', text.value) }
function startEdit() { editing.value = true }
function cancelEdit() {
  if (canGoBackToView.value) { text.value = props.content; editing.value = false }
  else emit('update:modelValue', false)
}

function pickFile() { fileInput.value?.click() }
function onFileChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    text.value = String(reader.result || '')
    ElMessage.success(`已载入 ${file.name}，检查后点「${props.submitLabel}」提交`)
  }
  reader.onerror = () => ElMessage.error('读取文件失败')
  reader.readAsText(file, 'utf-8')
  e.target.value = ''
}

function copyAll() {
  navigator.clipboard?.writeText(text.value)
    .then(() => ElMessage.success('已复制到剪贴板'))
    .catch(() => ElMessage.error('复制失败，请手动选择文本'))
}

function downloadFile() {
  const safe = String(props.title || 'resource').replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 80)
  const blob = new Blob([text.value], { type: 'text/yaml;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${safe}.yaml`
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<style scoped>
.yaml-bar {
  display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap;
}
.yaml-bar .el-button + .el-button { margin-left: 0; }
.kp-yaml.is-readonly { background: #fbfcfe; color: #334155; }
/* 让弹窗始终落在视口内：编辑器高度随视口伸缩，避免页脚按钮被挤出屏幕 */
.kp-yaml { height: calc(100vh - 330px); min-height: 180px; max-height: 64vh; }
</style>
