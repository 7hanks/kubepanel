import test from 'node:test'
import assert from 'node:assert/strict'
const u = await import('../src/utils/resource.js').catch(()=>({}))
test('Service flat selector is respected and selectorless service matches nothing',()=>{
 assert.equal(typeof u.relatedPods,'function')
 const pods=[{metadata:{name:'yes',labels:{app:'api'}}},{metadata:{name:'no',labels:{app:'web'}}}]
 assert.deepEqual(u.relatedPods({kind:'Service',spec:{selector:{app:'api'}}},pods).map(p=>p.metadata.name),['yes'])
 assert.deepEqual(u.relatedPods({kind:'Service',spec:{}},pods),[])
})
test('workload relationships require owner ancestry even when selectors match',()=>{
 assert.equal(typeof u.relatedPods,'function')
 const deploy={kind:'Deployment',metadata:{uid:'d'},spec:{selector:{matchExpressions:[{key:'tier',operator:'In',values:['api']}]}}}
 const pods=[{metadata:{labels:{tier:'api'},ownerReferences:[{uid:'r'}]}},{metadata:{labels:{tier:'api'},ownerReferences:[{uid:'other'}]}}]
 assert.equal(u.relatedPods(deploy,pods,[{metadata:{uid:'r',ownerReferences:[{uid:'d'}]}}]).length,1)
 assert.equal(u.relatedPods(deploy,pods,[]).length,0)
})
test('client filters handle state reason owner node restart threshold and numeric sorting',()=>{
 assert.equal(typeof u.filterRows,'function')
 const rows=[{name:'a',status:'NotReady',reason:'OOMKilled',node:'n1',owner:'Job/a',restarts:12},{name:'b',status:'Running',restarts:2}]
 assert.deepEqual(u.filterRows(rows,{state:'abnormal',reason:'OOM',node:'n1',owner:'job',minRestarts:3}).map(x=>x.name),['a'])
 assert.equal(u.sortRows(rows,'restarts','ascending')[0].name,'b')
})
test('apply requires explicit nonempty successful item results',()=>{
 assert.equal(typeof u.assertApplySuccess,'function')
 assert.throws(()=>u.assertApplySuccess({results:[]}))
 assert.throws(()=>u.assertApplySuccess({results:[{ok:true},{ok:false,name:'x',message:'conflict'}]}),/conflict/)
 assert.equal(u.assertApplySuccess({results:[{ok:true}]}).length,1)
})
test('late requests cannot replace a newer context',()=>{
 assert.equal(typeof u.createRequestGate,'function')
 const gate=u.createRequestGate(); const first=gate.next(); const second=gate.next()
 assert.equal(gate.current(first),false); assert.equal(gate.current(second),true)
 gate.invalidate(); assert.equal(gate.current(second),false)
})
test('active abnormal filter excludes historical failed, completed, and terminating pods',()=>{
 const rows=[{name:'pending',status:'Pending',_raw:{status:{phase:'Pending'}}},{name:'evicted',status:'Evicted',_raw:{status:{phase:'Failed'}}},{name:'done',status:'Succeeded',_raw:{status:{phase:'Succeeded'}}},{name:'ending',status:'Terminating',_raw:{status:{phase:'Running'},metadata:{deletionTimestamp:'now'}}}]
 assert.deepEqual(u.filterRows(rows,{state:'active-abnormal'}).map(r=>r.name),['pending'])
})
