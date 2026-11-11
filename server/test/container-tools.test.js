import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
process.env.DASHBOARD_SECRET='fixture-container-tools-32-characters'
process.env.DASHBOARD_PASSWORD='Fixture-Tools-2026'
const tools=await import('../src/containerTools.js').catch(()=>({}))
const account={username:'qa',permissions:['cluster:list','pod:files:read','pod:files:write'],scope:{clusters:['dev'],namespaces:['team'],resources:['_core/pods']}}
const target={namespace:'team',pod:'web',container:'app',uid:'pod1'}
const pod={metadata:{uid:'pod1'},spec:{containers:[{name:'app'}]},status:{phase:'Running',containerStatuses:[{name:'app',state:{running:{}}}]}}
const fixture=()=>{const calls=[];return {calls,service:tools.createContainerTools({readPod:async()=>pod,execute:async(_t,command,options)=>{calls.push({command,options});return {stdout:Buffer.from(''),stderr:'',exitCode:0}},audit:()=>{}})}}
test('container files reject missing grant and unauthorized namespace before upstream execution',async()=>{
 assert.equal(typeof tools.createContainerTools,'function')
 const {service,calls}=fixture()
 await assert.rejects(service.file({...account,permissions:['cluster:list']},'dev',{...target,action:'list',path:'/'}),{status:403})
 await assert.rejects(service.file(account,'dev',{...target,namespace:'other',action:'list',path:'/'}),{status:403})
 assert.equal(calls.length,0)
})
test('file paths remain literal argv and destructive root/directory removal is refused',async()=>{
 assert.equal(typeof tools.createContainerTools,'function')
 const {service,calls}=fixture(),path='/tmp/$(touch unsafe); space.txt'
 await service.file(account,'dev',{...target,action:'read',path})
 assert.equal(calls[0].command.at(-1),path)
 assert.equal(calls[0].command[2].includes(path),false)
 await assert.rejects(service.file(account,'dev',{...target,action:'delete',path:'/'}),{status:400})
 await assert.rejects(service.file(account,'dev',{...target,action:'read',path:'/../etc'}),{status:400})
})
test('stale Pod identity and non-running target cannot execute',async()=>{
 assert.equal(typeof tools.createContainerTools,'function')
 const {service,calls}=fixture()
 await assert.rejects(service.file(account,'dev',{...target,uid:'old',action:'list',path:'/'}),{status:409})
 await assert.rejects(service.file(account,'dev',{...target,container:'missing',action:'list',path:'/'}),{status:400})
 assert.equal(calls.length,0)
})

test('uploads consume the exact byte count without stdin EOF and await the remote exit status',async()=>{
 const {service,calls}=fixture()
 await service.file(account,'dev',{...target,action:'write',path:'/tmp/file',base64:Buffer.from('data').toString('base64'),confirmed:true})
 assert.equal(calls[0].command.at(-1),'4')
 assert.match(calls[0].command[2],/head -c/)
 let ended=false,closed=false
 const execute=tools.createExecRunner(async(_t,_cmd,stdout,_stderr,stdin,status)=>{
  stdin.on('end',()=>{ended=true})
  stdin.on('data',data=>{assert.equal(data.toString(),'data');stdout.write('ok');status({status:'Success'})})
  return {on(){},close(){closed=true}}
 })
 const result=await execute(target,['fixed-writer'],{input:Buffer.from('data')})
 assert.equal(ended,false);assert.equal(closed,true);assert.equal(result.stdout.toString(),'ok');assert.equal(result.exitCode,0)
})
test('container streams bound output, wait time, abort and nonzero exit status',async()=>{
 let closed=0
 const silent=tools.createExecRunner(async()=>({on(){},close(){closed++}}))
 await assert.rejects(silent(target,['x'],{timeoutMs:5}),{status:504})
 const signal=new AbortController();signal.abort()
 await assert.rejects(silent(target,['x'],{signal:signal.signal}),{status:499})
 const noisy=tools.createExecRunner(async(_t,_c,out)=>{queueMicrotask(()=>out.write('too much'));return {on(){},close(){closed++}}})
 await assert.rejects(noisy(target,['x'],{maxBytes:2}),{status:413})
 const exit=tools.createExecRunner(async(_t,_c,_o,_e,_i,status)=>{queueMicrotask(()=>status({status:'Failure',details:{causes:[{reason:'ExitCode',message:'7'}]}}));return {on(){},close(){closed++}}})
 assert.equal((await exit(target,['x'])).exitCode,7)
 assert.ok(closed>=2)
})

test('fixed file scripts roundtrip binary, literal shell characters and refuse recursive directory deletion',{skip:process.platform==='win32'},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kubepanel-files-'))
 const file=path.join(root,'literal $(echo unsafe); file'),bytes=Buffer.from([0,1,2,255,10,99])
 const run=(action,target,options={},input)=>{const command=tools.containerCommand(action,target,options);return spawnSync(command[0],command.slice(1),{input,timeout:5000})}
 try{
  assert.equal(run('write',file,{bytes:bytes.length},bytes).status,0)
  assert.deepEqual(run('read',file).stdout,bytes)
  assert.notEqual(run('write',file,{bytes:0},Buffer.alloc(0)).status,0,'create must refuse existing files')
  assert.equal(run('write',file,{bytes:0,overwrite:true},Buffer.alloc(0)).status,0)
  assert.equal(fs.statSync(file).size,0)
  const listed=run('list',root).stdout.toString().split('\0');assert.ok(listed.includes('literal $(echo unsafe); file'))
  assert.notEqual(run('delete',root).status,0,'nonempty directories must be retained')
  assert.equal(run('delete',file).status,0)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
