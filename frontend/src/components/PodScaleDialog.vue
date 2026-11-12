<template><ScaleDialog :model-value="modelValue" :name="resolved?`${resolved.kind}/${resolved.name}`:target?.name||''" :context="target?.namespace" :current="resolved?.replicas??0" :loading="loading" :saving="saving" :error="error" @update:model-value="value=>emit('update:modelValue',value)" @save="save" @retry="load"/></template>
<script setup>
import {ref,watch,onUnmounted} from 'vue'
import {ElMessage} from 'element-plus'
import api from '../api'
import {canResource} from '../utils/perm'
import {registerUnsavedGuard} from '../utils/navigation'
import ScaleDialog from './ScaleDialog.vue'
const props=defineProps({modelValue:Boolean,target:Object,contextKey:String}),emit=defineEmits(['update:modelValue','saved'])
const resolved=ref(null),loading=ref(false),saving=ref(false),error=ref('')
let epoch=0,controller
const removeGuard=registerUnsavedGuard(()=>!saving.value)
async function load(){
 const id=++epoch;controller?.abort();controller=new AbortController();resolved.value=null;loading.value=false;error.value='';if(!props.modelValue||!props.target)return
 loading.value=true;const target={...props.target}
 try{const result=await api.podScaleTarget(target.namespace,target.name,{uid:target.uid,clusterId:target.clusterId,signal:controller.signal});if(id!==epoch||!props.modelValue)return;if(!result.uid||!Number.isInteger(result.replicas)||result.replicas<0||result.replicas>999)throw new Error('扩缩容目标数据不完整，请刷新后重试');if(!canResource({...result,namespaced:true},'update',target.namespace,target.clusterId))throw new Error('没有所属工作负载的更新权限');resolved.value=result}
 catch(e){if(id===epoch&&!e.cancelled)error.value=e.message||'无法读取所属工作负载'}finally{if(id===epoch)loading.value=false}
}
async function save(replicas){
 if(saving.value||loading.value||!resolved.value||!props.modelValue||!Number.isInteger(replicas)||replicas<0||replicas>999)return
 const selected={...props.target},owner={...resolved.value},id=epoch
 if(!canResource({...owner,namespaced:true},'update',selected.namespace,selected.clusterId)){error.value='没有所属工作负载的更新权限';return}
 saving.value=true;error.value=''
 try{const result=await api.scalePod(selected.namespace,selected.name,{uid:selected.uid,controllerUid:owner.uid,replicas,expectedReplicas:owner.replicas},{clusterId:selected.clusterId});if(id!==epoch)return;if(result.ok!==true)throw new Error('服务器未确认扩缩容结果，请重新读取');ElMessage.success(result.message||'扩缩容已提交');emit('update:modelValue',false);emit('saved')}
 catch(e){if(id===epoch){error.value=e.message||'提交未确认，请重新读取当前副本数';resolved.value=null}}finally{if(id===epoch)saving.value=false}
}
watch(()=>[props.modelValue,props.target],()=>{if(props.modelValue)load();else{epoch++;controller?.abort();loading.value=false;resolved.value=null}},{flush:'post',immediate:true})
watch(()=>props.contextKey,()=>{epoch++;controller?.abort();loading.value=false;resolved.value=null;saving.value=false;emit('update:modelValue',false)})
onUnmounted(()=>{epoch++;controller?.abort();removeGuard()})
</script>
