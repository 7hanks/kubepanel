<template>
  <el-dialog
    class="yaml-resource-dialog"
    :model-value="modelValue" :title="dialogTitle" :width="full ? '96%' : width" top="5vh"
    destroy-on-close :before-close="beforeClose" @update:model-value="v => emit('update:modelValue',v)" @closed="reset"
  >
    <p v-if="target" class="kp-mono">{{ target }}</p>
    <div class="yaml-bar">
      <YamlViewToggle v-model="viewMode" :disabled="saving || checking || importing || diffOpen" />
      <el-button v-if="canEdit" size="small" :icon="Upload" :disabled="saving || checking" :loading="importing" @click="pickFile">导入 YAML</el-button>
      <el-button size="small" :icon="CopyDocument" :disabled="!!preview.error" @click="copyAll">复制</el-button>
      <el-button size="small" :icon="Download" :disabled="!!preview.error" @click="downloadFile">导出 YAML</el-button>
      <el-button size="small" :icon="full ? Aim : FullScreen" @click="full = !full">{{ full ? '还原窗口' : '全屏' }}</el-button>
      <input ref="fileInput" type="file" accept=".yaml,.yml,.txt" style="display:none" @change="onFileChange" />
      <span style="flex:1" />
      <el-tag disable-transitions v-if="compact || !editing" type="info" size="small" effect="plain">只读</el-tag>
      <el-tag disable-transitions v-else type="warning" size="small" effect="plain">编辑中</el-tag>
    </div>
    <slot name="toolbar" />
    <el-alert v-if="preview.error" :title="preview.error" type="warning" :closable="false" style="margin-bottom:10px" />
    <div v-if="diffOpen" class="yaml-compare" :class="{'is-full': full}"><YamlDiff :before="content" :after="text" /></div>
    <textarea v-else
      :value="preview.text" class="kp-yaml" spellcheck="false" aria-label="资源 YAML" :readonly="compact || !editing || importing"
      :class="{ 'is-readonly': compact || !editing }"
      :title="!compact && !editing && canEdit ? '双击进入编辑' : ''"
      @input="updateText"
      :style="full ? { minHeight: 'calc(100vh - 250px)', height: 'calc(100vh - 250px)', maxHeight: 'none' } : {}"
      @dblclick="onDblClick"
    />
    <el-alert v-if="error" :title="error" type="error" :closable="false" style="margin-top:10px" />
    <template #footer>
      <div class="yaml-footer" style="display:flex;align-items:center;gap:8px;width:100%">
        <span class="kp-muted yaml-count">{{ preview.text.split('\n').length }} 行 · {{ preview.text.length }} 字符</span>
        <el-button v-if="editing" :type="diffOpen ? 'primary' : 'default'" plain :disabled="importing || saving" :aria-pressed="diffOpen" @click="toggleDiff">{{ diffOpen ? '返回编辑' : '差异对比' }}</el-button>
        <span class="yaml-footer-spacer" style="flex:1" />
        <template v-if="editing">
          <el-button @click="cancelEdit">{{ canGoBackToView ? '取消编辑' : '取消' }}</el-button>
          <el-button v-if="compact" type="primary" @click="viewMode = 'full'">返回完整 YAML 编辑</el-button>
          <template v-else>
            <el-button :loading="checking" :disabled="importing || saving" @click="check">服务端预检</el-button>
            <el-button type="primary" :loading="saving" :disabled="importing || checking || (preflight && checkedText !== text)" @click="save">{{ submitLabel }}</el-button>
          </template>
        </template>
        <template v-else>
          <el-button @click="requestClose">关闭</el-button>
          <el-button v-if="!readonly" type="primary" :icon="EditPen" @click="startEdit">编辑</el-button>
        </template>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { registerUnsavedGuard } from '../utils/navigation'
import { Upload, Download, FullScreen, Aim, EditPen, CopyDocument } from '@element-plus/icons-vue'
import YamlViewToggle from './YamlViewToggle.vue'
import YamlDiff from './YamlDiff.vue'
import { yamlPreview } from '../utils/yaml-preview'
import { copyText } from '../utils/clipboard'
import { importYamlDraft, MAX_YAML_IMPORT_BYTES } from '../utils/yaml-import'

/**
 * mode: 'view' 只读查看（详情/列表点 YAML），'edit' 直接进入编辑（新建、编辑入口）
 * readonly: 永久只读，连「编辑」按钮都不给（如某些内置对象查看）
 */
const props = defineProps({
  modelValue: Boolean,
  target: String,
  preflight: Function,
  title: { type: String, default: 'YAML' },
  content: { type: String, default: '' },
  creating: Boolean,
  mode: { type: String, default: 'edit' },
  readonly: Boolean,
  submitLabel: { type: String, default: '保存' },
  saving: Boolean,
  width: { type: String, default: '800px' },
})
const emit = defineEmits(['update:modelValue', 'save'])

const text = ref(props.content)
const viewMode = ref('full')
const compact = computed(() => viewMode.value === 'compact')
const preview = computed(() => yamlPreview(text.value, compact.value))
const full = ref(false)
const editing = ref(!props.readonly && props.mode !== 'view')
const canEdit = computed(() => !props.readonly)
const checkedText = ref(null)
const checking = ref(false)
const importing = ref(false)
const diffOpen = ref(false)
let importEpoch = 0
const error = ref('')
const fileInput = ref(null)
const removeGuard=registerUnsavedGuard(async()=>{ if (!props.modelValue) return true; if (props.saving || checking.value || importing.value) return false; if(!await confirmDiscard())return false; emit('update:modelValue',false); return true })

const dialogTitle = computed(() => {
  if (compact.value) return '精简预览 · ' + props.title.replace(/^(查看|编辑)\s*/, '')
  if (editing.value) return props.title.replace(/^查看\s*/, '编辑 ')
  return props.title.replace(/^编辑\s*/, '查看 ')
})
const canGoBackToView = computed(() => props.mode === 'view')

watch(() => props.content, v => { importEpoch++; text.value = v; diffOpen.value=false; checkedText.value=null })
watch(() => props.modelValue, open => {
  importEpoch++
  if (open) {
    text.value = props.content
    viewMode.value = 'full'
    full.value = false
    diffOpen.value=false
    editing.value = !props.readonly && props.mode !== 'view'
    checkedText.value=null; error.value=''
  }
})
function reset() { importEpoch++; text.value=props.content; viewMode.value='full'; diffOpen.value=false; full.value=false; editing.value=!props.readonly && props.mode !== 'view'; checkedText.value=null; error.value='' }
function toggleDiff() { viewMode.value='full'; diffOpen.value=!diffOpen.value }
function updateText(event) { if (editing.value && !compact.value) text.value = event.target.value }
async function check() {
  checking.value=true; error.value=''
  const snapshot=text.value, target=props.target
  try { if (props.preflight) await props.preflight(snapshot); if (snapshot!==text.value || target!==props.target) return; checkedText.value=snapshot; ElMessage.success('服务端预检通过，请核对差异后提交') }
  catch(e) { error.value=e.message || '预检失败' }
  finally { checking.value=false }
}
function save() { if (!compact.value && !props.readonly && !importing.value && !checking.value && (!props.preflight || checkedText.value===text.value)) emit('save',text.value) }
function startEdit() { if (!props.readonly) { viewMode.value='full'; editing.value=true } }
/** 只读预览下双击内容区 = 点「编辑」，快速进入编辑态；永久只读时不生效 */
function onDblClick() { if (!compact.value && !editing.value) startEdit() }
async function confirmDiscard() {
  if (!editing.value || text.value===props.content) return true
  try { await ElMessageBox.confirm('编辑内容尚未保存，确定放弃修改？','未保存的修改',{type:'warning'}); return true } catch { return false }
}
async function requestClose() { if (!props.saving && !importing.value && await confirmDiscard()) emit('update:modelValue',false) }
async function beforeClose(done) { if (!props.saving && !importing.value && await confirmDiscard()) done() }
async function cancelEdit() {
  if (props.saving || importing.value || checking.value) return
  if (!await confirmDiscard()) return
  if (canGoBackToView.value) { text.value=props.content; viewMode.value='full'; diffOpen.value=false; editing.value=false; checkedText.value=null }
  else emit('update:modelValue',false)
}
function beforeUnload(event) { if (props.modelValue && editing.value && text.value!==props.content) { event.preventDefault(); event.returnValue='' } }
onMounted(()=>window.addEventListener('beforeunload',beforeUnload))
onUnmounted(()=>{removeGuard();window.removeEventListener('beforeunload',beforeUnload)})

function pickFile() { if (canEdit.value && !props.saving && !checking.value && !importing.value) fileInput.value?.click() }
async function onFileChange(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (!canEdit.value || props.saving || checking.value || importing.value) return
  const epoch=++importEpoch, baseline=props.content, target=props.target
  const current=()=>epoch===importEpoch && props.modelValue && baseline===props.content && target===props.target
  importing.value=true
  try {
    if(file.size>MAX_YAML_IMPORT_BYTES) throw new Error('YAML 文件不能超过 2 MiB')
    const imported=importYamlDraft(await file.text(),baseline,{creating:props.creating})
    if(!current()) return
    if(editing.value && text.value!==baseline) {
      try { await ElMessageBox.confirm('导入将替换当前未保存的内容，是否继续？','导入 YAML',{type:'warning'}) }
      catch { return }
    }
    if(!current()) return
    text.value=imported; viewMode.value='full'; editing.value=true; diffOpen.value=false; checkedText.value=null; error.value=''
    ElMessage.success('已导入 YAML')
  } catch(e) {
    if(current()) error.value=e.message || '读取文件失败'
  } finally {
    importing.value=false
  }
}

async function copyAll() {
  try { await copyText(preview.value.text); ElMessage.success('已复制到剪贴板') }
  catch (error) { ElMessage.error(error.message) }
}

function downloadFile() {
  const safe = String(props.title || 'resource').replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 80)
  const blob = new Blob([preview.value.text], { type: 'text/yaml;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${safe}${compact.value ? '.simplified' : ''}.yaml`
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<style scoped>
.yaml-count { font-size:13px; }
.yaml-compare { height:calc(100dvh - 340px); min-height:180px; max-height:64dvh; }
.yaml-compare.is-full { height:calc(100dvh - 270px); max-height:none; }
.yaml-bar {
  display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap;
}
.yaml-bar .el-button + .el-button { margin-left: 0; }
:global(.yaml-resource-dialog) { display: flex; flex-direction: column; max-height: 90dvh; }
:global(.yaml-resource-dialog .el-dialog__body) { min-height: 0; overflow: auto; }
:global(.yaml-resource-dialog .el-dialog__header), :global(.yaml-resource-dialog .el-dialog__footer) { flex-shrink: 0; }
@media (max-width: 640px) {
  .yaml-footer { flex-wrap: wrap; justify-content: flex-end; }
  .yaml-count { flex-basis: 100%; text-align: left; }
  .yaml-footer-spacer { display: none; }
}
.kp-yaml.is-readonly { background: #fbfcfe; color: #334155; }
/* 让弹窗始终落在视口内：编辑器高度随视口伸缩，避免页脚按钮被挤出屏幕 */
.kp-yaml { height: calc(100vh - 330px); min-height: 180px; max-height: 64vh; }
</style>
