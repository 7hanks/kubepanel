<template>
  <el-dialog :model-value="modelValue" title="批量重启 Pod" width="min(1000px, 94vw)" :close-on-click-modal="false" :before-close="beforeClose" @update:model-value="value => !value && close()">
    <p class="kp-mono bulk-target">{{ clusterName || clusterId }} · 已选 {{ summary.total }} 个 Pod · 每批最多 {{ MAX_BULK_POD_RESTART }} 项</p>
    <el-alert type="warning" :closable="false" show-icon class="bulk-notice" title="重启会中断服务，请先预检后确认执行。提交成功后仍需核对 Pod 就绪状态。" />
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="session">
      <el-table :data="session.state.rows" border size="small" max-height="420" row-key="target.uid">
        <el-table-column prop="target.namespace" label="命名空间" width="140" show-overflow-tooltip />
        <el-table-column prop="target.name" label="Pod" min-width="190" show-overflow-tooltip />
        <el-table-column label="结果" width="125"><template #default="{row}"><el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column prop="message" label="预检 / 提交详情" min-width="310" show-overflow-tooltip />
      </el-table>
      <p class="bulk-summary" role="status">{{ summaryText }}</p>
    </template>
    <template #footer>
      <el-button v-if="session?.state.busy" @click="session.stop()">停止后续操作</el-button>
      <el-button @click="close">{{ session?.state.busy ? '停止并关闭' : '关闭' }}</el-button>
      <el-button v-if="session?.state.phase === 'idle' || session?.state.phase === 'checking'" type="primary" :loading="session?.state.busy" @click="preflight">逐项服务端预检</el-button>
      <el-button v-if="session?.state.phase === 'ready' || session?.state.phase === 'submitting'" type="danger" :loading="session?.state.busy" :disabled="!summary.executable || session?.state.busy" @click="submit">重启可执行的 {{ summary.executable }} 项</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import {ref,shallowRef,reactive,computed,watch,onUnmounted} from 'vue'
import api from '../api'
import {createBulkPodRestart,MAX_BULK_POD_RESTART} from '../utils/bulk-pod-restart'
import {registerUnsavedGuard} from '../utils/navigation'

const props=defineProps({modelValue:Boolean,targets:{type:Array,default:()=>[]},clusterId:String,clusterName:String,contextKey:String,canRestart:{type:Function,required:true}})
const emit=defineEmits(['update:modelValue','submitted'])
const session=shallowRef(null),error=ref('')
const summary=computed(()=>session.value?.summary() || {total:0,executable:0,submitted:0,blocked:0,failed:0,unknown:0,cancelled:0})
const summaryText=computed(()=>{
  const s=summary.value
  const counts=[['可执行',s.executable],['已提交',s.submitted],['阻止',s.blocked],['提交失败',s.failed],['结果未知',s.unknown],['已停止',s.cancelled]]
  return [`总计 ${s.total} 项`,...counts.filter(([,count])=>count>0).map(([label,count])=>`${label} ${count}`)].join(' · ')
})
const labels={pending:'待预检',checking:'预检中',passed:'预检通过',blocked:'已阻止',submitting:'提交中',submitted:'已提交驱逐',failed:'提交失败',unknown:'结果未知',cancelled:'已停止'}
function statusLabel(status){return labels[status] || status}
function statusType(status){return ['blocked','failed'].includes(status)?'danger':['unknown','cancelled'].includes(status)?'warning':status==='submitted'?'success':'info'}
function close(){session.value?.stop();emit('update:modelValue',false)}
function beforeClose(done){close();done()}
async function preflight(){await session.value?.preflight()}
async function submit(){const current=session.value;await current?.submit();if(current?.summary().submitted)emit('submitted')}
watch(()=>props.modelValue,open=>{
  session.value?.stop()
  if(!open)return
  error.value=''
  const clusterId=props.clusterId,contextKey=props.contextKey
  try{
    session.value=createBulkPodRestart({pods:props.targets,clusterId,canRestart:target=>props.canRestart(target),request:(namespace,name,options)=>api.restartPod(namespace,name,{...options,silent:true}),
      isContextCurrent:()=>props.modelValue && props.clusterId===clusterId && props.contextKey===contextKey,state:reactive({})})
  }catch(e){session.value=null;error.value=e.message}
// Wait until Vue has applied targets and cluster props as well as v-model.
},{immediate:true,flush:'post'})
watch([()=>props.clusterId,()=>props.contextKey],()=>session.value?.stop(),{flush:'sync'})
const removeGuard=registerUnsavedGuard(()=>{if(props.modelValue)close();return true})
onUnmounted(()=>{session.value?.stop();removeGuard()})
</script>

<style scoped>
.bulk-target { margin-top:0;overflow-wrap:anywhere; }
.bulk-notice { margin-bottom:12px; }
.bulk-summary { margin-bottom:0;line-height:1.8; }
</style>
