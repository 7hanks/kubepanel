<template>
  <el-dialog :model-value="true" title="批量执行" width="min(820px, 94vw)" top="8vh" append-to-body
    :show-close="!busy" :close-on-click-modal="false" :close-on-press-escape="!busy"
    @update:model-value="value=>{if(!value&&!busy)emit('close')}">
    <p class="batch-context">{{ workload.namespace }} / {{ workload.name }}</p>
    <el-form label-position="top" :disabled="busy||uncertain" @submit.prevent="run">
      <el-form-item :label="`目标容器（已选 ${selected.length} / ${maxTargets}）`">
        <el-checkbox-group v-model="selected" :max="maxTargets" class="batch-targets" aria-label="目标容器">
          <el-checkbox v-for="entry in entries" :key="entry.key" :value="entry.key">
            {{ entry.pod }} / {{ entry.container }}
          </el-checkbox>
        </el-checkbox-group>
      </el-form-item>
      <el-form-item label="Shell">
        <el-select v-model="shell" aria-label="批量执行 Shell" class="batch-shell">
          <el-option label="sh" value="/bin/sh"/><el-option label="bash" value="/bin/bash"/><el-option label="ash" value="/bin/ash"/>
        </el-select>
      </el-form-item>
      <el-form-item label="命令" :error="commandBytes>maxCommandBytes ? '命令最多 8192 字节' : ''">
        <el-input v-model="command" type="textarea" :rows="3" aria-label="批量执行命令" spellcheck="false" />
      </el-form-item>
    </el-form>
    <el-alert v-if="error" :title="error" :type="uncertain?'warning':'error'" :closable="false" show-icon />
    <div v-if="results.length" class="batch-results" aria-label="执行结果" role="region">
      <details v-for="result in results" :key="`${result.uid}/${result.container}`" :open="results.length===1">
        <summary>
          <strong>{{result.pod}} / {{result.container}}</strong>
          <el-tag :type="result.ok?'success':result.uncertain?'warning':'danger'" size="small">
            {{result.ok?'成功':result.uncertain?'结果待确认':'失败'}}{{Number.isInteger(result.exitCode)?` · 退出码 ${result.exitCode}`:''}}
          </el-tag>
        </summary>
        <p v-if="result.message" class="kp-muted">{{result.message}}</p>
        <div v-if="result.stdout"><span>标准输出</span><pre>{{ result.stdout }}</pre></div>
        <div v-if="result.stderr"><span>错误输出</span><pre>{{ result.stderr }}</pre></div>
      </details>
    </div>
    <template #footer>
      <el-button :disabled="busy" @click="emit('close')">关闭</el-button>
      <el-button type="primary" :disabled="!mayRun" :loading="busy" @click="run">{{running?'执行中':'执行命令'}}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, onUnmounted, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import api from '../api'
import { registerUnsavedGuard } from '../utils/navigation'
import { can } from '../utils/perm'

const props = defineProps({ workload:{type:Object,required:true}, entries:{type:Array,required:true}, initialKey:String })
const emit = defineEmits(['close'])
const maxTargets = 20
const maxCommandBytes = 8192
const selected = ref(props.entries.some(entry=>entry.key===props.initialKey)?[props.initialKey]:[])
const shell = ref('/bin/sh')
const command = ref('')
const results = ref([])
const error = ref('')
const busy = ref(false)
const running = ref(false)
const uncertain = ref(false)
const commandBytes = computed(()=>new TextEncoder().encode(command.value).length)
const mayRun = computed(()=>!busy.value&&!uncertain.value&&selected.value.length>0&&!!command.value.trim()&&commandBytes.value<=maxCommandBytes)
const removeGuard = registerUnsavedGuard(()=>!busy.value)
let controller, disposed=false

async function run() {
  if (!mayRun.value||!can('pod:exec')) return
  const { clusterId, kind, namespace, name, uid } = props.workload
  const targets = props.entries.filter(entry=>selected.value.includes(entry.key))
    .map(({ pod, uid, container, startedAt, containerID })=>({ pod, uid, container, startedAt, ...(containerID?{containerID}:{}) }))
  const input={workload:{kind,namespace,name,uid},targets,shell:shell.value,command:command.value,confirmed:true}
  busy.value = true
  try {
    await ElMessageBox.confirm(`将在 ${namespace} / ${name} 的 ${targets.length} 个选中容器中执行当前命令。`, '确认批量执行', {
      type:'warning', confirmButtonText:'确认执行', cancelButtonText:'取消',
    })
    if (disposed||!can('pod:exec')) return
    controller = new AbortController()
    running.value = true
    error.value = ''
    results.value = []
    const response = await api.containerBatchExec(clusterId,input,{signal:controller.signal})
    if (disposed) return
    if (!Array.isArray(response?.results)||response.results.length!==targets.length) throw new Error('服务端返回的执行结果不完整')
    results.value = response.results
    if (response.results.some(result=>result.uncertain)) {
      uncertain.value = true
      error.value = '部分执行结果待确认。请先核对容器状态，再发起新一轮操作。'
    }
  } catch (cause) {
    if (disposed||!running.value) return
    uncertain.value = !cause.status||cause.status>=500||cause.status===408
    error.value = uncertain.value ? '执行结果待确认，请先核对容器状态。' : cause.message||'批量执行失败'
  } finally {
    running.value = false
    busy.value = false
  }
}
onUnmounted(()=>{disposed=true;controller?.abort();removeGuard()})
</script>

<style scoped>
.batch-context{color:var(--kp-text-2);font-weight:600;margin:0 0 14px;overflow-wrap:anywhere}
.batch-targets{display:grid;gap:3px;max-height:172px;overflow:auto;width:100%;padding:6px 12px;border:1px solid var(--kp-border);border-radius:8px}
.batch-targets :deep(.el-checkbox){height:auto;min-height:28px;margin:0;white-space:normal}
.batch-targets :deep(.el-checkbox__label){overflow-wrap:anywhere}
.batch-shell{width:160px}
.batch-results{display:grid;gap:8px;margin-top:16px;max-height:34vh;overflow:auto}
.batch-results details{border:1px solid var(--kp-border);padding:10px 12px;border-radius:8px;min-width:0}
.batch-results summary{cursor:pointer;overflow-wrap:anywhere}
.batch-results summary strong{margin-right:8px}
.batch-results details>div{margin-top:10px}
.batch-results pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0;padding:10px;background:var(--kp-surface-2)}
</style>
