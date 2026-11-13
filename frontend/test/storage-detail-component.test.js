import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript} from '@vue/compiler-sfc'
import {ref,computed,watch,reactive,effectScope,nextTick} from 'vue'
import * as detail from '../src/utils/storage-detail.js'
const pvc=()=>({kind:'PersistentVolumeClaim',metadata:{name:'data',namespace:'team',uid:'c1',resourceVersion:'1'},spec:{volumeName:'data-pv'}})
function fixture({get=async()=>({kind:'PersistentVolume',metadata:{uid:'pv1'},spec:{claimRef:{uid:'c1'}}}),permission=true}={}){
 const props=reactive({resource:pvc(),clusterId:'dev',clusterName:'开发集群'}),calls=[],scope=effectScope(),cleanup=[]
 const {descriptor}=parse(fs.readFileSync(new URL('../src/components/StorageDetails.vue',import.meta.url),'utf8'))
 const source=compileScript(descriptor,{id:'storage-detail'}).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const bindings={ref,computed,watch,onUnmounted:fn=>cleanup.push(fn),api:{get:(...args)=>{calls.push(args);return get(...args)}},canResource:()=>permission,cpath:p=>'/c/dev'+p,fmtTime:x=>x,resourceTitle:r=>r.kind,...detail}
 const component=Function(...Object.keys(bindings),source)(...Object.values(bindings)),state=scope.run(()=>component.setup(props,{expose(){}}))
 return {props,calls,state,destroy(){cleanup.forEach(fn=>fn());scope.stop()}}
}
test('storage relation reads are bound to cluster and read permissions',async()=>{
 const denied=fixture({permission:false});await nextTick();assert.equal(denied.calls.length,0);assert.match(denied.state.relatedError.value,/无权/);denied.destroy()
 const allowed=fixture();await nextTick();assert.deepEqual(allowed.calls[0].at(-1),{params:{clusterId:'dev'},silent:true});allowed.destroy()
})
test('late related responses cannot replace the current volume',async()=>{
 let resolve
 const view=fixture({get:async(_g,_v,_p,_ns,name)=>name==='data-pv'?new Promise(done=>resolve=done):{kind:'PersistentVolume',metadata:{name,uid:'pv2'}}})
 try{view.props.resource.spec.volumeName='other';await nextTick();await nextTick();assert.equal(view.state.related.value.metadata.name,'other');resolve({metadata:{name:'old'}});await nextTick();await nextTick();assert.equal(view.state.related.value.metadata.name,'other')}finally{view.destroy()}
})
test('a replaced claim UID is reported rather than displayed as the bound claim',async()=>{
 const view=fixture({get:async()=>({metadata:{uid:'pv1'},spec:{claimRef:{uid:'other-claim'}}})});try{await nextTick();await nextTick();assert.equal(view.state.related.value,null);assert.match(view.state.relatedError.value,/其他存储声明/)}finally{view.destroy()}
})
