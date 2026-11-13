<template>
  <div class="resource-editor" :class="{'service-editor':meta.kind==='Service'}" v-loading="loading">
    <template v-if="uiMode==='form'">
    <header class="editor-hero"><div><nav class="editor-context" aria-label="当前位置"><RouterLink :to="cpath('/overview',store.currentClusterId)" aria-label="返回集群概览">{{store.currentCluster?.name||store.currentClusterId}}</RouterLink><span aria-hidden="true">/</span><a :href="listPath()" :aria-label="`返回${resourceTitle(meta)}列表`" @click="backToList">{{draft?.metadata?.namespace||'集群范围'}}</a></nav><h1>{{creating?'新建':'编辑'}}{{resourceTitle(meta)}}<span v-if="!creating" class="hero-resource-name">{{route.params.name}}</span></h1></div><div class="editor-heading-actions"><el-button :disabled="busy" @click="cancel">取消</el-button><el-button type="primary" :disabled="!canSave" :loading="saving" @click="save">{{creating?'创建':'保存'}}</el-button></div></header>
    <div v-if="error" ref="errorRef" class="editor-error" role="alert" tabindex="-1"><span class="editor-error-icon" aria-hidden="true">!</span><div><strong>请检查以下问题</strong><p>{{error}}</p></div><div class="editor-error-actions"><el-button :disabled="busy" @click="reread">重新读取</el-button><el-button v-if="draft" :disabled="busy" @click="exportYaml">导出草稿</el-button></div></div>
    <el-alert v-if="!authorized&&!loading" type="warning" :closable="false" show-icon :title="meta.kind==='Secret'&&!creating&&!can('secret:read')?'编辑 Secret 需要独立的读取 Secret 权限，避免覆盖未读取的密文。':'当前账号没有此目标资源的编辑权限。'"/>


    <template v-if="draft&&!loadFailed&&authorized">
      <div class="editor-card" :key="formKey">
        <el-tabs v-model="activeTab" :before-leave="changeTab" class="editor-tabs">
          <el-tab-pane name="basic">
            <template #label><span class="tab-inner"><svg aria-hidden="true" viewBox="0 0 24 24"><path :d="tabIcons.basic"/></svg>基本信息</span></template>
            <el-form label-width="105px" :disabled="busy" class="editor-basic-form">
              <el-form-item v-if="meta.namespaced" label="命名空间" required><el-select v-model="draft.metadata.namespace" :disabled="!creating||busy" filterable allow-create default-first-option aria-label="命名空间" :class="{'editor-static-field':!creating}"><el-option v-for="ns in namespaces" :key="ns" :label="ns" :value="ns"/></el-select></el-form-item>
              <el-form-item label="名称" required><el-input v-model="draft.metadata.name" :disabled="!creating||busy" aria-label="资源名称" :class="{'editor-static-field':!creating}" placeholder="请输入资源名称"/></el-form-item>
              <el-form-item label="注解"><KeyValueFields v-model="draft.metadata.annotations" label="注解" add-label="添加注解" :disabled="busy" @change="touch" @validity="value=>setValidity('注解',value)"/></el-form-item>
              <el-form-item label="标签"><KeyValueFields v-model="draft.metadata.labels" label="标签" add-label="添加标签" :disabled="busy" @change="touch" @validity="value=>setValidity('标签',value)"/></el-form-item>
              <el-form-item v-if="['ConfigMap','Secret'].includes(meta.kind)" label="不可变"><el-switch v-model="draft.immutable" :disabled="busy||(!creating&&original?.immutable===true)" aria-label="不可变配置"/></el-form-item>
              <el-form-item v-if="meta.kind==='Secret'" label="Secret 类型"><el-select v-model="draft.type" :disabled="busy||!creating" filterable allow-create default-first-option aria-label="Secret 类型"><el-option v-for="type in ['Opaque','kubernetes.io/tls','kubernetes.io/dockerconfigjson','kubernetes.io/basic-auth']" :key="type" :label="type" :value="type"/></el-select></el-form-item>
            </el-form>
          </el-tab-pane>
          <el-tab-pane v-if="meta.kind==='Service'" label="基本配置" name="service-config"/>
          <el-tab-pane v-if="meta.kind==='Service'" label="高级配置" name="service-advanced"/>
          <el-tab-pane v-if="storage" label="存储配置" name="storage"><StorageForm :model-value="draft" :original="original" :creating="creating" :disabled="busy" @change="touch" @validity="value=>setValidity('存储配置',value)"/></el-tab-pane>
          <el-tab-pane v-if="workload&&meta.kind!=='Pod'" name="strategy">
            <template #label><span class="tab-inner"><svg aria-hidden="true" viewBox="0 0 24 24"><path :d="tabIcons.strategy"/></svg>部署策略</span></template>
            <el-form label-width="105px" :disabled="busy"><WorkloadForm :model-value="draft" section="strategy" :creating="creating" :disabled="busy" @change="touch" @validity="value=>setValidity('部署策略',value)"/></el-form>
          </el-tab-pane>
          <el-tab-pane v-if="workload" :label="meta.kind==='Pod'?'容器组配置':'容器组模板'" name="template"><div class="template-workspace"><nav class="template-nav" aria-label="容器组配置导航"><button v-for="item in templateSections" :key="item.key" type="button" :class="{active:templateSection===item.key}" @click="templateSection=item.key">{{item.label}}</button></nav><section class="template-content"><el-form label-width="100px" :disabled="busy"><template v-if="templateSection==='basic'"><el-form-item label="容器组标签"><KeyValueFields :model-value="templateMetadata.labels" label="容器组标签" :disabled="busy" @update:model-value="value=>setTemplateMetadata('labels',value)" @change="touch" @validity="value=>setValidity('容器组标签',value)"/></el-form-item><el-form-item label="容器组注解"><KeyValueFields :model-value="templateMetadata.annotations" label="容器组注解" :disabled="busy" @update:model-value="value=>setTemplateMetadata('annotations',value)" @change="touch" @validity="value=>setValidity('容器组注解',value)"/></el-form-item></template><WorkloadForm v-else :model-value="draft" :section="templateSection" :creating="creating" :disabled="busy" @change="touch" @validity="value=>setValidity('容器组设置',value)"/></el-form></section></div></el-tab-pane>
          <el-tab-pane v-if="['ConfigMap','Secret'].includes(meta.kind)" name="entries">
            <template #label><span class="tab-inner"><svg aria-hidden="true" viewBox="0 0 24 24"><path :d="tabIcons.entries"/></svg>条目模式</span></template>
          </el-tab-pane>
          <el-tab-pane v-if="['ConfigMap','Secret'].includes(meta.kind)" name="files">
            <template #label><span class="tab-inner"><svg aria-hidden="true" viewBox="0 0 24 24"><path :d="tabIcons.files"/></svg>标签页模式</span></template>
          </el-tab-pane>
          <el-tab-pane v-if="!storage&&meta.kind!=='Service'&&(!['ConfigMap','Secret'].includes(meta.kind)&&!workload||Object.keys(extraFields).length)" :label="workload||storage||['ConfigMap','Secret'].includes(meta.kind)?'其他字段':'资源配置'" name="fields"><StructuredFields :model-value="extraFields" :reserved-keys="excluded" :disabled="busy" path="resource" @update:model-value="setExtraFields"/></el-tab-pane>
        </el-tabs>
        <ServiceForm v-if="meta.kind==='Service'" v-show="['service-config','service-advanced'].includes(activeTab)" :model-value="draft" :section="activeTab==='service-advanced'?'advanced':'config'" :namespace="draft.metadata.namespace" :cluster-id="target.clusterId" :creating="creating" :disabled="busy" @change="touch" @validity="value=>setValidity('选择器',value)"/>
        <details v-if="meta.kind==='Service'&&Object.keys(extraFields).length" v-show="activeTab==='service-advanced'" class="service-root-fields"><summary>其他资源字段</summary><StructuredFields :model-value="extraFields" :reserved-keys="excluded" :disabled="busy" path="resource" @update:model-value="setExtraFields"/></details>
        <el-form v-if="meta.kind==='Secret'" v-show="['entries','files'].includes(activeTab)" label-position="top" class="secret-entry-editor" :disabled="busy||(!creating&&original?.immutable===true)">
          <el-form-item label="文本数据（stringData）"><KeyValueFields v-model="draft.stringData" :mode="activeTab==='files'?'tabs':'rows'" multiline label="文本数据" :disabled="busy||(!creating&&original?.immutable===true)" @change="touch" @validity="value=>setValidity('文本数据',value)"/></el-form-item>
          <el-form-item label="Base64 数据（data）"><KeyValueFields v-model="draft.data" :mode="activeTab==='files'?'tabs':'rows'" multiline label="Base64 数据" :disabled="busy||(!creating&&original?.immutable===true)" @change="touch" @validity="value=>setValidity('Base64 数据',value)"/></el-form-item>
        </el-form>
        <div v-if="meta.kind==='ConfigMap'" v-show="['entries','files'].includes(activeTab)" class="configmap-editor">
          <div class="cm-toolbar">
            <span class="cm-toolbar-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M14 3v5h5"/></svg></span>
            <div class="cm-toolbar-copy"><h2>配置条目</h2><p>{{activeTab==='files'?'左侧切换文件，右侧编辑内容 · 适合多文件配置':'文件名作为键，配置内容作为值 · 支持多行文本'}}</p></div>
            <div class="cm-toolbar-side"><span class="cm-pill"><i></i>{{entryCount}} 个文件</span><span class="cm-pill cm-pill--soft">{{formatBytes(contentBytes)}}</span></div>
          </div>
          <KeyValueFields v-model="draft.data" label="配置条目" :mode="activeTab==='files'?'tabs':'rows'" multiline :disabled="busy||(!creating&&original?.immutable===true)" @change="touch" @validity="value=>setValidity('配置条目',value)"/>
        </div>
      </div>
      <footer class="editor-footer">
        <span class="editor-check-state" :class="{checked:canSave}">{{canSave?'当前配置已通过预检，可保存':checked?'配置已更改，请重新预检':'填写完成后，先预检并核对变更'}}</span>
        <div class="editor-footer-actions"><el-button :disabled="busy" @click="preview">变更预览</el-button><el-button :loading="checking" :disabled="busy||!authorized" @click="check">服务端预检</el-button><el-button type="primary" :disabled="!canSave" :loading="saving" @click="save">{{creating?'创建':'保存'}}</el-button></div>
      </footer>
    </template>
    <el-dialog v-model="previewOpen" :title="creating?'创建预览':'变更预览'" class="resource-preview-dialog" width="min(1080px,calc(100vw - 32px))" top="4vh" append-to-body destroy-on-close :close-on-click-modal="!busy" :close-on-press-escape="!busy" :before-close="done=>{if(!busy)done()}"><YamlDiff :before="creating?'':originalYaml" :after="previewYaml"/><template #footer><el-button :disabled="busy" @click="previewOpen=false">关闭预览</el-button><el-button type="primary" :disabled="!canSave" :loading="saving" @click="save">确认{{creating?'创建':'保存'}}</el-button></template></el-dialog>
    </template>
    <SimpleResourceDialog v-else-if="uiMode==='simple'" :model-value="true" :meta="meta" :cluster-id="store.currentClusterId" :namespace="store.namespace==='all'?(store.namespaces[0]||'default'):store.namespace" :namespaces="namespaces" :target="creating?null:{namespace:route.params.namespace,name:route.params.name}" @update:model-value="value=>{if(!value)cancel()}" @saved="cancel"/>
    <el-result v-else-if="uiMode==='none'" icon="info" :title="resourceTitle(meta)" :sub-title="policy.reason"><template #extra><el-button @click="cancel">返回列表</el-button></template></el-result>
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
import {WORKLOAD_KINDS,newResourceDraft,resourceBody,cloneResource,podTemplate,mergeFormFields} from '../utils/resource-form'
import KeyValueFields from '../components/KeyValueFields.vue'
import StructuredFields from '../components/StructuredFields.vue'
import WorkloadForm from '../components/WorkloadForm.vue'
import YamlDiff from '../components/YamlDiff.vue'
import ServiceForm from '../components/ServiceForm.vue'
import StorageForm from '../components/StorageForm.vue'
import SimpleResourceDialog from '../components/SimpleResourceDialog.vue'
import {resourceUiPolicy} from '../utils/resource-policy'
import {resourceTitle} from '../utils/resource-ui'

const route=useRoute(),router=useRouter(),meta=computed(()=>metaFromRoute(route.params,store.discovery))
const creating=computed(()=>route.name==='resource-create'),workload=computed(()=>WORKLOAD_KINDS.includes(meta.value.kind))
const storage=computed(()=>['','_core'].includes(meta.value.group||'')&&['PersistentVolumeClaim','PersistentVolume'].includes(meta.value.kind)||meta.value.group==='storage.k8s.io'&&meta.value.kind==='StorageClass')
const policy=computed(()=>resourceUiPolicy(meta.value)),uiMode=computed(()=>creating.value?policy.value.create:policy.value.edit)
const draft=ref(null),original=ref(null),baseline=ref(''),target=ref(null),loading=ref(false),loadFailed=ref(false),error=ref(''),errorRef=ref(null)
const activeTab=ref('basic'),templateSection=ref('containers'),fieldErrors=ref({}),touched=ref(false),formKey=ref(0)
const saving=ref(false),checking=ref(false),checked=ref(null),previewOpen=ref(false),previewYaml=ref(''),errorSource=ref('local')
const busy=computed(()=>saving.value||checking.value||loading.value)
const namespaces=computed(()=>store.namespaces||[])
const authorized=computed(()=>canResource(meta.value,creating.value?'create':'update',draft.value?.metadata?.namespace,store.currentClusterId)&&(creating.value||meta.value.kind!=='Secret'||can('secret:read')))
const templateMetadata=computed(()=>podTemplate(draft.value)?.metadata||{})
const templateSections=[{key:'basic',label:'基本信息'},{key:'containers',label:'容器信息'},{key:'volumes',label:'数据卷'},{key:'pod',label:'容器组'}]
const excluded=computed(()=>['apiVersion','kind','metadata','status',...(workload.value||meta.value.kind==='Service'||storage.value&&meta.value.kind!=='StorageClass'?['spec']:[]),...(storage.value&&meta.value.kind==='StorageClass'?['provisioner','parameters','reclaimPolicy','volumeBindingMode','allowVolumeExpansion','mountOptions','allowedTopologies']:[]),...(['ConfigMap','Secret'].includes(meta.value.kind)?['data','stringData','type','immutable']:[])])
const extraFields=computed(()=>Object.fromEntries(Object.entries(draft.value||{}).filter(([key])=>!excluded.value.includes(key))))
const tabIcons={
  basic:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 11v6 M12 7h.01',
  strategy:'M4 19V9 M10 19V5 M16 19v-7 M22 19V7',
  entries:'M4 6h16 M4 12h16 M4 18h10',
  files:'M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z'
}
const originalYaml=computed(()=>original.value?dump(original.value,{noRefs:true,lineWidth:120}):'')
const options=()=>({meta:meta.value,creating:creating.value,original:original.value})
function currentBody(){const invalid=Object.entries(fieldErrors.value).find(([,value])=>value);if(invalid)throw new Error(`${invalid[0]}：${invalid[1]}`);return resourceBody(draft.value,options())}
const signature=computed(()=>{try{return JSON.stringify(currentBody())}catch{return ''}})
const targetKey=computed(()=>JSON.stringify([route.fullPath,store.currentClusterId]))
const canSave=computed(()=>!busy.value&&authorized.value&&!!signature.value&&checked.value===signature.value)
const dirty=computed(()=>touched.value||!!draft.value&&JSON.stringify(draft.value)!==baseline.value)
const entryMap=computed(()=>{const d=draft.value||{};return ['ConfigMap','Secret'].includes(meta.value.kind)?{...(d.data||{}),...(d.stringData||{})}:{}})
const entryCount=computed(()=>Object.keys(entryMap.value).length)
const contentBytes=computed(()=>Object.values(entryMap.value).reduce((sum,value)=>sum+new TextEncoder().encode(String(value??'')).length,0))
function formatBytes(bytes){if(bytes<1024)return `${bytes} B`;if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`;return `${(bytes/1024/1024).toFixed(2)} MB`}
let generation=0,leavingAfterSave=false
const removeGuard=registerUnsavedGuard(async()=>{if(leavingAfterSave)return true;if(busy.value)return false;if(!dirty.value)return true;try{await ElMessageBox.confirm('表单内容尚未保存，确定放弃修改？','未保存的修改',{type:'warning',confirmButtonText:'放弃修改'});draft.value=cloneResource(original.value);baseline.value=JSON.stringify(draft.value);touched.value=false;fieldErrors.value={};checked.value=null;formKey.value++;return true}catch{return false}})
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
  if(uiMode.value!=='form'){loading.value=false;if(uiMode.value==='yaml')await router.replace(listPath());return}
  if(!canResource(m,isCreate?'create':'update',isCreate?initialNamespace:route.params.namespace,clusterId)||!isCreate&&m.kind==='Secret'&&!can('secret:read'))return
  const value=isCreate?newResourceDraft(m,initialNamespace):await api.get(m.group,m.version,m.plural,target.value.namespace,target.value.name)
  if(epoch!==generation)return
  value.metadata||={};if(m.kind==='Service')value.spec||={};if(WORKLOAD_KINDS.includes(m.kind)&&podTemplate(value))podTemplate(value).metadata||={}
  original.value=cloneResource(value);draft.value=cloneResource(value);baseline.value=JSON.stringify(draft.value);activeTab.value=m.kind==='Service'&&!isCreate?'service-config':storage.value&&!isCreate?'storage':'basic';templateSection.value='containers';formKey.value++
 }catch(e){if(epoch===generation){loadFailed.value=true;await showError(e.message||'资源读取失败','server')}}finally{if(epoch===generation)loading.value=false}
}
async function changeTab(){
 if(busy.value)return false
 try{
  const invalid=Object.values(fieldErrors.value).find(Boolean);if(invalid)throw new Error('请先修正表单条目：'+invalid)
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
 let body
 try{body=currentBody()}catch(e){checked.value=null;await showError(e.message);return}
 if(JSON.stringify(body)!==checked.value||target.value.key!==targetKey.value){checked.value=null;await showError('配置已发生变化，请重新执行服务端预检');return}
 if(!canResource(meta.value,creating.value?'create':'update',body.metadata.namespace,store.currentClusterId)||!creating.value&&meta.value.kind==='Secret'&&!can('secret:read')){checked.value=null;await showError('当前账号没有此目标资源的编辑权限');return}
 const epoch=generation;saving.value=true;error.value=''
 try{await submit(body,false);if(epoch!==generation)return;previewOpen.value=false;baseline.value=JSON.stringify(draft.value);touched.value=false;checked.value=null;ElMessage.success(creating.value?'创建成功':'保存成功');leavingAfterSave=true;await router.push(listPath())}
 catch(e){checked.value=null;previewOpen.value=false;await showError(e.status===409?'资源版本已变化，草稿已保留。请导出草稿，重新读取并核对修改。':e.message||'保存失败，草稿已保留','server')}
 finally{saving.value=false;leavingAfterSave=false}
}
function listPath(){return cpath(`/r/${route.params.group}/${route.params.version}/${route.params.plural}`)}
function cancel(){if(!busy.value)router.push(listPath())}
async function backToList(event){
 if(event&&(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0))return
 event?.preventDefault()
 if(busy.value)return
 const namespace=draft.value?.metadata?.namespace,namespaced=meta.value.namespaced
 const failure=await router.push(listPath())
 if(!failure&&namespaced&&namespace)store.setNamespace(namespace)
}
async function reread(){if(busy.value)return;if(dirty.value){try{await ElMessageBox.confirm('重新读取会丢弃当前未保存的草稿，请先导出需要保留的内容。','重新读取',{type:'warning',confirmButtonText:'丢弃并重新读取'})}catch{return}}await load()}
function beforeUnload(event){if(dirty.value){event.preventDefault();event.returnValue=''}}
function exportYaml(){const content=dump(draft.value,{noRefs:true,lineWidth:120});const url=URL.createObjectURL(new Blob([content],{type:'application/yaml;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`${draft.value.metadata?.name||meta.value.kind}.yaml`;a.click();URL.revokeObjectURL(url)}
watch(()=>[route.fullPath,store.currentClusterId],load)
watch(()=>store.namespace,()=>{if(!dirty.value&&!busy.value)load()})
watch([()=>JSON.stringify(draft.value),fieldErrors],()=>{if(errorSource.value==='local')error.value=''}, {deep:true})
onMounted(()=>{load();window.addEventListener('beforeunload',beforeUnload)})
onUnmounted(()=>{generation++;removeGuard();window.removeEventListener('beforeunload',beforeUnload)})
</script>
<style scoped>
.resource-editor{
 --kp-editor-font:"PingFang SC","Microsoft YaHei","Noto Sans SC","Segoe UI",sans-serif;
 --el-font-family:var(--kp-editor-font);--el-font-size-base:14px;--el-font-size-small:14px;
 font-family:var(--kp-editor-font);font-size:14px;line-height:1.65;min-width:0;padding-bottom:12px;color:#35465c;
}
.editor-hero{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:22px;padding-top:4px}
.editor-context{display:flex;align-items:center;gap:8px;font-size:13px;color:#77869a;margin-bottom:8px}
.editor-hero h1{font-size:22px;line-height:1.45;font-weight:500;letter-spacing:.01em;color:#35537a;margin:0;display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}
.hero-resource-name{font-family:var(--kp-editor-font);font-size:15px;font-weight:400;letter-spacing:0;color:#6e7d91;overflow-wrap:anywhere}
.editor-heading-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.editor-heading-actions .el-button+.el-button{margin:0}
.editor-card{background:#fff;border:1px solid #e3e9f1;border-radius:8px;padding:0 24px 26px;min-width:0}
.editor-context a{color:inherit;text-decoration:none;border-radius:3px}.editor-context a:hover{color:#42618b;text-decoration:underline}.editor-context a:focus-visible{outline:2px solid #42618b;outline-offset:3px}
.editor-tabs :deep(.el-tabs__header){margin:0 -24px 26px;padding:0 24px;background:#f8fafc;border-bottom:1px solid #e3e9f1;border-radius:8px 8px 0 0}
.editor-tabs :deep(.el-tabs__nav-wrap::after){display:none}.editor-tabs :deep(.el-tabs__active-bar){height:2px;background:#42618b}
.editor-tabs :deep(.el-tabs__item){height:52px;padding:0 24px;font-family:var(--kp-editor-font);font-size:15px;font-weight:400;color:#65758a}
.editor-tabs :deep(.el-tabs__item.is-active){color:#42618b;font-weight:500}.tab-inner{display:inline-flex;align-items:center;gap:8px}.tab-inner svg{display:none}
.editor-tabs :deep(.el-tab-pane){min-width:0}.resource-editor :deep(.el-form-item){margin-bottom:24px}.resource-editor :deep(.el-form-item__label){font-family:var(--kp-editor-font);font-size:14px;font-weight:400;color:#607086;line-height:36px}
.resource-editor :deep(.el-input__inner),.resource-editor :deep(.el-select__selected-item),.resource-editor :deep(.el-radio__label),.resource-editor :deep(.el-checkbox__label){font-family:var(--kp-editor-font);font-size:14px}
.resource-editor :deep(.el-input__wrapper),.resource-editor :deep(.el-select__wrapper){min-height:36px;border-radius:6px}
.resource-editor :deep(.el-input-number){font-variant-numeric:tabular-nums}.editor-basic-form{max-width:1180px;padding:6px 0 0}.editor-basic-form :deep(.el-select){width:100%}.editor-basic-form :deep(.el-form-item__content){min-width:0}
.editor-static-field :deep(.el-input__wrapper),.editor-static-field :deep(.el-select__wrapper){background:transparent;box-shadow:none!important;padding-left:0}.editor-static-field :deep(.el-input__inner),.editor-static-field :deep(.el-select__selected-item){color:#35465c!important;-webkit-text-fill-color:#35465c!important}
.template-workspace{display:grid;grid-template-columns:128px minmax(0,1fr);gap:26px}.template-nav{display:flex;flex-direction:column;align-self:start;gap:5px;border-right:1px solid #e3e9f1;padding-right:16px}.template-nav button{border:0;background:transparent;padding:12px 14px;text-align:left;cursor:pointer;border-radius:6px;color:#6b7a8e;font-family:var(--kp-editor-font);font-size:14px;line-height:1.5}.template-nav button.active{background:#edf2f8;color:#42618b;font-weight:500;box-shadow:inset 2px 0 #42618b}.template-content{min-width:0}
.resource-editor :deep(.workload-form){font-family:var(--kp-editor-font);font-size:14px}.resource-editor :deep(.form-section-title){font-size:16px;font-weight:500;color:#385273;margin-bottom:24px}
.resource-editor :deep(.container-settings){border-radius:6px;border-color:#e3e9f1;padding:24px}.resource-editor :deep(.container-choice){border-radius:6px;background:#f8fafc}.resource-editor :deep(.container-choice.active){background:#edf2f8;border-color:#a9bbd4}.resource-editor :deep(.container-choice.active>button){color:#42618b}.resource-editor :deep(.container-choice strong){font-size:14px;font-weight:500}.resource-editor :deep(.container-kind){font-size:13px;font-family:var(--kp-editor-font)}
.resource-editor :deep(.structured-field code){display:none}.resource-editor :deep(.structured-field summary){font-size:14px;font-weight:500;color:#4b607b}.resource-editor :deep(.structured-scalar>label){font-size:14px;line-height:1.6;color:#607086}.resource-editor :deep(.el-collapse-item__header){font-family:var(--kp-editor-font);font-size:14px;font-weight:400;color:#526a87;height:48px}
.editor-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:18px;padding:14px 18px;background:#fff;border:1px solid #e3e9f1;border-radius:7px}.editor-check-state{font-size:13px;color:#8290a2}.editor-check-state.checked{color:var(--kp-success)}.editor-footer-actions{display:flex;gap:8px;flex-wrap:wrap}.editor-footer-actions .el-button+.el-button{margin:0}
.editor-error{display:flex;align-items:center;gap:14px;margin:16px 0;padding:15px 18px;border:1px solid #fecaca;border-radius:7px;background:#fff7f7}.editor-error-icon{display:none}.editor-error strong{font-size:14px;color:#a83d3d}.editor-error p{font-size:13px;white-space:pre-wrap;margin:5px 0;color:#9b4e4e}.editor-error-actions{margin-left:auto;display:flex;gap:8px}
.cm-toolbar{display:flex;align-items:center;gap:14px;margin-bottom:18px;padding:12px 0}.cm-toolbar-icon{display:none}.cm-toolbar-copy h2{font-size:15px;font-weight:500;margin:0;color:#385273}.cm-toolbar-copy p{font-size:13px;color:#7b889a;margin:5px 0}.cm-toolbar-side{margin-left:auto;display:flex;gap:12px;font-size:13px;color:#77869a}
.service-root-fields{border-top:1px solid #e3e9f1;margin-top:20px;padding-top:18px}.service-root-fields summary{cursor:pointer;margin-bottom:16px}.secret-entry-editor :deep(.el-form-item__label){font-weight:500;margin:5px 0 12px}.secret-entry-editor :deep(.kv-file-editor){min-height:260px}
@media(max-width:900px){.template-workspace{grid-template-columns:110px minmax(0,1fr);gap:18px}.template-nav{padding-right:10px}.template-nav button{padding:11px 10px}}
@media(max-width:700px){.editor-hero{align-items:flex-start;flex-direction:column;gap:12px}.editor-hero h1{font-size:20px;gap:8px}.hero-resource-name{font-size:14px}.editor-card{padding:0 14px 20px}.editor-tabs :deep(.el-tabs__header){margin:0 -14px 20px;padding:0 12px}.editor-tabs :deep(.el-tabs__item){font-size:14px;padding:0 16px;height:48px}.template-workspace{grid-template-columns:minmax(0,1fr)}.template-nav{flex-direction:row;flex-wrap:wrap;border:0;border-bottom:1px solid #e3e9f1;padding:0 0 10px}.template-nav button{padding:9px 12px}.editor-footer{flex-direction:column;align-items:stretch;padding:12px}.editor-footer-actions{justify-content:flex-end}.editor-error{flex-wrap:wrap}.cm-toolbar-side{display:none}}
</style>
<style>
.resource-preview-dialog{display:flex;flex-direction:column;max-height:92vh;max-height:92dvh;margin-bottom:0!important}.resource-preview-dialog .el-dialog__header,.resource-preview-dialog .el-dialog__footer{flex:none}.resource-preview-dialog .el-dialog__body{min-height:0;overflow:auto;flex:1}.resource-preview-dialog .yaml-line-diff{height:min(60vh,580px);height:min(60dvh,580px);min-height:0;max-height:100%}.resource-preview-dialog .el-dialog__footer{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
</style>
