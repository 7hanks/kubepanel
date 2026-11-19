<template>
  <el-dialog
    :model-value="true" title="调整镜像版本" class="image-version-dialog" width="min(880px, 94vw)" top="12vh" append-to-body
    :show-close="!saving" :close-on-press-escape="!saving" :close-on-click-modal="false"
    @update:model-value="open => { if (!open && !saving) emit('close') }"
  >
    <div class="image-context">
      <strong>{{ target.name }}</strong>
      <div class="image-context-meta">
        <span>集群 <b>{{ target.clusterName }}</b></span>
        <span>命名空间 <b>{{ target.namespace }}</b></span>
      </div>
    </div>

    <p v-if="loading" class="kp-muted" role="status">正在读取部署的镜像…</p>
    <div v-if="error" class="image-error">
      <el-alert :title="error" type="error" show-icon :closable="false" />
      <el-button v-if="reloadRequired || !rows.length" link type="primary" :disabled="saving || loading" @click="load">重新读取</el-button>
    </div>

    <div v-if="rows.length" class="image-fields">
      <div class="image-field-row image-field-heading" aria-hidden="true">
        <span>容器</span><span>当前镜像</span><span>新版本</span>
      </div>
      <div v-for="{ row, image } in plan" :key="`${row.field}/${row.name}`" class="image-field-row image-container">
        <div class="image-container-name">
          <strong>{{ row.name }}</strong>
          <span>{{ row.field === 'initContainers' ? '初始化容器' : '工作容器' }}</span>
        </div>
        <div class="image-current">
          <span class="image-mobile-label">当前镜像</span>
          <code class="image-reference">{{ row.image }}</code>
        </div>
        <div class="image-version">
          <span class="image-mobile-label">新版本</span>
          <el-input v-model="row.input" :disabled="saving || reloadRequired"
            :aria-label="`${row.name} 的新镜像版本`" :aria-invalid="!image" placeholder="输入标签或摘要" />
          <span v-if="!image" class="image-format-error">请输入有效的镜像标签或 SHA 摘要</span>
          <code v-else-if="image !== row.image" class="image-reference image-reference-next">{{ image }}</code>
        </div>
      </div>
    </div>
    <p v-if="rows.length" class="image-strategy">
      {{ paused ? '部署已暂停，恢复后将按更新策略替换容器组。' : '更新后，Kubernetes 会按部署的更新策略替换容器组。' }}
    </p>

    <template #footer>
      <el-button :disabled="saving" @click="emit('close')">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canSubmit" @click="save">
        {{ phase === 'preflight' ? '正在预检' : phase === 'update' ? '正在更新' : '确认更新' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'
import { deploymentImagePatch, deploymentImageRows, imageWithVersion } from '../utils/deployment-images'
import { registerUnsavedGuard } from '../utils/navigation'
import { canResource } from '../utils/perm'

const props = defineProps({ target: { type: Object, required: true }, contextKey: String })
const emit = defineEmits(['close', 'saved'])
const target = props.target
const openingContext = props.contextKey
const meta = { group: 'apps', version: 'v1', plural: 'deployments', namespaced: true }
const resourceArgs = [meta.group, meta.version, meta.plural, target.namespace, target.name]
const rows = ref([])
const loading = ref(false)
const paused = ref(false)
const phase = ref('')
const error = ref('')
const reloadRequired = ref(false)
let controller
let generation
let disposed = false

const saving = computed(() => !!phase.value)
const plan = computed(() => rows.value.map(row => ({ row, image: imageWithVersion(row, row.input) })))
const changes = computed(() => plan.value.filter(({ row, image }) => image && row.image !== image))
const canSubmit = computed(() => !saving.value && !loading.value && !reloadRequired.value
  && changes.value.length > 0 && plan.value.every(({ image }) => image))
const allowed = () => canResource(meta, 'update', target.namespace, target.clusterId)
const active = () => !disposed && props.contextKey === openingContext
const removeGuard = registerUnsavedGuard(() => !saving.value)

function matchesTarget(resource) {
  const metadata = resource?.metadata
  return metadata?.uid === target.uid && metadata?.name === target.name && metadata?.namespace === target.namespace
}

function matchesImages(resource, expected) {
  if (!matchesTarget(resource)) return false
  const spec = resource.spec?.template?.spec
  return expected.every(({ row, image }) => spec?.[row.field]?.find(container => container.name === row.name)?.image === image)
}

async function load() {
  if (saving.value || !active()) return
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  reloadRequired.value = false
  error.value = ''
  rows.value = []
  try {
    const current = await api.get(...resourceArgs, { params: { clusterId: target.clusterId }, signal: request.signal, silent: true })
    if (!active() || request.signal.aborted) return
    if (!matchesTarget(current)) throw new Error('部署已被替换，请刷新列表并重新选择')
    if (current.metadata.deletionTimestamp) throw new Error('部署正在删除，请刷新列表后核对')
    const containers = deploymentImageRows(current)
    if (target.container) {
      const selected = containers.findIndex(row => row.field === target.container.field && row.name === target.container.name)
      if (selected < 0) throw new Error('所选容器已从部署模板移除，请返回容器操作并刷新')
      if (selected > 0) containers.unshift(...containers.splice(selected, 1))
    }
    rows.value = containers.map(row => ({ ...row, input: row.version }))
    generation = current.metadata.generation
    paused.value = current.spec?.paused === true
  } catch (cause) {
    if (active() && !request.signal.aborted) error.value = cause.message || '无法读取部署镜像'
  } finally {
    if (request === controller) loading.value = false
  }
}

async function save() {
  if (!active() || !canSubmit.value) return
  if (!allowed()) {
    error.value = '当前账号没有此部署的更新权限'
    return
  }
  const expected = changes.value
  const patch = deploymentImagePatch(target.uid, generation, expected)
  const submit = dryRun => api.patch(...resourceArgs, patch, 'json', {
    params: { clusterId: target.clusterId, dryRun }, silent: true,
  })
  phase.value = 'preflight'
  error.value = ''
  try {
    const preview = await submit(true)
    if (!active()) return
    if (!matchesImages(preview, expected)) {
      error.value = '预检返回的镜像与填写的版本不同，请核对集群准入策略'
      return
    }
    if (!allowed()) {
      error.value = '更新权限已变化，请重新打开部署核对'
      return
    }
    phase.value = 'update'
    const updated = await submit(false)
    if (!active()) return
    if (!matchesImages(updated, expected)) {
      reloadRequired.value = true
      error.value = '提交返回的镜像与预检不同，请重新读取后核对'
      return
    }
    ElMessage.success(updated.spec?.paused ? '镜像版本已更新，部署当前已暂停' : '镜像版本已更新，可在部署详情查看更新进度')
    emit('saved')
  } catch (cause) {
    if (!active()) return
    const stale = [404, 409].includes(cause.status) || /test failed|testing value/i.test(cause.message || '')
    const unconfirmed = phase.value === 'update' && (!cause.status || cause.status >= 500 || cause.status === 408)
    reloadRequired.value = stale || unconfirmed
    if (stale) error.value = '部署已变化，请重新读取后再更新'
    else if (unconfirmed) error.value = '更新结果未确认，请重新读取部署核对镜像版本'
    else error.value = cause.message || (phase.value === 'preflight' ? '镜像更新预检失败' : '镜像更新失败')
  } finally {
    phase.value = ''
  }
}

watch(() => props.contextKey, () => emit('close'))
onMounted(load)
onUnmounted(() => {
  disposed = true
  controller?.abort()
  removeGuard()
})
</script>

<style scoped>
.image-context{display:grid;gap:7px;margin:0 0 22px;font-size:13px;line-height:1.6;color:var(--kp-muted);min-width:0}
.image-context>strong{color:var(--kp-text);font-size:16px;font-weight:600;line-height:1.45;overflow-wrap:anywhere}
.image-context-meta{display:flex;flex-wrap:wrap;gap:5px 20px;min-width:0}
.image-context-meta>span{min-width:0;overflow-wrap:anywhere}
.image-context-meta b{font-weight:500;color:var(--kp-text-2)}
.image-fields{border:1px solid var(--kp-border);border-radius:10px;overflow:hidden}
.image-field-row{display:grid;grid-template-columns:minmax(105px,.85fr) minmax(0,1.8fr) minmax(190px,1.35fr);gap:18px;align-items:start;padding:18px 16px}
.image-field-heading{background:var(--kp-surface-2);font-size:13px;font-weight:600;line-height:1.5;color:var(--kp-text-2);padding-block:11px}
.image-container{border-top:1px solid var(--kp-border)}
.image-container-name{display:flex;flex-direction:column;gap:6px;min-width:0;overflow-wrap:anywhere}
.image-container-name strong{font-size:15px;font-weight:600;line-height:1.45;color:var(--kp-text)}
.image-container-name span,.image-strategy{font-size:13px;line-height:1.6;color:var(--kp-muted)}
.image-current,.image-version{min-width:0}
.image-reference{display:block;min-width:0;max-width:100%;font:13px/1.75 'Cascadia Mono',Consolas,ui-monospace,monospace;color:var(--kp-text-2);white-space:normal;overflow-wrap:anywhere}
.image-mobile-label{display:none}
.image-version :deep(.el-input__wrapper){min-height:36px;padding:2px 11px;box-sizing:border-box}
.image-version :deep(.el-input__inner){font-family:'Cascadia Mono',Consolas,ui-monospace,monospace;font-size:13px}
.image-reference-next,.image-format-error{display:block;margin-top:9px}
.image-reference-next{color:var(--kp-brand)}
.image-format-error{color:var(--el-color-danger);font-size:13px;line-height:1.6}
.image-error{margin-bottom:18px}
.image-error .el-button{margin-top:8px}
.image-strategy{margin:16px 0 0;line-height:1.75}
:global(.image-version-dialog .el-dialog__body){max-height:calc(100dvh - 210px);overflow-y:auto}
@media(max-width:760px){
  .image-field-heading{display:none}
  .image-field-row{grid-template-columns:minmax(0,1fr);gap:14px;padding:16px}
  .image-field-heading+.image-container{border-top:0}
  .image-container-name{flex-direction:row;align-items:baseline;flex-wrap:wrap;gap:5px 12px;margin-bottom:1px}
  .image-mobile-label{display:block;margin-bottom:6px;color:var(--kp-text-2);font-size:13px;font-weight:600;line-height:1.5}
  .image-context{margin-bottom:18px}
  .image-context-meta{gap:4px 14px}
}
@media(max-width:420px){
  .image-field-row{padding:14px 12px}
  .image-reference{font-size:12px}
}
</style>
