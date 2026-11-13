<template>
  <el-dialog
    :model-value="modelValue" :title="`${creating?'创建':'编辑'}${resourceTitle(meta)}`"
    class="simple-resource-dialog" width="min(520px,calc(100vw - 32px))" align-center append-to-body
    :show-close="!busy" :close-on-click-modal="false" :close-on-press-escape="!busy"
    :before-close="beforeClose" @update:model-value="value=>{if(!busy)emit('update:modelValue',value)}"
  >
    <div class="simple-resource-body" v-loading="loading" :aria-busy="busy">
      <p class="simple-resource-context">{{clusterId}}<span aria-hidden="true"> · </span>{{meta.kind}}</p>
      <div v-if="error" ref="errorRef" class="simple-resource-error" role="alert" tabindex="-1">
        <p>{{error}}</p><el-button link :disabled="busy" @click="reread">重新读取</el-button>
      </div>
      <el-form v-if="draft" :key="formKey" label-position="top" :disabled="busy||!authorized" @submit.prevent>
        <el-form-item v-if="meta.namespaced" label="命名空间" required>
          <el-select v-model="draft.metadata.namespace" :disabled="!creating||busy" filterable aria-label="命名空间">
            <el-option v-for="ns in namespaceOptions" :key="ns" :label="ns" :value="ns"/>
          </el-select>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="draft.metadata.name" :disabled="!creating||busy" aria-label="资源名称" placeholder="请输入资源名称"/>
        </el-form-item>
        <details class="simple-resource-metadata" :open="metadataOpen" @toggle="metadataOpen=$event.target.open">
          <summary>标签与注解 <span>可选<span v-if="metadataCount"> · {{metadataCount}} 项</span></span></summary>
          <div class="simple-resource-metadata-fields">
            <el-form-item label="标签"><KeyValueFields v-model="draft.metadata.labels" label="标签" add-label="添加标签" :disabled="busy||!authorized" @change="touch" @validity="value=>setValidity('标签',value)"/></el-form-item>
            <el-form-item label="注解"><KeyValueFields v-model="draft.metadata.annotations" label="注解" add-label="添加注解" :disabled="busy||!authorized" @change="touch" @validity="value=>setValidity('注解',value)"/></el-form-item>
          </div>
        </details>
      </el-form>
      <p v-else-if="loading" class="simple-resource-loading" role="status">正在读取资源…</p>
      <p v-if="draft&&!authorized" class="simple-resource-permission" role="alert">当前账号没有此目标资源的编辑权限。</p>
    </div>
    <template #footer>
      <p v-if="draft" class="simple-resource-check" role="status">{{canSave?'预检通过，可以'+(creating?'创建':'保存'):checked?'配置已更改，请重新预检':'填写完成后执行服务端预检'}}</p>
      <div class="simple-resource-actions">
        <el-button :disabled="busy" @click="requestClose">取消</el-button>
        <el-button :loading="checking" :disabled="busy||!draft||!authorized" @click="check">服务端预检</el-button>
        <el-button type="primary" :loading="saving" :disabled="!canSave" @click="save">{{creating?'创建':'保存'}}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import {ref,computed,watch,onMounted,onUnmounted,nextTick} from 'vue'
import {ElMessage,ElMessageBox} from 'element-plus'
import api from '../api'
import {canResource} from '../utils/perm'
import {registerUnsavedGuard} from '../utils/navigation'
import {newResourceDraft,resourceBody,cloneResource,apiVersionOf} from '../utils/resource-form'
import {resourceTitle} from '../utils/resource-ui'
import KeyValueFields from './KeyValueFields.vue'

const props=defineProps({modelValue:Boolean,meta:{type:Object,required:true},clusterId:{type:String,required:true},namespace:String,namespaces:{type:Array,default:()=>[]},target:Object})
const emit=defineEmits(['update:modelValue','saved'])
const creating=computed(()=>!props.target)
const draft=ref(null),original=ref(null),binding=ref(null),baseline=ref(''),touched=ref(false),fieldErrors=ref({}),formKey=ref(0)
const loading=ref(false),checking=ref(false),saving=ref(false),checked=ref(null),error=ref(''),errorRef=ref(null),metadataOpen=ref(false)
const busy=computed(()=>loading.value||checking.value||saving.value)
const contextKey=computed(()=>JSON.stringify([props.modelValue,props.clusterId,props.meta.group,props.meta.version,props.meta.plural,props.meta.kind,props.meta.namespaced,props.target?.namespace,props.target?.name,creating.value?props.namespace:null]))
const namespaceOptions=computed(()=>[...new Set([...(props.namespaces||[]),draft.value?.metadata?.namespace].filter(ns=>ns&&!['all','_all','-'].includes(ns)))])
const authorized=computed(()=>isCurrent(binding.value)&&hasPermission(binding.value,draft.value?.metadata?.namespace))
const dirty=computed(()=>!!draft.value&&(touched.value||JSON.stringify(draft.value)!==baseline.value))
const metadataCount=computed(()=>Object.keys(draft.value?.metadata?.labels||{}).length+Object.keys(draft.value?.metadata?.annotations||{}).length)
const signature=computed(()=>{try{return JSON.stringify(currentBody())}catch{return ''}})
const canSave=computed(()=>!busy.value&&authorized.value&&!!signature.value&&checked.value===signature.value)
let generation=0,readController,errorSource='local'

function isCurrent(target){return !!target&&props.modelValue&&target.key===contextKey.value}
function hasPermission(target,namespace){return !!target&&canResource(target.meta,target.creating?'create':'update',target.meta.namespaced?namespace:undefined,target.clusterId)}
function touch(){touched.value=true}
function setValidity(key,value){fieldErrors.value={...fieldErrors.value,[key]:value}}
function currentBody(){
 if(!draft.value||!isCurrent(binding.value))throw new Error('资源目标已变化，请重新读取')
 const invalid=Object.entries(fieldErrors.value).find(([,value])=>value)
 if(invalid)throw new Error(`${invalid[0]}：${invalid[1]}`)
 return resourceBody(draft.value,{meta:binding.value.meta,creating:binding.value.creating,original:original.value})
}
async function showError(message,source='local'){errorSource=source;error.value=message;await nextTick();errorRef.value?.focus()}
function submit(target,body,dryRun){
 const m=target.meta,params={dryRun,clusterId:target.clusterId}
 return target.creating?api.create(m.group,m.version,m.plural,body.metadata.namespace,body,params):api.update(m.group,m.version,m.plural,target.namespace,target.name,body,params)
}
async function load(){
 const epoch=++generation;readController?.abort();readController=new AbortController()
 loading.value=false;checking.value=false;saving.value=false;checked.value=null;error.value='';errorSource='local';draft.value=null;original.value=null;baseline.value='';touched.value=false;fieldErrors.value={};metadataOpen.value=false;binding.value=null
 if(!props.modelValue)return
 const m={...props.meta},initialNamespace=m.namespaced?(props.namespace&&!['all','_all','-'].includes(props.namespace)?props.namespace:props.namespaces[0]||'default'):undefined
 const target={meta:m,clusterId:props.clusterId,creating:creating.value,namespace:m.namespaced?(creating.value?initialNamespace:props.target?.namespace):'_all',name:props.target?.name,key:contextKey.value}
 binding.value=target;loading.value=true
 try{
  if(!target.clusterId)throw new Error('缺少目标集群，请重新读取')
  if(!hasPermission(target,target.namespace))throw new Error('当前账号没有此目标资源的编辑权限')
  const value=target.creating?newResourceDraft(m,initialNamespace):await api.get(m.group,m.version,m.plural,target.namespace,target.name,{params:{clusterId:target.clusterId},signal:readController.signal})
  if(epoch!==generation||!isCurrent(target))return
  if(!target.creating&&(value?.kind!==m.kind||value?.apiVersion!==apiVersionOf(m)||value?.metadata?.name!==target.name||m.namespaced&&value?.metadata?.namespace!==target.namespace||!value?.metadata?.uid||!value?.metadata?.resourceVersion))throw new Error('资源身份或版本信息不完整，请重新读取后编辑')
  value.metadata||={};value.metadata.labels||={};value.metadata.annotations||={}
  original.value=cloneResource(value);draft.value=cloneResource(value);baseline.value=JSON.stringify(draft.value);formKey.value++
 }catch(e){if(epoch===generation&&!e.cancelled&&e.name!=='AbortError')await showError(e.message||'资源读取失败','server')}
 finally{if(epoch===generation)loading.value=false}
}
async function check(){
 if(busy.value||!isCurrent(binding.value)||!draft.value)return
 checked.value=null
 let body;try{body=currentBody()}catch(e){await showError(e.message);return}
 const target=binding.value,epoch=generation,snapshot=JSON.stringify(body)
 if(!hasPermission(target,body.metadata.namespace)){await showError('当前账号没有此目标资源的编辑权限');return}
 checking.value=true;error.value=''
 try{
  await submit(target,body,true)
  if(epoch!==generation||!isCurrent(target)||snapshot!==signature.value||!hasPermission(target,body.metadata.namespace))return
  checked.value=snapshot
 }catch(e){if(epoch===generation&&isCurrent(target))await showError(e.status===409?'资源版本已变化，草稿已保留。请保留所需修改，重新读取后合并。':e.message||'服务端预检失败','server')}
 finally{if(epoch===generation)checking.value=false}
}
async function save(){
 if(!canSave.value||!isCurrent(binding.value))return
 let body;try{body=currentBody()}catch(e){checked.value=null;await showError(e.message);return}
 if(JSON.stringify(body)!==checked.value){checked.value=null;await showError('配置已发生变化，请重新执行服务端预检');return}
 const target=binding.value,epoch=generation
 if(!hasPermission(target,body.metadata.namespace)){checked.value=null;await showError('当前账号没有此目标资源的编辑权限');return}
 saving.value=true;error.value=''
 try{
  const result=await submit(target,body,false)
  if(epoch!==generation||!isCurrent(target))return
  baseline.value=JSON.stringify(draft.value);touched.value=false;checked.value=null
  ElMessage.success(target.creating?'创建成功':'保存成功');emit('update:modelValue',false);emit('saved',result)
 }catch(e){if(epoch===generation&&isCurrent(target)){checked.value=null;await showError(e.status===409?'资源版本已变化，草稿已保留。请保留所需修改，重新读取后合并。':e.message||'保存失败，草稿已保留','server')}}
 finally{if(epoch===generation)saving.value=false}
}
async function allowLeave(){
 if(busy.value)return false
 if(!dirty.value)return true
 const epoch=generation,key=contextKey.value
 try{
  await ElMessageBox.confirm('表单内容尚未保存，确定放弃修改？','未保存的修改',{type:'warning',confirmButtonText:'放弃修改',cancelButtonText:'继续编辑'})
  if(epoch!==generation||key!==contextKey.value||busy.value)return false
  draft.value=JSON.parse(baseline.value);touched.value=false;fieldErrors.value={};checked.value=null;error.value='';formKey.value++
  return true
 }catch{return false}
}
async function requestClose(){if(await allowLeave())emit('update:modelValue',false)}
async function beforeClose(done){if(await allowLeave())done()}
async function reread(){if(await allowLeave())await load()}
function beforeUnload(event){if(props.modelValue&&(dirty.value||busy.value)){event.preventDefault();event.returnValue=''}}
const removeGuard=registerUnsavedGuard(()=>props.modelValue?allowLeave():true)
watch(contextKey,load)
watch([()=>JSON.stringify(draft.value),fieldErrors],()=>{if(errorSource==='local')error.value=''}, {deep:true})
onMounted(()=>{load();window.addEventListener('beforeunload',beforeUnload)})
onUnmounted(()=>{generation++;readController?.abort();removeGuard();window.removeEventListener('beforeunload',beforeUnload)})
</script>

<style>
.simple-resource-dialog.el-dialog{display:flex;flex-direction:column;max-height:calc(100dvh - 48px);padding:0;overflow:hidden;border-radius:14px;background:var(--kp-surface)}
.simple-resource-dialog .el-dialog__header{flex-shrink:0;margin:0;padding:20px 24px 16px;border-bottom:1px solid var(--kp-border)}
.simple-resource-dialog .el-dialog__title{font-size:18px;font-weight:650;color:var(--kp-text)}
.simple-resource-dialog .el-dialog__headerbtn{top:10px;right:10px;width:40px;height:40px}
.simple-resource-dialog .el-dialog__body{min-height:0;overflow:auto;padding:18px 24px 20px;overscroll-behavior:contain}
.simple-resource-dialog .el-dialog__footer{flex-shrink:0;padding:14px 24px 20px;border-top:1px solid var(--kp-border)}
.simple-resource-dialog .simple-resource-context{margin:0 0 18px;color:var(--kp-muted);font-size:12px;overflow-wrap:anywhere}
.simple-resource-dialog .el-form-item{margin-bottom:20px}
.simple-resource-dialog .el-form-item__label{padding-bottom:7px;color:var(--kp-text-2);font-size:13px}
.simple-resource-dialog .el-select{width:100%}
.simple-resource-dialog .simple-resource-error{padding:10px 12px;margin-bottom:18px;border:1px solid var(--el-color-danger-light-5);background:var(--el-color-danger-light-9);border-radius:8px;color:var(--el-color-danger);font-size:13px;overflow-wrap:anywhere}
.simple-resource-dialog .simple-resource-error p{margin:0 0 5px;line-height:1.6}
.simple-resource-dialog .simple-resource-error .el-button{font-size:12px}
.simple-resource-dialog .simple-resource-loading{padding:24px 0;text-align:center;color:var(--kp-muted)}
.simple-resource-dialog .simple-resource-metadata{margin-top:4px;border-top:1px solid var(--kp-border)}
.simple-resource-dialog .simple-resource-metadata summary{padding:16px 0 2px;color:var(--kp-text-2);font-size:13px;cursor:pointer}
.simple-resource-dialog .simple-resource-metadata summary>span{margin-left:8px;color:var(--kp-muted);font-size:12px}
.simple-resource-dialog .simple-resource-metadata-fields{padding-top:20px;min-width:0}
.simple-resource-dialog .simple-resource-metadata-fields .el-form-item:last-child{margin-bottom:0}
.simple-resource-dialog .kv-field-row{grid-template-columns:minmax(0,1fr) 16px minmax(0,1fr) 28px;gap:8px;padding:6px 8px 6px 12px;margin-bottom:10px;border-radius:9px;background:var(--kp-surface-2);border-color:var(--kp-border)}
.simple-resource-dialog .kv-field-row .el-input{min-width:0}
.simple-resource-dialog .kv-equals{width:16px;background:transparent;color:var(--kp-muted)}
.simple-resource-dialog .kv-add{border-radius:8px;background:var(--kp-surface-2);border-color:var(--kp-border)}
.simple-resource-dialog .simple-resource-permission{margin:16px 0 0;color:var(--el-color-warning-dark-2);font-size:13px}
.simple-resource-dialog .simple-resource-check{margin:0 0 12px;text-align:left;font-size:12px;color:var(--kp-muted)}
.simple-resource-dialog .simple-resource-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px}
.simple-resource-dialog .simple-resource-actions .el-button+.el-button{margin-left:0}
.simple-resource-dialog summary:focus-visible{outline:2px solid var(--kp-brand);outline-offset:4px;border-radius:3px}
@media(max-width:560px){.simple-resource-dialog .el-dialog__header{padding:18px 20px 14px}.simple-resource-dialog .el-dialog__body{padding:16px 20px 18px}.simple-resource-dialog .el-dialog__footer{padding:14px 20px 18px}.simple-resource-dialog .kv-field-row{grid-template-columns:minmax(0,1fr) 28px;padding:10px}.simple-resource-dialog .kv-equals{display:none}}
</style>
