<template>
 <el-dialog :model-value="modelValue && !filesOpen" title="选择文件浏览器容器" width="min(650px,94vw)" @update:model-value="value=>{if(!value&&!filesOpen)emit('update:modelValue',false)}">
  <p class="kp-mono">{{resource?.kind}} / {{resource?.metadata?.name}}</p>
  <el-alert v-if="error" :title="error" type="error" :closable="false"/>
  <el-alert v-if="incomplete" title="仅加载前 2000 项资源，列表可能不完整" type="warning" :closable="false"/>
  <el-form label-width="70px" v-loading="loading">
   <el-form-item label="Pod"><el-select v-model="podId" aria-label="文件浏览器 Pod" style="width:100%" @change="selectPod"><el-option v-for="pod in pods" :key="pod.metadata.uid" :label="pod.metadata.name" :value="pod.metadata.uid"/></el-select></el-form-item>
   <el-form-item label="容器"><el-select v-model="container" aria-label="文件浏览器容器" style="width:100%"><el-option v-for="c in containers" :key="c.key" :label="c.name+' · '+c.state" :value="c.name" :disabled="!c.running"/></el-select></el-form-item>
  </el-form>
  <p v-if="!loading&&!error&&!pods.length" class="kp-muted">当前资源没有所属 Pod</p>
  <template #footer><el-button @click="emit('update:modelValue',false)">取消</el-button><el-button type="primary" :disabled="!container||loading" @click="openFiles">打开文件浏览器</el-button></template>
 </el-dialog>
 <ContainerFilesDialog v-model="filesOpen" :target="target"/>
</template>
<script setup>
import {ref,computed,watch,onUnmounted} from 'vue'
import api from '../api'
import {store} from '../store'
import {ownedPods,podContainers} from '../utils/container-targets'
import {registerUnsavedGuard} from '../utils/navigation'
import ContainerFilesDialog from './ContainerFilesDialog.vue'
const props=defineProps({modelValue:Boolean,resource:Object}),emit=defineEmits(['update:modelValue'])
const pods=ref([]),podId=ref(''),container=ref(''),filesOpen=ref(false),target=ref(null),loading=ref(false),error=ref(''),incomplete=ref(false)
const containers=computed(()=>podContainers(pods.value.find(p=>p.metadata.uid===podId.value)||{}))
let epoch=0,clusterId=''
const guard=registerUnsavedGuard(()=>!props.modelValue)
onUnmounted(()=>{epoch++;guard()})
watch(filesOpen,open=>{if(!open&&props.modelValue)emit('update:modelValue',false)})
watch(()=>props.modelValue,open=>{const id=++epoch;loading.value=false;pods.value=[];podId.value='';container.value='';target.value=null;error.value='';incomplete.value=false;if(open){clusterId=store.currentClusterId;load(id)}else filesOpen.value=false})
const kinds={Pod:['','v1','pods'],Deployment:['apps','v1','deployments'],StatefulSet:['apps','v1','statefulsets'],DaemonSet:['apps','v1','daemonsets'],ReplicaSet:['apps','v1','replicasets'],Job:['batch','v1','jobs'],CronJob:['batch','v1','cronjobs']}
async function list(group,version,plural,namespace){const items=[];let next;do{const result=await api.list(group,version,plural,{namespace,clusterId,limit:200,...(next?{continue:next}:{})});items.push(...(result.items||[]));next=result.metadata?.continue;if(items.length>=2000&&next){incomplete.value=true;break}}while(next);return items}
async function load(id){loading.value=true;try{
 const resource=props.resource,m=resource?.metadata,k=kinds[resource?.kind];if(!k||!m?.namespace||!m.name)throw new Error('该资源不支持容器文件浏览')
 const current={...await api.get(...k,m.namespace,m.name),kind:resource.kind};if(id!==epoch)return;if(current.metadata?.uid!==m.uid)throw new Error('资源已重新创建，请刷新后重试')
 let result
 if(current.kind==='Pod')result=[current]
 else{const all=await list('','v1','pods',m.namespace);const middle=current.kind==='Deployment'?await list('apps','v1','replicasets',m.namespace):current.kind==='CronJob'?await list('batch','v1','jobs',m.namespace):[];result=ownedPods(current,all,middle)}
 if(id!==epoch)return;pods.value=result;podId.value=result[0]?.metadata.uid||'';selectPod()
 if(result.length===1&&containers.value.filter(c=>c.running).length===1)openFiles()
 }catch(e){if(id===epoch)error.value=e.message||'读取容器失败'}finally{if(id===epoch)loading.value=false}}
function selectPod(){container.value=containers.value.find(c=>c.running)?.name||''}
function openFiles(){const selected=containers.value.find(c=>c.name===container.value&&c.running);if(!selected)return;target.value={...selected,clusterId};filesOpen.value=true}
</script>
