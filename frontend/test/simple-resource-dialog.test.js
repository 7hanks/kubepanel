import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript} from '@vue/compiler-sfc'
import {ref,computed,watch,effectScope,nextTick,reactive} from 'vue'
import {resourceTitle} from '../src/utils/resource-ui.js'
import * as forms from '../src/utils/resource-form.js'

const namespaceMeta={kind:'Namespace',group:'',version:'v1',plural:'namespaces',namespaced:false}
const accountMeta={kind:'ServiceAccount',group:'',version:'v1',plural:'serviceaccounts',namespaced:true}
const account={apiVersion:'v1',kind:'ServiceAccount',metadata:{name:'runner',namespace:'team',uid:'account-uid',resourceVersion:'18',labels:{team:'ops'},annotations:{},managedFields:[{manager:'controller'}]},secrets:[{name:'runner-token'}],imagePullSecrets:[{name:'private-registry'}],automountServiceAccountToken:false,customField:{enabled:true},status:{ignored:true}}

function fixture({creating=false,meta=accountMeta,original=account,get,request,permission=true}={}){
 const scope=effectScope(),calls=[],reads=[],events=[],cleanups=[],guards=[],prompts=[],permissionCalls=[]
 const props=reactive({modelValue:true,meta,clusterId:'dev',namespace:'team',namespaces:['team','other'],target:creating?null:{namespace:meta.namespaced?'team':undefined,name:original.metadata.name}})
 let allowed=permission,discardAllowed=true
 const api={get:async(...args)=>{reads.push(args);return get?get(...args):structuredClone(original)},create:(...args)=>invoke('create',args),update:(...args)=>invoke('update',args)}
 async function invoke(method,args){calls.push({method,args});return request?request(method,args):{ok:true}}
 const {descriptor}=parse(fs.readFileSync(new URL('../src/components/SimpleResourceDialog.vue',import.meta.url),'utf8'))
 const source=compileScript(descriptor,{id:'simple-resource-dialog-test'}).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const bindings={ref,computed,watch,nextTick,onMounted(){},onUnmounted:fn=>cleanups.push(fn),ElMessage:{success(){}},ElMessageBox:{confirm:async(...args)=>{prompts.push(args);if(!discardAllowed)throw new Error('cancel')}},api,canResource:(...args)=>{permissionCalls.push(args);return typeof allowed==='function'?allowed(...args):allowed},registerUnsavedGuard:fn=>{guards.push(fn);return()=>{}},...forms,resourceTitle,KeyValueFields:{},window:{addEventListener(){},removeEventListener(){}}}
 const definition=Function(...Object.keys(bindings),source)(...Object.values(bindings))
 const state=scope.run(()=>definition.setup(props,{expose(){},emit:(...args)=>events.push(args)}))
 return {state,props,calls,reads,events,guards,prompts,permissionCalls,setPermission(value){allowed=value},allowDiscard(value){discardAllowed=value},destroy(){cleanups.forEach(fn=>fn());scope.stop()}}
}
const flush=async()=>{await nextTick();await Promise.resolve();await nextTick()}

test('Namespace create requires a separate preflight and sends the checked body to its fixed cluster without namespace',async()=>{
 const view=fixture({creating:true,meta:namespaceMeta})
 try{
  await view.state.load();view.state.draft.value.metadata.name='sandbox';view.state.draft.value.metadata.labels={team:'ops'}
  await view.state.save();assert.equal(view.calls.length,0)
  await view.state.check();assert.equal(view.state.canSave.value,true);assert.equal(view.events.length,0)
  await view.state.save()
  assert.deepEqual(view.calls.map(call=>call.method),['create','create'])
  const expected={apiVersion:'v1',kind:'Namespace',metadata:{name:'sandbox',labels:{team:'ops'},annotations:{}}}
  assert.deepEqual(view.calls[0].args,['','v1','namespaces',undefined,expected,{dryRun:true,clusterId:'dev'}])
  assert.deepEqual(view.calls[1].args,['','v1','namespaces',undefined,expected,{dryRun:false,clusterId:'dev'}])
  assert.equal(view.events.some(([name])=>name==='saved'),true)
  assert.equal(view.events.some(([name,value])=>name==='update:modelValue'&&value===false),true)
 }finally{view.destroy()}
})

test('metadata edits preserve ServiceAccount token, pull-secret and unknown fields while binding uid and resourceVersion',async()=>{
 const view=fixture()
 try{
  await view.state.load()
  assert.deepEqual(view.reads[0].slice(0,5),['','v1','serviceaccounts','team','runner'])
  assert.deepEqual(view.reads[0][5].params,{clusterId:'dev'})
  view.state.draft.value.metadata.labels.team='platform';view.state.draft.value.metadata.uid='tampered';view.state.draft.value.metadata.resourceVersion='999'
  await view.state.check()
  view.state.draft.value.metadata.annotations.owner='changed-after-check';await view.state.save();assert.equal(view.calls.length,1)
  await view.state.check();await view.state.save()
  const saved=view.calls[2]
  assert.deepEqual(saved.args.slice(0,5),['','v1','serviceaccounts','team','runner'])
  assert.deepEqual(saved.args[5],{apiVersion:'v1',kind:'ServiceAccount',metadata:{name:'runner',namespace:'team',uid:'account-uid',resourceVersion:'18',labels:{team:'platform'},annotations:{owner:'changed-after-check'}},secrets:[{name:'runner-token'}],imagePullSecrets:[{name:'private-registry'}],automountServiceAccountToken:false,customField:{enabled:true}})
  assert.deepEqual(saved.args[6],{dryRun:false,clusterId:'dev'})
 }finally{view.destroy()}
})

test('a late preflight never validates a changed draft and a failed recheck clears earlier approval',async()=>{
 let resolve,fail=false
 const view=fixture({request:async()=>{if(fail)throw new Error('validation rejected');return new Promise(done=>{resolve=done})}})
 try{
  await view.state.load();const first=view.state.check();view.state.draft.value.metadata.labels.team='changed';resolve({});await first
  assert.equal(view.state.canSave.value,false)
  const second=view.state.check();resolve({});await second;assert.equal(view.state.canSave.value,true)
  fail=true;await view.state.check();assert.equal(view.state.canSave.value,false)
 }finally{view.destroy()}
})

test('409 on preflight or save keeps the draft and requires fresh validation',async()=>{
 let conflictOnCheck=true
 const view=fixture({request:async(_method,args)=>{if(conflictOnCheck||!args.at(-1).dryRun)throw {status:409,message:'conflict'};return {}}})
 try{
  await view.state.load();view.state.draft.value.metadata.annotations.owner='keep-me';await view.state.check()
  assert.match(view.state.error.value,/草稿已保留/);assert.equal(view.state.draft.value.metadata.annotations.owner,'keep-me');assert.equal(view.state.canSave.value,false)
  view.state.draft.value.metadata.annotations.note='still-editing';await flush();assert.match(view.state.error.value,/草稿已保留/)
  conflictOnCheck=false;await view.state.check();await view.state.save()
  assert.match(view.state.error.value,/草稿已保留/);assert.equal(view.state.draft.value.metadata.annotations.owner,'keep-me');assert.equal(view.state.canSave.value,false)
  assert.equal(view.events.length,0)
 }finally{view.destroy()}
})

test('context changes abort edit reads and ignore late results from the previous cluster',async()=>{
 const pending=[]
 const view=fixture({get:()=>new Promise(resolve=>pending.push(resolve))})
 try{
  const first=view.state.load();view.props.clusterId='prod';await flush()
  assert.equal(view.reads.length,2);assert.equal(view.reads[0][5].signal.aborted,true)
  pending[0](structuredClone(account));await first;assert.equal(view.state.draft.value,null)
  pending[1]({...structuredClone(account),metadata:{...structuredClone(account.metadata),resourceVersion:'20',uid:'prod-uid'}});await flush()
  await view.state.check()
  assert.deepEqual(view.calls[0].args.at(-1),{dryRun:true,clusterId:'prod'})
  assert.equal(view.calls[0].args[5].metadata.uid,'prod-uid')
 }finally{view.destroy()}
})

test('busy operations block closing and navigation, and cancelled discard keeps unsaved edits',async()=>{
 let resolve
 const view=fixture({request:()=>new Promise(done=>{resolve=done})})
 try{
  await view.state.load();view.state.draft.value.metadata.annotations.owner='unsaved'
  const checking=view.state.check();assert.equal(await view.guards[0](),false);await view.state.requestClose();assert.equal(view.events.length,0)
  resolve({});await checking
  view.allowDiscard(false);assert.equal(await view.guards[0](),false);await view.state.requestClose();assert.equal(view.state.draft.value.metadata.annotations.owner,'unsaved');assert.equal(view.events.length,0)
  view.allowDiscard(true);await view.state.requestClose();assert.equal(view.state.dirty.value,false);assert.deepEqual(view.events,[['update:modelValue',false]])
 }finally{view.destroy()}
})

test('save rechecks current scoped permission after preflight and never submits a revoked target',async()=>{
 const view=fixture()
 try{
  await view.state.load();await view.state.check();assert.equal(view.state.canSave.value,true)
  view.setPermission(false);await view.state.save()
  assert.equal(view.calls.length,1);assert.equal(view.state.canSave.value,false);assert.match(view.state.error.value,/权限/)
  assert.deepEqual(view.permissionCalls.at(-1).slice(1),['update','team','dev'])
 }finally{view.destroy()}
})

test('an edit read without uid or resourceVersion cannot become a writable draft',async()=>{
 for(const field of ['uid','resourceVersion']){
  const original=structuredClone(account);delete original.metadata[field]
  const view=fixture({original})
  try{await view.state.load();await view.state.check();await view.state.save();assert.equal(view.calls.length,0);assert.equal(view.state.draft.value,null);assert.match(view.state.error.value,/重新读取/)}finally{view.destroy()}
 }
})

test('local invalid rows and untracked body changes both invalidate earlier preflight approval',async()=>{
 const view=fixture()
 try{
  await view.state.load();await view.state.check();view.state.setValidity('标签','键名称重复');await view.state.check();view.state.setValidity('标签','');assert.equal(view.state.canSave.value,false)
  await view.state.check();assert.equal(view.state.canSave.value,true)
  Object.defineProperty(view.state.draft.value.metadata.annotations,'untracked',{value:'change',writable:true,enumerable:true,configurable:true})
  await view.state.save();assert.equal(view.calls.length,2);assert.equal(view.state.canSave.value,false)
 }finally{view.destroy()}
})
