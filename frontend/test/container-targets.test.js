import test from 'node:test'
import assert from 'node:assert/strict'
import {ownedPods,podContainers} from '../src/utils/container-targets.js'
const owner=(uid)=>[{uid,controller:true}]
test('workload picker follows exact controller UID ancestry and namespace rather than shared labels',()=>{
 const root={kind:'Deployment',metadata:{uid:'d',namespace:'team'}},rs={metadata:{uid:'r',namespace:'team',ownerReferences:owner('d')}}
 const pods=[{metadata:{uid:'a',namespace:'team',ownerReferences:owner('r')}},{metadata:{uid:'b',namespace:'other',ownerReferences:owner('r')}},{metadata:{uid:'c',namespace:'team',ownerReferences:owner('else')}}]
 assert.deepEqual(ownedPods(root,pods,[rs]).map(p=>p.metadata.uid),['a'])
 assert.deepEqual(ownedPods(root,pods,[]),[])
})
test('picker distinguishes running from completed init containers',()=>{
 const containers=podContainers({metadata:{name:'p',uid:'id',namespace:'team'},spec:{containers:[{name:'app'}],initContainers:[{name:'setup'}]},status:{containerStatuses:[{name:'app',state:{running:{}}}],initContainerStatuses:[{name:'setup',state:{terminated:{reason:'Completed'}}}]}})
 assert.equal(containers[0].running,true);assert.equal(containers[1].running,false);assert.equal(containers[1].state,'Completed')
})
