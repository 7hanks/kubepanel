<template>
  <div class="resource-editor" v-loading="loading">
    <header class="editor-heading"><div><div class="editor-context">{{store.currentCluster?.name||store.currentClusterId}} <span>/</span> {{draft?.metadata?.namespace||'集群范围'}} <span>/</span> {{meta.kind}}</div><h1>{{creating?'新建':'编辑'}} {{meta.kind}}<span v-if="!creating"> · {{route.params.name}}</span></h1></div><div class="editor-heading-actions"><el-tag v-if="original?.metadata?.resourceVersion" type="info" effect="plain">RV {{original.metadata.resourceVersion}}</el-tag><el-button :disabled="busy" @click="cancel">取消</el-button><el-button type="primary" :disabled="!canSave" :loading="saving" @click="save">{{creating?'创建':'保存'}}</el-button></div></header>
    <div v-if="error" ref="errorRef" class="editor-error" role="alert" tabindex="-1"><strong>请检查以下问题</strong><p>{{error}}</p><el-button :disabled="busy" @click="reread">重新读取</el-button><el-button v-if="draft" :disabled="busy" @click="exportYaml">导出草稿</el-button></div>
    <el-alert v-if="!authorized&&!loading" type="warning" :closable="false" show-icon :title="meta.kind==='Secret'&&!creating&&!can('secret:read')?'编辑 Secret 需要独立的读取 Secret 权限，避免覆盖未读取的密文。':'当前账号没有此目标资源的编辑权限。'"/>
    <template v-if="draft&&!loadFailed&&authorized">
      <div class="editor-card" :key="formKey">
        <el-tabs v-model="activeTab" :before-leave="changeTab" class="editor-tabs">
          <el-tab-pane label="基本信息" name="basic"><el-form label-width="105px" :disabled="busy" class="editor-basic-form">
            <el-form-item v-if="meta.namespaced" label="命名空间" required><el-select v-model="draft.metadata.namespace" :disabled="!creating||busy" filterable allow-create default-first-option aria-label="命名空间"><el-option v-for="ns in namespaces" :key="ns" :label="ns" :value="ns"/></el-select></el-form-item>
            <el-form-item label="名称" required><el-input v-model="draft.metadata.name" :disabled="!creating||busy" aria-label="资源名称" placeholder="请输入资源名称"/></el-form-item>
            <el-form-item label="注解"><KeyValueFields v-model="draft.metadata.annotations" label="注解" add-label="添加注解" :disabled="busy" @change="touch" @validity="value=>setValidity('注解',value)"/></el-form-item>
            <el-form-item label="标签"><KeyValueFields v-model="draft.metadata.labels" label="标签" add-label="添加标签" :disabled="busy" @change="touch" @validity="value=>setValidity('标签',value)"/></el-form-item>
            <el-form-item v-if="['ConfigMap','Secret'].includes(meta.kind)" label="不可变"><el-switch v-model="draft.immutable" :disabled="busy||(!creating&&original?.immutable===true)" aria-label="不可变配置"/></el-form-item>
            <el-form-item v-if="meta.kind==='Secret'" label="Secret 类型"><el-select v-model="draft.type" :disabled="busy||!creating" filterable allow-create default-first-option aria-label="Secret 类型"><el-option v-for="type in ['Opaque','kubernetes.io/tls','kubernetes.io/dockerconfigjson','kubernetes.io/basic-auth']" :key="type" :label="type" :value="type"/></el-select></el-form-item>
          </el-form></el-tab-pane>
          <el-tab-pane v-if="workload&&meta.kind!=='Pod'" label="部署策略" name="strategy"><el-form label-width="105px" :disabled="busy"><WorkloadForm :model-value="draft" section="strategy" :creating="creating" :disabled="busy"/></el-form></el-tab-pane>
          <el-tab-pane v-if="workload" :label="meta.kind==='Pod'?'容器组配置':'容器组模板'" name="template"><div class="template-workspace"><nav class="template-nav" aria-label="容器组配置导航"><button v-for="item in templateSections" :key="item.key" type="button" :class="{active:templateSection===item.key}" @click="templateSection=item.key">{{item.label}}</button></nav><section class="template-content"><el-form label-width="100px" :disabled="busy"><template v-if="templateSection==='basic'"><el-form-item label="容器组标签"><KeyValueFields :model-value="templateMetadata.labels" label="容器组标签" :disabled="busy" @update:model-value="value=>setTemplateMetadata('labels',value)" @change="touch" @validity="value=>setValidity('容器组标签',value)"/></el-form-item><el-form-item label="容器组注解"><KeyValueFields :model-value="templateMetadata.annotations" label="容器组注解" :disabled="busy" @update:model-value="value=>setTemplateMetadata('annotations',value)" @change="touch" @validity="value=>setValidity('容器组注解',value)"/></el-form-item></template><WorkloadForm v-else :model-value="draft" :section="templateSection" :creating="creating" :disabled="busy"/></el-form></section></div></el-tab-pane>
          <el-tab-pane v-if="meta.kind==='ConfigMap'" label="条目模式" name="entries"/>
          <el-tab-pane v-if="meta.kind==='ConfigMap'" label="标签页模式" name="files"/>
          <el-tab-pane v-if="meta.kind==='Secret'" label="数据条目" name="secret"><el-form label-width="125px" :disabled="busy"><el-form-item label="文本数据"><KeyValueFields v-model="draft.stringData" multiline label="文本数据" :disabled="busy" @change="touch" @validity="value=>setValidity('文本数据',value)"/></el-form-item><el-form-item v-if="!creating||draft.data" label="Base64 数据"><KeyValueFields v-model="draft.data" multiline label="Base64 数据" :disabled="busy" @change="touch" @validity="value=>setValidity('Base64 数据',value)"/></el-form-item></el-form></el-tab-pane>
          <el-tab-pane v-if="!workload||Object.keys(extraFields).length" :label="workload||meta.kind==='ConfigMap'?'其他字段':'资源配置'" name="fields"><StructuredFields :model-value="extraFields" :reserved-keys="excluded" :disabled="busy" path="resource" @update:model-value="setExtraFields"/></el-tab-pane>
          <el-tab-pane label="YAML" name="yaml"><div class="editor-yaml-tools"><el-button :disabled="busy" @click="fileInput.click()">导入 YAML</el-button><el-button :disabled="busy" @click="exportYaml">导出 YAML</el-button><span class="kp-muted">与表单共用同一份配置</span><input ref="fileInput" type="file" accept=".yaml,.yml,.txt" hidden @change="importFile"/></div><textarea v-model="yamlText" class="kp-yaml editor-yaml" :disabled="busy" spellcheck="false" aria-label="资源 YAML 草稿" @input="touch"/></el-tab-pane>
        </el-tabs>
        <div v-if="meta.kind==='ConfigMap'" v-show="['entries','files'].includes(activeTab)" class="configmap-editor"><div class="configmap-toolbar"><h2>配置条目</h2><span class="kp-muted">文件名作为键，配置内容作为值</span></div><KeyValueFields v-model="draft.data" label="配置条目" :mode="activeTab==='files'?'tabs':'rows'" multiline :disabled="busy||(!creating&&original?.immutable===true)" @change="touch" @validity="value=>setValidity('配置条目',value)"/></div>
      </div>
      <footer class="editor-footer"><span class="editor-check-state" :class="{checked:canSave}">{{canSave?'当前配置已通过预检，可保存':checked?'配置已更改，请重新预检':'填写完成后，先预检并核对变更'}}</span><div><el-button :disabled="busy" @click="preview">变更预览</el-button><el-button :loading="checking" :disabled="busy||!authorized" @click="check">服务端预检</el-button><el-button type="primary" :disabled="!canSave" :loading="saving" @click="save">{{creating?'创建':'保存'}}</el-button></div></footer>
    </template>
    <el-dialog v-model="previewOpen" :title="creating?'创建预览':'变更预览'" width="min(1300px,96vw)" top="5vh"><YamlDiff :before="creating?'':originalYaml" :after="previewYaml"/><template #footer><el-button @click="previewOpen=false">返回表单</el-button><el-button type="primary" :disabled="!canSave" :loading="saving" @click="save">确认{{creating?'创建':'保存'}}</el-button></template></el-dialog>
  </div>
</template>
<script setup>
import {ref,computed,watch,onMounted,onUnmounted,nextTick} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {ElMessage,ElMessageBox} from 'element-plus'
import {dump} from 'js-yaml'
import api from '../api'
import {store} from '../store'
import {metaFromRoute} from '../config/resources'
import {can,canResource} from '../utils/perm'
import {cpath,nsPath} from '../utils/path'
import {registerUnsavedGuard} from '../utils/navigation'
import {WORKLOAD_KINDS,newResourceDraft,resourceBody,parseResourceYaml,cloneResource,podTemplate,mergeFormFields} from '../utils/resource-form'
import {MAX_YAML_IMPORT_BYTES} from '../utils/yaml-import'
import KeyValueFields from '../components/KeyValueFields.vue'
import StructuredFields from '../components/StructuredFields.vue'
import WorkloadForm from '../components/WorkloadForm.vue'
import YamlDiff from '../components/YamlDiff.vue'

const route=useRoute(),router=useRouter(),meta=computed(()=>metaFromRoute(route.params,store.discovery))
const creating=computed(()=>route.name==='resource-create'),workload=computed(()=>WORKLOAD_KINDS.includes(meta.value.kind))
const draft=ref(null),original=ref(null),baseline=ref(''),target=ref(null),loading=ref(false),loadFailed=ref(false),error=ref(''),errorRef=ref(null)
const activeTab=ref('basic'),templateSection=ref('containers'),yamlText=ref(''),fileInput=ref(null),fieldErrors=ref({}),touched=ref(false),formKey=ref(0)
const saving=ref(false),checking=ref(false),importing=ref(false),checked=ref(null),previewOpen=ref(false),previewYaml=ref(''),errorSource=ref('local')
const busy=computed(()=>saving.value||checking.value||importing.value||loading.value)
const namespaces=computed(()=>store.namespaces||[])
const authorized=computed(()=>canResource(meta.value,creating.value?'create':'update',draft.value?.metadata?.namespace,store.currentClusterId)&&(creating.value||meta.value.kind!=='Secret'||can('secret:read')))
const templateMetadata=computed(()=>podTemplate(draft.value)?.metadata||{})
const templateSections=[{key:'basic',label:'基本信息'},{key:'containers',label:'容器信息'},{key:'volumes',label:'数据卷'},{key:'pod',label:'容器组'}]
const excluded=computed(()=>['apiVersion','kind','metadata','status',...(workload.value?['spec']:[]),...(['ConfigMap','Secret'].includes(meta.value.kind)?['data','stringData','type','immutable']:[])])
const extraFields=computed(()=>Object.fromEntries(Object.entries(draft.value||{}).filter(([key])=>!excluded.value.includes(key))))
const originalYaml=computed(()=>original.value?dump(original.value,{noRefs:true,lineWidth:120}):'')
const options=()=>({meta:meta.value,creating:creating.value,original:original.value})
function currentBody(){const invalid=Object.entries(fieldErrors.value).find(([,value])=>value);if(invalid)throw new Error(`${invalid[0]}：${invalid[1]}`);return activeTab.value==='yaml'?resourceBody(parseResourceYaml(yamlText.value,options()),options()):resourceBody(draft.value,options())}
const signature=computed(()=>{try{return JSON.stringify(currentBody())}catch{return ''}})
const targetKey=computed(()=>JSON.stringify([route.fullPath,store.currentClusterId]))
const canSave=computed(()=>!busy.value&&authorized.value&&!!signature.value&&checked.value===signature.value)
const dirty=computed(()=>touched.value||!!draft.value&&(JSON.stringify(draft.value)!==baseline.value||activeTab.value==='yaml'&&yamlText.value!==dump(draft.value,{noRefs:true,lineWidth:120})))
let generation=0,leavingAfterSave=false
const removeGuard=registerUnsavedGuard(async()=>{if(leavingAfterSave)return true;if(busy.value)return false;if(!dirty.value)return true;try{await ElMessageBox.confirm('表单内容尚未保存，确定放弃修改？','未保存的修改',{type:'warning',confirmButtonText:'放弃修改'});draft.value=cloneResource(original.value);baseline.value=JSON.stringify(draft.value);yamlText.value=dump(draft.value,{noRefs:true,lineWidth:120});touched.value=false;fieldErrors.value={};checked.value=null;formKey.value++;return true}catch{return false}})
function touch(){touched.value=true}
function setValidity(key,value){fieldErrors.value={...fieldErrors.value,[key]:value}}
function setTemplateMetadata(key,value){const template=podTemplate(draft.value);if(template){template.metadata||={};template.metadata[key]=value}}
function setExtraFields(value){draft.value=mergeFormFields(draft.value,excluded.value,value)}
async function showError(message,source='local'){errorSource.value=source;error.value=message;await nextTick();errorRef.value?.focus()}
async function load(){
 const epoch=++generation;loading.value=true;error.value='';loadFailed.value=false;checked.value=null;previewOpen.value=false;fieldErrors.value={};touched.value=false;draft.value=null
 const m={...meta.value},clusterId=store.currentClusterId,isCreate=creating.value
 const initialNamespace=store.namespace==='all'?(namespaces.value[0]||'default'):store.namespace
 target.value={meta:m,clusterId,creating:isCreate,namespace:nsPath(route.params.namespace),name:route.params.name,key:targetKey.value}
 try{
  if(!canResource(m,isCreate?'create':'update',isCreate?initialNamespace:route.params.namespace,clusterId)||!isCreate&&m.kind==='Secret'&&!can('secret:read'))return
  const value=isCreate?newResourceDraft(m,initialNamespace):await api.get(m.group,m.version,m.plural,target.value.namespace,target.value.name)
  if(epoch!==generation)return
  value.metadata||={};if(WORKLOAD_KINDS.includes(m.kind)&&podTemplate(value))podTemplate(value).metadata||={}
  original.value=cloneResource(value);draft.value=cloneResource(value);baseline.value=JSON.stringify(draft.value);activeTab.value='basic';templateSection.value='containers';yamlText.value=dump(value,{noRefs:true,lineWidth:120});formKey.value++
 }catch(e){if(epoch===generation){loadFailed.value=true;await showError(e.message||'资源读取失败','server')}}finally{if(epoch===generation)loading.value=false}
}
async function changeTab(next,previous){
 if(busy.value)return false
 try{
  const invalid=Object.values(fieldErrors.value).find(Boolean);if(invalid)throw new Error('请先修正表单条目：'+invalid)
  if(previous==='yaml'&&yamlText.value!==dump(draft.value,{noRefs:true,lineWidth:120})){draft.value=parseResourceYaml(yamlText.value,options());fieldErrors.value={}}
  if(next==='yaml')yamlText.value=dump(draft.value,{noRefs:true,lineWidth:120})
  return true
 }catch(e){await showError(e.message);return false}
}
function submit(body,dryRun){const t=target.value,m=t.meta,params={dryRun,clusterId:t.clusterId};return t.creating?api.create(m.group,m.version,m.plural,body.metadata.namespace,body,params):api.update(m.group,m.version,m.plural,t.namespace,t.name,body,params)}
async function check(){
 if(busy.value||!authorized.value)return
 checked.value=null
 let body;try{body=currentBody()}catch(e){await showError(e.message);return}
 const snapshot=JSON.stringify(body),key=targetKey.value,epoch=generation;checking.value=true;error.value=''
 try{await submit(body,true);if(epoch!==generation||key!==targetKey.value||snapshot!==signature.value||!authorized.value)return;checked.value=snapshot;previewYaml.value=dump(body,{noRefs:true,lineWidth:120});previewOpen.value=true;ElMessage.success('预检通过，请核对变更后保存')}
 catch(e){await showError(e.status===409?'资源版本已变化，当前草稿已保留。请复制或导出草稿，重新读取后合并修改。':e.message||'服务端预检失败','server')}
 finally{checking.value=false}
}
async function preview(){try{previewYaml.value=dump(currentBody(),{noRefs:true,lineWidth:120});previewOpen.value=true}catch(e){await showError(e.message)}}
async function save(){
 if(!canSave.value)return
 const body=currentBody(),snapshot=signature.value,epoch=generation;saving.value=true;error.value=''
 try{await submit(body,false);if(epoch!==generation)return;previewOpen.value=false;baseline.value=JSON.stringify(draft.value);touched.value=false;checked.value=null;ElMessage.success(creating.value?'创建成功':'保存成功');leavingAfterSave=true;await router.push(listPath())}
 catch(e){checked.value=null;previewOpen.value=false;await showError(e.status===409?'资源版本已变化，草稿已保留。请导出草稿，重新读取并核对修改。':e.message||'保存失败，草稿已保留','server')}
 finally{saving.value=false;leavingAfterSave=false}
}
function listPath(){return cpath(`/r/${route.params.group}/${route.params.version}/${route.params.plural}`)}
function cancel(){if(!busy.value)router.push(listPath())}
async function reread(){if(busy.value)return;if(dirty.value){try{await ElMessageBox.confirm('重新读取会丢弃当前未保存的草稿，请先导出需要保留的内容。','重新读取',{type:'warning',confirmButtonText:'丢弃并重新读取'})}catch{return}}await load()}
function beforeUnload(event){if(dirty.value){event.preventDefault();event.returnValue=''}}
async function importFile(event){const file=event.target.files?.[0];event.target.value='';if(!file||busy.value)return;const epoch=generation;importing.value=true;try{if(file.size>MAX_YAML_IMPORT_BYTES)throw new Error('YAML 文件不能超过 2 MiB');const text=await file.text(),value=parseResourceYaml(text,options());if(epoch!==generation)return;draft.value=value;yamlText.value=dump(value,{noRefs:true,lineWidth:120});fieldErrors.value={};touch();checked.value=null}catch(e){await showError(e.message)}finally{if(epoch===generation)importing.value=false}}
function exportYaml(){const content=activeTab.value==='yaml'?yamlText.value:dump(draft.value,{noRefs:true,lineWidth:120});const url=URL.createObjectURL(new Blob([content],{type:'application/yaml;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`${draft.value.metadata?.name||meta.value.kind}.yaml`;a.click();URL.revokeObjectURL(url)}
watch(()=>[route.fullPath,store.currentClusterId],load)
watch(()=>store.namespace,()=>{if(!dirty.value&&!busy.value)load()})
watch([()=>JSON.stringify(draft.value),fieldErrors],()=>{if(errorSource.value==='local')error.value=''}, {deep:true})
onMounted(()=>{load();window.addEventListener('beforeunload',beforeUnload)})
onUnmounted(()=>{generation++;removeGuard();window.removeEventListener('beforeunload',beforeUnload)})
</script>
<style scoped>
.resource-editor{min-width:0;padding-bottom:12px}.editor-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px}.editor-context{display:flex;gap:10px;align-items:center;color:var(--kp-muted);font-size:13px;overflow-wrap:anywhere}.editor-heading h1{font-size:21px;font-weight:650;margin:10px 0 0}.editor-heading-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.editor-heading-actions>.el-button+.el-button{margin-left:0}.editor-card{background:var(--kp-surface);border:1px solid var(--kp-border);border-radius:10px;min-height:510px;margin-top:16px;padding:0 24px 24px;min-width:0}.editor-tabs :deep(.el-tabs__header){margin:0 -24px 26px;padding:0 24px;background:var(--kp-surface-2);border-radius:10px 10px 0 0}.editor-tabs :deep(.el-tabs__item){height:52px;padding:0 24px}.editor-tabs :deep(.el-tab-pane){min-width:0}.editor-tabs :deep(.el-form-item){margin-bottom:22px}.editor-tabs :deep(.el-select){width:100%}.editor-basic-form{padding-top:8px;max-width:1350px}.editor-basic-form>.el-form-item:first-child :deep(.el-select){max-width:420px}.editor-basic-form>.el-form-item:nth-child(2) :deep(.el-input){max-width:680px}.template-workspace{display:grid;grid-template-columns:115px minmax(0,1fr);gap:24px}.template-nav{display:flex;flex-direction:column;gap:5px;border-right:1px solid var(--kp-border);padding-right:12px}.template-nav>button{border:0;background:transparent;color:var(--kp-text-2);font:inherit;text-align:left;padding:12px;border-radius:7px;cursor:pointer;white-space:nowrap}.template-nav>button.active{color:var(--kp-brand);background:var(--kp-side-active);font-weight:600}.template-content{min-width:0}.configmap-toolbar{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:20px}.configmap-toolbar h2{margin:0;font-size:15px}.configmap-toolbar>span{font-size:13px}.editor-yaml-tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.editor-yaml-tools span{font-size:12px}.editor-yaml{width:100%;min-height:55vh;resize:vertical}.editor-footer{position:sticky;bottom:0;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:16px 20px;background:var(--kp-surface);border:1px solid var(--kp-border);border-radius:10px;margin-top:16px;box-shadow:0 -4px 12px rgba(15,23,42,.03)}.editor-footer>div{display:flex;gap:8px;flex-wrap:wrap}.editor-footer .el-button+.el-button{margin-left:0}.editor-check-state{color:var(--kp-muted);font-size:13px}.editor-check-state.checked{color:var(--el-color-success)}.editor-error{background:var(--el-color-danger-light-9);border:1px solid var(--el-color-danger-light-5);color:var(--el-color-danger);border-radius:8px;padding:14px 18px;margin-bottom:16px;overflow-wrap:anywhere}.editor-error p{margin:8px 0 0;font-size:13px}
@media(max-width:900px){.editor-card{padding:0 16px 20px}.editor-tabs :deep(.el-tabs__header){margin:0 -16px 20px;padding:0 16px}.template-workspace{grid-template-columns:95px minmax(0,1fr);gap:14px}.template-nav{padding-right:8px}.template-nav>button{padding:10px 6px}}
@media(max-width:700px){.editor-heading h1{font-size:18px}.editor-heading-actions{width:100%}.editor-card{padding:0 12px 16px}.editor-tabs :deep(.el-tabs__header){margin:0 -12px 20px;padding:0 10px}.template-workspace{grid-template-columns:minmax(0,1fr)}.template-nav{flex-direction:row;flex-wrap:wrap;border-right:0;border-bottom:1px solid var(--kp-border);padding-bottom:10px}.editor-card :deep(.el-form-item){display:block}.editor-card :deep(.el-form-item__label){display:block;text-align:left;float:none;height:auto;line-height:1.6;margin-bottom:7px}.editor-card :deep(.el-form-item__content){margin-left:0!important;display:block}.editor-footer{padding:12px}.editor-footer>div{width:100%}.editor-card{min-height:440px}}
</style>
