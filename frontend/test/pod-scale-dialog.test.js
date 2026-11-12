import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript} from '@vue/compiler-sfc'
import {ref,watch,reactive,effectScope,nextTick} from 'vue'
const owner={kind:'Deployment',group:'apps',version:'v1',plural:'deployments',namespace:'team',name:'web',uid:'controller-1',replicas:3}
function fixture(api,permission=()=>true){
 const scope=effectScope(),events=[],guards=[],cleanup=[]
 const props=reactive({modelValue:false,target:{clusterId:'dev',namespace:'team',name:'web-pod',uid:'pod-1'},contextKey:'dev/team'})
 const {descriptor}=parse(fs.readFileSync(new URL('../src/components/PodScaleDialog.vue',import.meta.url),'utf8'))
 const source=compileScript(descriptor,{id:'pod-scale'}).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const bindings={ref,watch,onUnmounted:fn=>cleanup.push(fn),ElMessage:{success(){}},api,canResource:permission,registerUnsavedGuard:fn=>{guards.push(fn);return()=>{}},ScaleDialog:{}}
 const definition=Function(...Object.keys(bindings),source)(...Object.values(bindings))
 const state=scope.run(()=>definition.setup(props,{expose(){},emit:(...e)=>events.push(e)}))
 return {props,state,events,guards,destroy(){cleanup.forEach(fn=>fn());scope.stop()}}
}
const settle=async()=>{await nextTick();await nextTick()}
test('Pod scale binds the selected Pod UID, owner UID, previous count and cluster',async()=>{
 const calls=[],view=fixture({podScaleTarget:async()=>({...owner}),scalePod:async(...args)=>{calls.push(args);return {ok:true}}})
 try{view.props.modelValue=true;await settle();assert.equal(view.state.resolved.value.uid,'controller-1');await view.state.save(5)
 assert.deepEqual(calls,[['team','web-pod',{uid:'pod-1',controllerUid:'controller-1',replicas:5,expectedReplicas:3},{clusterId:'dev'}]])
 assert.ok(view.events.some(([name])=>name==='saved'))}finally{view.destroy()}
})
test('late reads cannot populate a different cluster context and failed saves require rereading',async()=>{
 let resolve;const view=fixture({podScaleTarget:()=>new Promise(done=>resolve=done),scalePod:async()=>{throw new Error('conflict')}})
 try{view.props.modelValue=true;await nextTick();view.props.contextKey='other/team';await nextTick();resolve({...owner});await settle();assert.equal(view.state.resolved.value,null)
 view.props.modelValue=false;await nextTick();view.props.modelValue=true;await nextTick();resolve({...owner});await settle();await view.state.save(4)
 assert.equal(view.state.error.value,'conflict');assert.equal(view.state.resolved.value,null);assert.ok(!view.events.some(([name])=>name==='saved'))}finally{view.destroy()}
})
test('navigation is blocked while submitting and revoked controller permission blocks mutations',async()=>{
 let finish,permitted=true,calls=0
 const view=fixture({podScaleTarget:async()=>({...owner}),scalePod:()=>{calls++;return new Promise(done=>finish=done)}},()=>permitted)
 try{view.props.modelValue=true;await settle();permitted=false;await view.state.save(4);assert.equal(calls,0)
 permitted=true;const request=view.state.save(4);assert.equal(view.guards[0](),false);finish({ok:true});await request;assert.equal(view.guards[0](),true)}finally{view.destroy()}
})
