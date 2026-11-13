import {resourceUiPolicy} from '../src/utils/resource-policy.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript} from '@vue/compiler-sfc'
import {ref,computed,watch,effectScope,nextTick,reactive} from 'vue'
import {dump} from 'js-yaml'
import {resourceTitle} from '../src/utils/resource-ui.js'
import * as forms from '../src/utils/resource-form.js'
const meta={kind:'ConfigMap',group:'',version:'v1',plural:'configmaps',namespaced:true,path:'/r/_core/v1/configmaps'}
function fixture({creating=false,request,permission=true,original,resourceMeta=meta}={}){
 const scope=effectScope(),calls=[],routes=[],cleanups=[],guards=[]
 const route=reactive({name:creating?'resource-create':'resource-edit',fullPath:creating?'/c/dev/r/_core/v1/configmaps/new':'/c/dev/r/_core/v1/configmaps/team/settings/edit',params:{group:'_core',version:'v1',plural:'configmaps',namespace:'team',name:'settings'}})
 const store=reactive({currentClusterId:'dev',namespace:'team',namespaces:['team'],discovery:[],currentCluster:{name:'Dev'}})
 const resource=original||{apiVersion:'v1',kind:'ConfigMap',metadata:{name:'settings',namespace:'team',resourceVersion:'18',uid:'u1'},data:{'app.conf':'old\n'}}
 const invoke=async(method,args)=>{calls.push({method,args});return request?request(method,args):{ok:true}}
 const api={get:async()=>structuredClone(resource),create:(...args)=>invoke('create',args),update:(...args)=>invoke('update',args)}
 const {descriptor}=parse(fs.readFileSync(new URL('../src/views/ResourceEditor.vue',import.meta.url),'utf8'))
 const source=compileScript(descriptor,{id:'resource-editor-test'}).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const bindings={resourceUiPolicy,SimpleResourceDialog:{},StorageForm:{},ref,computed,watch,nextTick,onMounted(){},onUnmounted:fn=>cleanups.push(fn),useRoute:()=>route,useRouter:()=>({push:path=>routes.push(path),replace:async path=>{if(!guards[0]||await guards[0]())routes.push(path)}}),ElMessage:{success(){}},ElMessageBox:{confirm:async()=>{}},dump,api,store,metaFromRoute:()=>resourceMeta,can:()=>permission,canResource:()=>permission,cpath:path=>'/c/dev'+path,nsPath:ns=>ns||'_all',registerUnsavedGuard:fn=>{guards.push(fn);return()=>{}},...forms,resourceTitle,ServiceForm:{},EditorInsights:{},KeyValueFields:{},StructuredFields:{},WorkloadForm:{},YamlDiff:{},window:{removeEventListener(){},addEventListener(){}}}
 const definition=Function(...Object.keys(bindings),source)(...Object.values(bindings))
 const state=scope.run(()=>definition.setup({}, {expose(){}}))
 return {state,calls,routes,guards,route,store,destroy(){cleanups.forEach(fn=>fn());scope.stop()}}
}
test('form save requires preflight for the exact body and sends original resourceVersion to a bound target',async()=>{
 const view=fixture();try{
  await view.state.load();view.state.draft.value.data['app.conf']='new\n'
  await view.state.save();assert.equal(view.calls.length,0)
  await view.state.check();assert.equal(view.state.canSave.value,true)
  view.state.draft.value.data['app.conf']='changed\n';await view.state.save();assert.equal(view.calls.length,1)
  await view.state.check();await view.state.save()
  assert.equal(view.calls.length,3)
  const call=view.calls[2];assert.equal(call.method,'update');assert.equal(call.args[5].metadata.resourceVersion,'18');assert.equal(call.args[5].data['app.conf'],'changed\n');assert.deepEqual(call.args[6],{dryRun:false,clusterId:'dev'})
  assert.deepEqual(view.routes,['/c/dev/r/_core/v1/configmaps'])
 }finally{view.destroy()}
})
test('late preflight cannot validate an altered draft and a failed recheck invalidates earlier success',async()=>{
 let resolve,fail=false
 const view=fixture({request:async()=>{if(fail)throw new Error('preflight failed');return new Promise(done=>{resolve=done})}})
 try{
  await view.state.load();const first=view.state.check();view.state.draft.value.data.key='changed';resolve({});await first
  assert.equal(view.state.canSave.value,false)
  const second=view.state.check();resolve({});await second;assert.equal(view.state.canSave.value,true)
  fail=true;await view.state.check();assert.equal(view.state.canSave.value,false)
 }finally{view.destroy()}
})
test('save conflict keeps all form data and requires another preflight',async()=>{
 const view=fixture({request:async(_method,args)=>{if(!args.at(-1).dryRun)throw {status:409,message:'conflict'};return {}}})
 try{await view.state.load();view.state.draft.value.data.key='retained';await view.state.check();await view.state.save();assert.equal(view.state.draft.value.data.key,'retained');assert.match(view.state.error.value,/草稿已保留/);assert.equal(view.state.canSave.value,false);assert.equal(view.routes.length,0)}finally{view.destroy()}
})
test('unauthorized targets cannot read or submit through the editor',async()=>{
 const view=fixture({permission:false});try{await view.state.load();await view.state.check();await view.state.save();assert.equal(view.calls.length,0);assert.equal(view.state.draft.value,null)}finally{view.destroy()}
})

test('template metadata remains attached to Job and CronJob drafts when it was absent',async()=>{
 for(const kind of ['Job','CronJob']){
  const m={kind,group:'batch',version:'v1',plural:kind==='Job'?'jobs':'cronjobs',namespaced:true}
  const resource=forms.newResourceDraft(m,'team');resource.metadata.name='job';resource.metadata.resourceVersion='3';forms.podSpec(resource).containers[0].image='busybox:1.36'
  delete forms.podTemplate(resource).metadata
  const view=fixture({resourceMeta:m,original:resource})
  try{
   await view.state.load()
   view.state.setTemplateMetadata('labels',{team:'ops'})
   assert.deepEqual(forms.podTemplate(view.state.draft.value).metadata.labels,{team:'ops'})
  }finally{view.destroy()}
 }
})
test('switching form tabs and background namespace updates do not discard or dirty a draft',async()=>{
 const original={apiVersion:'v1',kind:'ConfigMap',metadata:{name:'settings',namespace:'team',resourceVersion:'18',managedFields:[{manager:'test'}]},data:{key:'old'},status:{ignored:true}}
 const view=fixture({original});try{
  await view.state.load();assert.equal(view.state.dirty.value,false)
  await view.state.changeTab('entries','basic');await view.state.changeTab('basic','entries');assert.equal(view.state.dirty.value,false)
  view.state.draft.value.data.key='unsaved';view.store.namespace='other';await nextTick();assert.equal(view.state.draft.value.data.key,'unsaved')
 }finally{view.destroy()}
})
test('a locally invalid preflight clears an earlier successful check even when the draft is reverted',async()=>{
 const view=fixture();try{
  await view.state.load();await view.state.check();assert.equal(view.state.canSave.value,true)
  view.state.setValidity('标签','键名称重复');await view.state.check()
  view.state.setValidity('标签','');assert.equal(view.state.canSave.value,false)
 }finally{view.destroy()}
})
test('saving rechecks the actual body even if a draft change bypassed reactive cache invalidation',async()=>{
 const view=fixture();try{
  await view.state.load();await view.state.check();assert.equal(view.state.canSave.value,true)
  Object.defineProperty(view.state.draft.value.data,'added',{value:'untracked change',writable:true,enumerable:true,configurable:true})
  await view.state.save()
  assert.equal(view.calls.length,1)
  assert.equal(view.state.canSave.value,false)
 }finally{view.destroy()}
})

test('direct routes without a dedicated form can leave through the editor navigation guard',async()=>{
 const view=fixture({creating:true,resourceMeta:{kind:'Role',group:'rbac.authorization.k8s.io',version:'v1',plural:'roles',namespaced:true}})
 try{await view.state.load();assert.equal(view.routes.length,1);assert.equal(view.state.loading.value,false)}finally{view.destroy()}
})
