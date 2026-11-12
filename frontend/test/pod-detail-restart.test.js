import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

function fixture(){
 const source=fs.readFileSync(new URL('../src/views/ResourceDetail.vue',import.meta.url),'utf8')
 const action=source.slice(source.indexOf('async function doRestartPod()'),source.indexOf('\nasync function doDelete()'))
 const state={obj:{value:{metadata:{uid:'selected-uid'}}},store:{currentClusterId:'selected'},route:{fullPath:'/c/selected/pods/team/web'},ns:{value:'team'},name:{value:'web'},canUpdateRes:{value:true},canDeleteRes:{value:true},restarting:{value:false}}
 let resolve;const confirmed=new Promise(r=>resolve=r),calls=[],timers=[],messages=[],router={back(){calls.push('back')}}
 const bindings={...state,ElMessageBox:{confirm:()=>confirmed},ElMessage:{success:message=>messages.push(message),error:message=>messages.push(message),warning:message=>messages.push(message)},api:{restartPod:async(...args)=>{calls.push(args);return {ok:true,message:'submitted'}}},router,setTimeout:callback=>timers.push(callback)}
 const run=Function(...Object.keys(bindings),action+';return doRestartPod')(...Object.values(bindings))
 return {...state,resolve,calls,timers,run}
}
test('detail restart refuses stale confirmation context and forwards selected UID to its original cluster',async()=>{
 for(const changed of ['cluster','uid','permission']){
  const f=fixture(),pending=f.run()
  if(changed==='cluster')f.store.currentClusterId='other'
  if(changed==='uid')f.obj.value.metadata.uid='replacement'
  if(changed==='permission')f.canDeleteRes.value=false
  f.resolve();await pending;assert.equal(f.calls.length,0)
 }
 const f=fixture(),pending=f.run();f.resolve();await pending
 assert.deepEqual(f.calls[0],['team','web',{uid:'selected-uid',clusterId:'selected'}])
 f.route.fullPath='/c/selected/overview';f.timers[0]();assert.equal(f.calls.length,1)
})
