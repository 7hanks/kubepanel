import test from 'node:test'
import assert from 'node:assert/strict'
const {createBulkPodRestart,MAX_BULK_POD_RESTART}=await import('../src/utils/bulk-pod-restart.js').catch(()=>({}))
const pod=(name,extra={})=>({_raw:{metadata:{name,namespace:'team',uid:`uid-${name}`,ownerReferences:[{kind:'ReplicaSet',apiVersion:'apps/v1',name:'web',uid:'rs',controller:true}],...extra},status:{phase:'Running'}}})
const setup=(pods,request,extra={})=>createBulkPodRestart({pods,clusterId:'cluster-a',canRestart:()=>true,request,...extra})

test('partial preflight executes only passed selected targets and reports partial submission honestly',async()=>{
 assert.equal(typeof createBulkPodRestart,'function')
 const calls=[];const session=setup([pod('good'),pod('pdb'),pod('failed')],async(ns,name,options)=>{
  calls.push({ns,name,...options});if(name==='pdb')throw new Error('PDB 拒绝驱逐');if(name==='failed'&&!options.dryRun)throw {status:403,message:'权限已撤销'}
  return {ok:true,dryRun:options.dryRun}
 })
 await session.preflight();assert.equal(session.summary().executable,2);assert.equal(session.state.rows[1].status,'blocked')
 await session.submit();assert.deepEqual(calls.filter(c=>!c.dryRun).map(c=>c.name),['good','failed'])
 assert.equal(session.summary().submitted,1);assert.equal(session.summary().failed,1);assert.equal(session.summary().allSubmitted,false)
 assert.equal(session.state.rows[1].message,'PDB 拒绝驱逐')
 await session.submit();assert.equal(calls.length,5,'execution cannot be retried implicitly')
})

test('selection requires raw UID, live managed Pods and per-target namespace scope',async()=>{
 assert.equal(typeof createBulkPodRestart,'function')
 const calls=[];const missing=pod('missing',{uid:undefined});missing.uid='fallback/team/missing'
 const done=pod('done');done._raw.status.phase='Succeeded'
 const denied=pod('denied',{namespace:'forbidden'})
 const session=setup([pod('bare',{ownerReferences:[]}),pod('mirror',{annotations:{'kubernetes.io/config.mirror':''}}),missing,done,denied,pod('good')],async(ns,name,o)=>{calls.push(name);return {ok:true,dryRun:o.dryRun}},{canRestart:t=>t.namespace==='team'})
 await session.preflight();await session.submit()
 assert.deepEqual(calls,['good','good']);assert.equal(session.summary().blocked,5)
})

test('requests use frozen UID and cluster snapshot even when selected objects mutate',async()=>{
 assert.equal(typeof createBulkPodRestart,'function')
 const selected=pod('web');const calls=[];const session=setup([selected],async(ns,name,o)=>{calls.push({ns,name,...o});return {ok:true,dryRun:o.dryRun}})
 selected._raw.metadata.uid='new-uid';selected._raw.metadata.namespace='other';selected._raw.metadata.name='other'
 await session.preflight();await session.submit()
 for(const call of calls){assert.equal(call.clusterId,'cluster-a');assert.equal(call.uid,'uid-web');assert.equal(call.ns,'team');assert.equal(call.name,'web');assert.ok(call.signal instanceof AbortSignal)}
})

test('close aborts the active request and prevents queued future mutations without claiming rollback',async()=>{
 assert.equal(typeof createBulkPodRestart,'function')
 let pending;const calls=[];const session=setup([pod('one'),pod('two')],async(ns,name,o)=>{
  calls.push({name,...o});if(o.dryRun)return {ok:true,dryRun:true}
  return new Promise((resolve,reject)=>{pending={resolve,reject,signal:o.signal};o.signal.addEventListener('abort',()=>reject({cancelled:true}))})
 })
 await session.preflight();const operation=session.submit();assert.ok(pending)
 session.stop();await operation
 assert.equal(pending.signal.aborted,true);assert.equal(calls.filter(c=>!c.dryRun).length,1)
 assert.equal(session.summary().submitted,0);assert.equal(session.summary().unknown,1);assert.equal(session.summary().allSubmitted,false)
 assert.equal(session.state.rows[1].status,'cancelled')
})

test('context and permission changes prevent submission after successful dry run',async()=>{
 assert.equal(typeof createBulkPodRestart,'function')
 for(const change of ['context','permission']){
  let valid=true;const calls=[];const session=setup([pod('one'),pod('two')],async(ns,name,o)=>{calls.push(o);return {ok:true,dryRun:o.dryRun}},{isContextCurrent:()=>change!=='context'||valid,canRestart:()=>change!=='permission'||valid})
  await session.preflight();valid=false;await session.submit()
  assert.equal(calls.filter(c=>!c.dryRun).length,0);assert.equal(session.summary().allSubmitted,false)
 }
})

test('empty or malformed preflight responses cannot authorize restart and batches are bounded',async()=>{
 assert.equal(typeof createBulkPodRestart,'function')
 for(const response of [undefined,{ok:true},{ok:true,dryRun:false},{ok:false,dryRun:true}]){
  let calls=0;const session=setup([pod('web')],async()=>{calls++;return response});await session.preflight();await session.submit();assert.equal(calls,1);assert.equal(session.summary().executable,0)
 }
 assert.throws(()=>setup(Array.from({length:MAX_BULK_POD_RESTART+1},(_,i)=>pod(String(i))),async()=>{}),/100/)
})

test('uncertain submit outcomes stop remaining queue and cannot be retried or reported failed',async()=>{
 const uncertain=[new Error('Network Error'),{message:'timeout of 30000ms exceeded'},{status:500,message:'server error'},{status:502,message:'bad gateway'},{status:504,message:'gateway timeout'},{status:408,message:'request timeout'}]
 for(const failure of uncertain){
  const calls=[];const session=setup([pod('submitted'),pod('uncertain'),pod('queued')],async(ns,name,o)=>{
   calls.push({name,...o});if(!o.dryRun && name==='uncertain')throw failure
   return {ok:true,dryRun:o.dryRun}
  })
  await session.preflight();await session.submit();await session.submit()
  assert.deepEqual(calls.filter(c=>!c.dryRun).map(c=>c.name),['submitted','uncertain'])
  assert.equal(session.state.rows[0].status,'submitted');assert.equal(session.state.rows[1].status,'unknown');assert.equal(session.state.rows[2].status,'cancelled')
  assert.match(session.state.rows[1].message,/刷新/);assert.match(session.state.rows[1].message,/请勿.*重复提交/)
  assert.equal(session.summary().failed,0);assert.equal(session.summary().allSubmitted,false);assert.equal(session.state.stopped,true)
 }
})

test('malformed successful submit responses are unknown and stop queued mutations',async()=>{
 for(const response of [undefined,{ok:false,dryRun:false},{ok:true},{ok:true,dryRun:true}]){
  let mutations=0;const session=setup([pod('one'),pod('two')],async(ns,name,o)=>{
   if(o.dryRun)return {ok:true,dryRun:true};mutations++;return response
  })
  await session.preflight();await session.submit()
  assert.equal(mutations,1);assert.equal(session.state.rows[0].status,'unknown');assert.equal(session.state.rows[1].status,'cancelled')
 }
})

test('explicit mutation rejections remain failed while following eligible rows can submit',async()=>{
 for(const status of [400,401,403,404,409,422,429]){
  const calls=[];const session=setup([pod('rejected'),pod('good')],async(ns,name,o)=>{
   calls.push({name,...o});if(!o.dryRun && name==='rejected')throw {status,message:'explicit rejection'}
   return {ok:true,dryRun:o.dryRun}
  })
  await session.preflight();await session.submit()
  assert.deepEqual(calls.filter(c=>!c.dryRun).map(c=>c.name),['rejected','good'])
  assert.equal(session.state.rows[0].status,'failed');assert.equal(session.state.rows[1].status,'submitted');assert.equal(session.summary().unknown,0)
 }
})

test('dry-run transport and server failures stay blocked without stopping other preflight targets',async()=>{
 for(const failure of [new Error('Network Error'),{status:500,message:'server error'},{status:504,message:'timeout'}]){
  const session=setup([pod('blocked'),pod('good')],async(ns,name,o)=>{
   if(name==='blocked')throw failure
   return {ok:true,dryRun:o.dryRun}
  })
  await session.preflight();assert.equal(session.state.rows[0].status,'blocked');assert.equal(session.state.rows[1].status,'passed');assert.equal(session.state.stopped,false)
 }
})
