<template>
  <el-dialog
    class="yaml-resource-dialog"
    :model-value="modelValue" :title="dialogTitle" :width="width" top="4vh"
    destroy-on-close :before-close="beforeClose" @update:model-value="v => emit('update:modelValue',v)" @closed="reset"
  >
    <p v-if="target" class="kp-mono yaml-target">{{ target }}</p>
    <div class="yaml-bar">
      <YamlViewToggle v-model="viewMode" :disabled="saving || checking || importing || diffOpen || editing" />
      <el-button v-if="canEdit" size="small" :disabled="saving || checking" :loading="importing" @click="pickFile">导入 YAML</el-button>
      <el-button size="small" :disabled="!!preview.error" @click="downloadFile">导出 YAML</el-button>
      <input ref="fileInput" type="file" accept=".yaml,.yml,.txt" style="display:none" @change="onFileChange" />
      <span style="flex:1" />
      <el-tag disable-transitions v-if="!editing" type="info" size="small" effect="plain">{{ canEdit && !importing ? '只读 · 双击可编辑' : '只读' }}</el-tag>
      <el-tag disable-transitions v-else type="warning" size="small" effect="plain">{{ compact ? '编辑中 · 精简' : '编辑中' }}</el-tag>
    </div>
    <slot name="toolbar" />
    <el-alert v-if="preview.error" :title="preview.error" type="warning" :closable="false" style="margin-bottom:10px" />
    <div v-if="diffOpen" class="yaml-compare"><YamlDiff :before="content" :after="text" /></div>
    <textarea v-else
      :value="workingText" class="kp-yaml" spellcheck="false" aria-label="资源 YAML" :readonly="!editing || importing"
      :class="{ 'is-readonly': !editing }"
      :title="dblHint"
      @input="updateText"
      @dblclick="onDblClick"
    />
    <el-alert v-if="error" :title="error" type="error" :closable="false" style="margin-top:10px" />
    <template #footer>
      <div class="yaml-footer" style="display:flex;align-items:center;gap:8px;width:100%">
        <span class="kp-muted yaml-count">{{ workingText.split('\n').length }} 行 · {{ workingText.length }} 字符</span>
        <el-button v-if="editing && !editingCompact" :type="diffOpen ? 'primary' : 'default'" plain :disabled="importing || saving" :aria-pressed="diffOpen" @click="toggleDiff">{{ diffOpen ? '返回编辑' : '差异对比' }}</el-button>
        <span class="yaml-footer-spacer" style="flex:1" />
        <template v-if="editing">
          <el-button @click="cancelEdit">{{ canGoBackToView ? '取消编辑' : '取消' }}</el-button>
          <el-button :loading="checking" :disabled="importing || saving" @click="check">服务端预检</el-button>
          <el-button type="primary" :loading="saving" :disabled="importing || checking || (preflight && checkedText !== submitText)" @click="save">{{ submitLabel }}</el-button>
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
import { loadAll, dump } from 'js-yaml'
import { registerUnsavedGuard } from '../utils/navigation'
import { EditPen } from '@element-plus/icons-vue'
import YamlViewToggle from './YamlViewToggle.vue'
import YamlDiff from './YamlDiff.vue'
import { yamlPreview } from '../utils/yaml-preview'
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
  width: { type: String, default: '92%' },
})
const emit = defineEmits(['update:modelValue', 'save'])

const text = ref(props.content)
const viewMode = ref('full')
const compact = computed(() => viewMode.value === 'compact')
const preview = computed(() => yamlPreview(text.value, compact.value))
const editing = ref(!props.readonly && props.mode !== 'view')
const canEdit = computed(() => !props.readonly)
/* 精简 YAML 也能就地编辑：编辑时用独立草稿，避免每次按键都重新生成精简文本 */
const compactDraft = ref('')
const compactBaseline = ref('')
const editingCompact = computed(() => editing.value && compact.value)
const workingText = computed(() => editingCompact.value ? compactDraft.value : preview.value.text)
const dirty = computed(() => editingCompact.value ? compactDraft.value !== compactBaseline.value : (editing.value && text.value !== props.content))
/* 精简视图按设计隐藏了 resourceVersion，但服务端更新强制要求它；提交时从原始完整对象补回 */
const submitText = computed(() => {
  if (!editingCompact.value) return workingText.value
  try {
    const live = loadAll(props.content).find(doc => doc && typeof doc === 'object')
    const rv = live?.metadata?.resourceVersion
    if (!rv) return workingText.value
    const docs = loadAll(workingText.value).filter(doc => doc && typeof doc === 'object')
    if (!docs.length) return workingText.value
    return docs.map(doc => dump({
      ...doc,
      metadata: {
        ...(doc.metadata || {}),
        ...(doc.metadata?.resourceVersion ? {} : { resourceVersion: rv }),
        ...(doc.metadata?.uid || !live.metadata?.uid ? {} : { uid: live.metadata.uid }),
      },
    }, { noRefs: true, lineWidth: 120 })).join('---\n')
  } catch { return workingText.value }
})
const checkedText = ref(null)
const checking = ref(false)
const importing = ref(false)
const diffOpen = ref(false)
let importEpoch = 0
const error = ref('')
const fileInput = ref(null)
const removeGuard=registerUnsavedGuard(async()=>{ if (!props.modelValue) return true; if (props.saving || checking.value || importing.value) return false; if(!await confirmDiscard())return false; emit('update:modelValue',false); return true })

const dialogTitle = computed(() => {
  if (editingCompact.value) return '编辑（精简）· ' + props.title.replace(/^(查看|编辑)\s*/, '')
  if (compact.value) return '精简预览 · ' + props.title.replace(/^(查看|编辑)\s*/, '')
  if (editing.value) return props.title.replace(/^查看\s*/, '编辑 ')
  return props.title.replace(/^编辑\s*/, '查看 ')
})
const canGoBackToView = computed(() => props.mode === 'view')
/** 只读态的双击提示；完整/精简都可以就地双击进入编辑 */
const dblHint = computed(() => {
  if (!canEdit.value || importing.value || editing.value) return ''
  return compact.value ? '双击编辑精简 YAML' : '双击进入编辑'
})

function seedCompactDraft() { compactBaseline.value = preview.value.text; compactDraft.value = preview.value.text; checkedText.value = null }
watch(() => props.content, v => { importEpoch++; text.value = v; compactDraft.value=''; compactBaseline.value=''; diffOpen.value=false; checkedText.value=null })
watch(() => props.modelValue, open => {
  importEpoch++
  if (open) {
    text.value = props.content
    viewMode.value = 'full'
    diffOpen.value=false
    editing.value = !props.readonly && props.mode !== 'view'
    checkedText.value=null; error.value=''; compactDraft.value=''; compactBaseline.value=''
  }
})
function reset() { importEpoch++; text.value=props.content; viewMode.value='full'; diffOpen.value=false; editing.value=!props.readonly && props.mode !== 'view'; checkedText.value=null; error.value=''; compactDraft.value=''; compactBaseline.value='' }
function toggleDiff() { if (editingCompact.value) return; viewMode.value='full'; diffOpen.value=!diffOpen.value }
function updateText(event) {
  if (!editing.value || importing.value) return
  if (compact.value) compactDraft.value = event.target.value
  else text.value = event.target.value
}
async function check() {
  checking.value=true; error.value=''
  const snapshot=submitText.value, target=props.target
  try { if (props.preflight) await props.preflight(snapshot); if (snapshot!==submitText.value || target!==props.target) return; checkedText.value=snapshot; ElMessage.success('服务端预检通过，请核对差异后提交') }
  catch(e) { error.value=e.message || '预检失败' }
  finally { checking.value=false }
}
function save() { if (!props.readonly && !importing.value && !checking.value && (!props.preflight || checkedText.value===submitText.value)) emit('save',submitText.value) }
function startEdit() {
  if (props.readonly || editing.value) return
  if (compact.value) seedCompactDraft()
  editing.value = true
}
/** 只读预览下双击内容区即进入编辑；精简 YAML 也在原地编辑（独立草稿），不再跳转到完整 YAML */
function onDblClick() {
  if (!canEdit.value || importing.value || editing.value) return
  startEdit()
}
async function confirmDiscard() {
  if (!dirty.value) return true
  try { await ElMessageBox.confirm('编辑内容尚未保存，确定放弃修改？','未保存的修改',{type:'warning'}); return true } catch { return false }
}
async function requestClose() { if (!props.saving && !importing.value && await confirmDiscard()) emit('update:modelValue',false) }
async function beforeClose(done) { if (!props.saving && !importing.value && await confirmDiscard()) done() }
async function cancelEdit() {
  if (props.saving || importing.value || checking.value) return
  if (!await confirmDiscard()) return
  compactDraft.value=''; compactBaseline.value=''; checkedText.value=null
  if (canGoBackToView.value) { text.value=props.content; viewMode.value='full'; diffOpen.value=false; editing.value=false }
  else emit('update:modelValue',false)
}
function beforeUnload(event) { if (props.modelValue && dirty.value) { event.preventDefault(); event.returnValue='' } }
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

function downloadFile() {
  const safe = String(props.title || 'resource').replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 80)
  const blob = new Blob([workingText.value], { type: 'text/yaml;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${safe}${compact.value ? '.simplified' : ''}.yaml`
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<style scoped>
.yaml-count { font-size: 12px; }
.yaml-bar {
  display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap;
}
.yaml-bar .el-button + .el-button { margin-left: 0; }
/* 默认大窗口；编辑区自适应，错误提示与页脚始终可见。 */
:global(.yaml-resource-dialog) { display: flex; flex-direction: column; max-width: 1680px; height: 88dvh; }
:global(.yaml-resource-dialog .el-dialog__body) { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: hidden; }
:global(.yaml-resource-dialog .el-dialog__header), :global(.yaml-resource-dialog .el-dialog__footer) { flex-shrink: 0; }
.yaml-target, .yaml-bar, .el-alert { flex: 0 0 auto; }
.kp-yaml, .yaml-compare { flex: 1 1 auto; height: auto; min-height: 160px; max-height: none; }
@media (max-width: 640px) {
  .yaml-footer { flex-wrap: wrap; justify-content: flex-end; }
  .yaml-count { flex-basis: 100%; text-align: left; }
  .yaml-footer-spacer { display: none; }
}
.kp-yaml.is-readonly { background: #fbfcfe; color: #334155; }
</style>
