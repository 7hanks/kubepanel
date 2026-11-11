<template>
 <el-dialog :model-value="modelValue" title="选择 Pod / 容器" width="min(1250px,96vw)" top="5vh" :before-close="beforeClose" @update:model-value="value=>emit('update:modelValue',value)">
  <div class="kp-toolbar"><strong>{{resource?.kind}} / {{resource?.metadata?.name}}</strong><span class="spacer"/><el-button v-if="can('pod:batch-exec')" type="warning" :disabled="!selected.length||busy" @click="batchOpen=true">批量执行 ({{selected.length}})</el-button><el-button :loading="loading" @click="load">刷新容器</el-button></div>
  <el-alert v-if="error" :title="error" type="error" :closable="false"/>
  <el-alert v-if="incomplete" title="仅加载部分资源，容器列表可能不完整" type="warning" :closable="false"/>
  <el-table :data="pods" row-key="metadata.uid" default-expand-all v-loading="loading" max-height="60vh" aria-label="Pod 容器选择">
   <el-table-column type="expand"><template #default="{row:pod}">
    <el-table :data="podContainers(pod)" row-key="key" @selection-change="rows=>selectContainers(pod,rows)">
     <el-table-column v-if="can('pod:batch-exec')" type="selection" width="45" :selectable="row=>row.running"/>
     <el-table-column label="容器" min-width="220"><template #default="{row}"><strong>{{row.name}}</strong><div class="kp-muted container-image">{{row.image}}</div></template></el-table-column>
     <el-table-column label="状态" width="135"><template #default="{row}"><el-tag :type="row.running?'success':'info'">{{row.state}}</el-tag></template></el-table-column>
     <el-table-column label="操作" min-width="510"><template #default="{row}"><div class="container-actions">
      <el-button v-if="can('pod:files:read')" type="success" plain :disabled="!row.running||busy" @click="openFiles(row)">文件浏览器</el-button>
      <el-button v-if="can('pod:batch-exec')" type="warning" plain :disabled="!row.running||busy" @click="singleBatch(row)">批量执行</el-button>
      <el-button v-if="can('pod:logs')" type="primary" plain :disabled="busy" @click="downloadLogs(row)">下载日志</el-button>
      <el-button v-if="can('pod:logs')" type="primary" @click="go(row,'logs')">追踪日志</el-button>
      <el-dropdown v-if="can('pod:exec')" @command="shell=>go(row,'terminal',shell)" trigger="click"><el-button type="danger" :disabled="!row.running||busy">终端 ▾</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="/bin/sh">sh</el-dropdown-item><el-dropdown-item command="/bin/bash">bash</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
     </div></template></el-table-column>
    </el-table>
   </template></el-table-column>
   <el-table-column label="Pod" min-width="260"><template #default="{row}"><strong>{{row.metadata.name}}</strong><div class="kp-muted">{{row.metadata.namespace}} · {{row.spec?.nodeName||'未调度'}}</div></template></el-table-column><el-table-column label="状态" width="140"><template #default="{row}">{{row.status?.phase||'Unknown'}}</template></el-table-column>
   <template #empty>没有归属于当前资源的 Pod</template>
  </el-table>
  <template #footer><el-button :disabled="busy" @click="emit('update:modelValue',false)">关闭</el-button></template>
 </el-dialog>
 <ContainerFilesDialog v-model="filesOpen" :target="fileTarget"/>
 <el-dialog v-model="batchOpen" title="批量执行命令" width="min(1000px,96vw)" top="5vh" :close-on-click-modal="!busy" :before-close="closeBatch">
  <p class="kp-mono batch-targets">{{selected.map(t=>`${t.namespace}/${t.pod}:${t.container}`).join('、')}}</p>
  <el-input v-model="command" type="textarea" :rows="4" aria-label="批量执行命令" placeholder="通过 /bin/sh 执行" :disabled="busy"/>
  <el-alert v-if="batchError" :title="batchError" type="error" :closable="false"/>
  <div class="kp-toolbar" style="margin-top:14px"><span class="kp-muted">{{selected.length}} 个容器 · 每个最多等待 10 秒</span><span class="spacer"/><el-button v-if="busy" @click="stopBatch">停止等待</el-button><el-button type="warning" :disabled="!command.trim()||!selected.length||busy" @click="runBatch">确认并执行</el-button></div>
  <div class="batch-results" aria-label="命令执行结果"><section v-for="result in results" :key="result.uid+'/'+result.container" class="kp-card"><strong>{{result.namespace}} / {{result.pod}} · {{result.container}}</strong><el-tag :type="result.ok?'success':'danger'">{{result.ok?'成功':'失败'}}{{result.exitCode!=null?' · '+result.exitCode:''}}</el-tag><pre>{{result.stdout}}{{result.stderr}}{{result.message}}</pre></section></div>
  <template #footer><el-button :disabled="busy" @click="batchOpen=false">关闭</el-button></template>
 </el-dialog>
</template>
<script setup>
import {ref,watch,onUnmounted} from 'vue'
import {useRouter} from 'vue-router'
import {ElMessageBox} from 'element-plus'
import api,{logsUrl} from '../api'
import {store} from '../store'
import {can} from '../utils/perm'
import {cpath} from '../utils/path'
import {ownedPods,podContainers} from '../utils/container-targets'
import {registerUnsavedGuard} from '../utils/navigation'
import ContainerFilesDialog from './ContainerFilesDialog.vue'
const props=defineProps({modelValue:Boolean,resource:Object}),emit=defineEmits(['update:modelValue']),router=useRouter()
const pods=ref([]),loading=ref(false),error=ref(''),incomplete=ref(false),selected=ref([]),filesOpen=ref(false),fileTarget=ref(null),batchOpen=ref(false),command=ref(''),results=ref([]),busy=ref(false),batchError=ref('')
let epoch=0,batchController,clusterId=''
const guard=registerUnsavedGuard(()=>{if(busy.value||filesOpen.value||batchOpen.value)return false;if(props.modelValue)emit('update:modelValue',false);return true})
onUnmounted(()=>{epoch++;batchController?.abort();guard()})
watch(()=>props.modelValue,open=>{epoch++;loading.value=false;pods.value=[];selected.value=[];results.value=[];error.value='';if(open){clusterId=store.currentClusterId;load()}})
const kinds={Pod:['','v1','pods'],Deployment:['apps','v1','deployments'],StatefulSet:['apps','v1','statefulsets'],DaemonSet:['apps','v1','daemonsets'],ReplicaSet:['apps','v1','replicasets'],Job:['batch','v1','jobs'],CronJob:['batch','v1','cronjobs']}
async function list(group,version,plural,namespace){const items=[];let next;do{const result=await api.list(group,version,plural,{namespace,clusterId,limit:200,...(next?{continue:next}:{})});items.push(...(result.items||[]));next=result.metadata?.continue;if(items.length>=2000&&next){incomplete.value=true;break}}while(next);return items}
async function load(){if(loading.value)return;const id=epoch;loading.value=true;error.value='';selected.value=[];try{
 const resource=props.resource,m=resource?.metadata,k=kinds[resource?.kind];if(!m?.namespace||!m.name||!k)throw new Error('该资源不支持容器访问')
 const current=await api.get(...k,m.namespace,m.name);if(id!==epoch)return
 if(current.metadata?.uid!==m.uid)throw new Error('资源已重新创建，请刷新列表后重新打开')
 incomplete.value=false
 if(current.kind==='Pod')pods.value=[current]
 else{const all=await list('','v1','pods',m.namespace);let middle=[];if(current.kind==='Deployment')middle=await list('apps','v1','replicasets',m.namespace);if(current.kind==='CronJob')middle=await list('batch','v1','jobs',m.namespace);if(id!==epoch)return;pods.value=ownedPods(current,all,middle)}
 }catch(e){if(id===epoch)error.value=e.message||'加载容器失败'}finally{if(id===epoch)loading.value=false}}
function selectContainers(pod,rows){selected.value=[...selected.value.filter(t=>t.uid!==pod.metadata.uid),...rows.map(t=>({...t,clusterId}))]}
function openFiles(row){fileTarget.value={...row,clusterId};filesOpen.value=true}
function singleBatch(row){selected.value=[{...row,clusterId}];results.value=[];batchOpen.value=true}
function go(row,page,shell){emit('update:modelValue',false);router.push({path:cpath(`/pods/${encodeURIComponent(row.namespace)}/${encodeURIComponent(row.pod)}/${page}`),query:{container:row.container,uid:row.uid,...(shell?{shell}:{})}})}
async function beforeClose(done){if(!busy.value&&!filesOpen.value&&!batchOpen.value)done()}
function closeBatch(done){if(!busy.value)done()}
function stopBatch(){batchController?.abort();batchError.value='已停止等待；已启动的容器进程可能继续运行。'}
async function runBatch(){if(selected.value.length>10){batchError.value='最多选择 10 个容器';return}const targets=selected.value.map(({namespace,pod,container,uid})=>({namespace,pod,container,uid})),text=command.value;try{await ElMessageBox.confirm(`将在 ${targets.length} 个容器执行当前命令，是否继续？`,'确认批量执行',{type:'warning',confirmButtonText:'确认执行'})}catch{return}busy.value=true;batchError.value='';results.value=[];batchController=new AbortController();try{const data=await api.containerBatch({targets,command:text,confirmed:true},{params:{clusterId},signal:batchController.signal});results.value=data.results||[]}catch(e){if(!e.cancelled)batchError.value=e.message||'执行失败'}finally{busy.value=false}}
async function downloadLogs(row){busy.value=true;error.value='';const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{const response=await fetch(logsUrl(row.namespace,row.pod,{container:row.container,tailLines:10000,follow:0}),{credentials:'same-origin',signal:controller.signal});if(!response.ok)throw new Error('读取日志失败');let text='',size=0;const reader=response.body.getReader(),decoder=new TextDecoder();while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>2*1024*1024){await reader.cancel();throw new Error('日志超过 2 MiB，请缩小范围后下载')}text+=decoder.decode(chunk.value,{stream:true})}text+=decoder.decode();const lines=text.split('\n\n').filter(block=>!block.startsWith('event:')&&block.startsWith('data: ')).map(block=>block.slice(6));if(text.includes('event: error'))throw new Error('日志读取未完成');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}));a.download=row.pod+'-'+row.container+'.log';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}catch(e){error.value=e.message||'日志读取失败'}finally{clearTimeout(timer);busy.value=false}}
</script>
<style scoped>.container-actions{display:flex;gap:0;flex-wrap:wrap}.container-actions .el-button{margin:0;border-radius:0}.container-actions :first-child{border-radius:6px 0 0 6px}.container-actions :last-child{border-radius:0 6px 6px 0}.container-image{font-size:13px;overflow-wrap:anywhere;margin-top:6px}.batch-targets{overflow-wrap:anywhere}.batch-results{max-height:45vh;overflow:auto}.batch-results section{margin-bottom:10px}.batch-results pre{white-space:pre-wrap;overflow-wrap:anywhere}.batch-results .el-tag{margin-left:12px}</style>
