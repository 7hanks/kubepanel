<template>
  <div v-if="supported" class="kp-card" style="margin-bottom:16px">
    <div class="kp-section-title">运维操作 <span class="kp-muted" style="font-size:12px">{{ target }}</span></div>
    <div class="kp-toolbar">
      <el-button v-if="workload" @click="loadHistory" :loading="busy">发布历史</el-button>
      <template v-if="resource.kind === 'CronJob'">
        <el-button v-if="can('cluster:create')" @click="runCron">立即运行一次</el-button>
        <el-button v-if="can('cluster:update')" @click="suspendCron">{{ resource.spec?.suspend ? '恢复调度' : '暂停调度' }}</el-button>
      </template>
      <el-button v-if="resource.kind === 'Node' && can('node:maintain') && can('cluster:update') && can('cluster:delete')" type="warning" plain @click="preflightDrain">维护预检 / Drain</el-button>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-table v-if="history !== null" :data="history" size="small" border>
      <el-table-column prop="revision" label="版本" width="80" />
      <el-table-column prop="name" label="名称" min-width="180" />
      <el-table-column prop="createdAt" label="创建时间" min-width="160" />
      <el-table-column label="镜像" min-width="200"><template #default="{row}">{{ (row.images || []).join(', ') }}</template></el-table-column>
      <el-table-column label="操作" width="120"><template #default="{row}"><el-button v-if="can('cluster:update')" link type="warning" :disabled="!row.available || busy" @click="rollback(row)">预检并回滚</el-button></template></el-table-column>
    </el-table>
    <el-dialog v-model="drainVisible" title="节点维护 · 预检结果" width="min(900px, 96vw)">
      <p>{{ target }}。先封锁调度，再逐个通过 Eviction 驱逐；PDB、裸 Pod、持久化本地数据等阻塞会保留并返回。</p>
      <el-alert v-if="drainData?.blockers?.length" type="warning" :closable="false" :title="blockerText(drainData.blockers)" />
      <el-table :data="drainData?.pods || []" size="small" border><el-table-column prop="namespace" label="命名空间" /><el-table-column prop="name" label="Pod" /><el-table-column label="阻塞 / 豁免"><template #default="{row}">{{ row.exempt ? '豁免' : blockerText(row.blockers) || '可驱逐' }}</template></el-table-column></el-table>
      <el-table v-if="drainResult" :data="drainResult.results || []" size="small"><el-table-column prop="name" label="Pod" /><el-table-column prop="status" label="结果" /><el-table-column prop="message" label="说明" /></el-table>
      <template #footer><el-button @click="drainVisible=false">关闭</el-button><el-button type="warning" :loading="busy" :disabled="!drainData?.canDrain" @click="performDrain">确认 Drain</el-button></template>
    </el-dialog>
  </div>
</template>
<script setup>
import { computed, ref, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import { registerUnsavedGuard } from '../utils/navigation'
import { can } from '../utils/perm'
import { store } from '../store'
import { targetDescription } from '../utils/resource'
const props=defineProps({resource:{type:Object,required:true}})
const emit=defineEmits(['changed'])
const workload=computed(()=>['Deployment','StatefulSet','DaemonSet'].includes(props.resource.kind))
const supported=computed(()=>workload.value || props.resource.kind==='CronJob' || (props.resource.kind==='Node' && can('node:maintain')))
const target=computed(()=>targetDescription(store.currentCluster?.name || store.currentClusterId,props.resource.metadata?.namespace,props.resource.kind,props.resource.metadata?.name))
const busy=ref(false),error=ref(''),history=ref(null),drainVisible=ref(false),drainData=ref(null),drainResult=ref(null)
const removeContextGuard=registerUnsavedGuard(()=>!busy.value)
onUnmounted(removeContextGuard)
const blockerText=items=>(items || []).map(x=>typeof x==='string' ? x : x.message || x.reason || JSON.stringify(x)).join('；')
async function operation(fn) { if(busy.value)return; busy.value=true;error.value='';try{await fn()}catch(e){if(e!=='cancel' && e!=='close')error.value=e.message || '操作失败'}finally{busy.value=false} }
async function confirm(message) { await ElMessageBox.confirm(`${target.value}\n${message}`,'确认变更',{type:'warning',confirmButtonText:'确认执行'}) }
const identity=()=>[props.resource.metadata.namespace,props.resource.metadata.name]
function loadHistory(){return operation(async()=>{const data=await api.history(...identity(),props.resource.kind);history.value=data.items || []})}
function rollback(row){return operation(async()=>{await api.rollback(...identity(),props.resource.kind,row.revision,true);await confirm(`服务端预检通过。将回滚到 revision ${row.revision}，触发滚动更新。`);await api.rollback(...identity(),props.resource.kind,row.revision,false);ElMessage.success('已提交回滚');emit('changed')})}
function runCron(){return operation(async()=>{await api.runCronJob(...identity(),true);await confirm('立即创建一个 Job，不改变原有计划。');const data=await api.runCronJob(...identity(),false);ElMessage.success(data.message || 'Job 已创建');emit('changed')})}
function suspendCron(){return operation(async()=>{const suspend=!props.resource.spec?.suspend;await api.suspendCronJob(...identity(),suspend,true);await confirm(suspend ? '暂停后续调度，已运行 Job 继续。' : '恢复调度；控制器可能补调错过的任务。');await api.suspendCronJob(...identity(),suspend,false);ElMessage.success('调度状态已更新');emit('changed')})}
function preflightDrain(){return operation(async()=>{drainData.value=await api.drainPreflight(props.resource.metadata.name);drainResult.value=null;drainVisible.value=true})}
function performDrain(){return operation(async()=>{const check=await api.drain(props.resource.metadata.name,{dryRun:true,timeoutSeconds:30});if(!check.ok){drainResult.value=check;throw new Error(blockerText(check.blockers) || '服务端预检有阻塞，请检查逐项结果')}await confirm('确认维护节点并驱逐可驱逐 Pod？阻塞时不会绕过 PDB。');drainResult.value=await api.drain(props.resource.metadata.name,{dryRun:false,timeoutSeconds:30});ElMessage[drainResult.value.ok ? 'success' : 'warning'](drainResult.value.ok ? '节点 Drain 完成' : '部分 Pod 未完成驱逐，请查看逐项结果');emit('changed')})}
</script>
