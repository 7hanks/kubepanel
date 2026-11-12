import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript} from '@vue/compiler-sfc'
import {ref,shallowRef,computed,reactive,watch,effectScope,nextTick} from 'vue'
import {createBulkPodRestart,MAX_BULK_POD_RESTART} from '../src/utils/bulk-pod-restart.js'
const component=new URL('../src/components/BulkPodRestartDialog.vue',import.meta.url)
const targets=['one','two'].map(name=>({_raw:{metadata:{namespace:'team',name,uid:name,ownerReferences:[{apiVersion:'apps/v1',kind:'ReplicaSet',name:'web',uid:'rs',controller:true}]},status:{phase:'Running'}}}))
function fixture(request,initialProps={}){
 assert.ok(fs.existsSync(component),'bulk restart dialog must exist')
 const scope=effectScope(),guards=[],cleanup=[],events=[],props=reactive({modelValue:true,targets,clusterId:'a',clusterName:'Cluster A',contextKey:'a/team/pods',canRestart:()=>true,...initialProps})
 const {descriptor}=parse(fs.readFileSync(component,'utf8'))
 const source=compileScript(descriptor,{id:'bulk-dialog'}).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const bindings={ref,shallowRef,computed,reactive,watch,onUnmounted:fn=>cleanup.push(fn),createBulkPodRestart,MAX_BULK_POD_RESTART,api:{restartPod:request},registerUnsavedGuard:fn=>{guards.push(fn);return ()=>{}}}
 const definition=Function(...Object.keys(bindings),source)(...Object.values(bindings))
 const state=scope.run(()=>definition.setup(props,{expose(){},emit:(...event)=>events.push(event)}))
 return {state,props,guards,events,destroy(){cleanup.forEach(fn=>fn());scope.stop()}}
}
test('dialog does not mutate on open or preflight and keeps per-row submitted results after execution',async()=>{
 const calls=[];const view=fixture(async(ns,name,o)=>{calls.push(o);return {ok:true,dryRun:o.dryRun}})
 try{
  assert.equal(calls.length,0);await view.state.preflight();assert.equal(calls.every(c=>c.dryRun),true)
  assert.equal(view.state.summary.value.executable,2)
  await view.state.submit();assert.equal(view.state.summary.value.submitted,2)
  assert.equal(view.state.session.value.state.phase,'done');assert.equal(view.events.some(([name])=>name==='submitted'),true)
 }finally{view.destroy()}
})
test('dialog close, context changes and navigation guards stop queued mutation calls',async()=>{
 for(const action of ['close','context','navigation']){
  const calls=[];let reject
  const view=fixture(async(ns,name,o)=>{calls.push(o);if(o.dryRun)return {ok:true,dryRun:true};return new Promise((resolve,r)=>{reject=r;o.signal.addEventListener('abort',()=>r({cancelled:true}))})})
  try{
   await view.state.preflight();const execution=view.state.submit();assert.ok(reject)
   if(action==='close')view.state.close()
   if(action==='context'){view.props.contextKey='a/other/pods';await nextTick()}
   if(action==='navigation')await view.guards[0]()
   await execution
   assert.equal(calls.filter(c=>!c.dryRun).length,1);assert.equal(view.state.summary.value.unknown,1)
   assert.equal(view.state.session.value.state.stopped,true)
  }finally{view.destroy()}
 }
})

test('opening waits for all bound props in the same update batch before snapshotting selected Pods',async()=>{
 const calls=[];const view=fixture(async(ns,name,o)=>{calls.push({name,...o});return {ok:true,dryRun:o.dryRun}},{modelValue:false,targets:[],clusterId:'old',contextKey:'old/other/pods'})
 try{
  // Vue updates child props in template order: v-model arrives before targets/context.
  view.props.modelValue=true
  view.props.targets=[...targets,{_raw:{...targets[0]._raw,metadata:{...targets[0]._raw.metadata,name:'three',uid:'three'}}}]
  view.props.clusterId='new'
  view.props.contextKey='new/team/pods'
  await nextTick()
  assert.equal(view.state.error.value,'');assert.equal(view.state.summary.value.total,3)
  assert.equal(view.state.session.value.state.stopped,false);assert.equal(view.state.session.value.state.phase,'idle');assert.equal(calls.length,0)
  await view.state.preflight();assert.equal(view.state.summary.value.executable,3)
  await view.state.submit();assert.equal(view.state.summary.value.submitted,3)
  assert.deepEqual(calls.filter(call=>!call.dryRun).map(call=>call.name),['one','two','three'])
  assert.equal(calls.every(call=>call.clusterId==='new'),true)
 }finally{view.destroy()}
})
