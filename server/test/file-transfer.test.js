import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable, Writable } from 'node:stream'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.DASHBOARD_SECRET='fixture-large-files-32-characters'
process.env.DASHBOARD_PASSWORD='Fixture-Tools-2026'
const {TRANSFER_LIMIT,transferSize,transferCommand,createTransferExecutor,createDownloadTickets}=await import('../src/fileTransfer.js')
const {createContainerTools}=await import('../src/containerTools.js')
const tick=()=>new Promise(r=>setImmediate(r))
const success=Buffer.from('{"status":"Success"}')
const target={namespace:'team',pod:'web',container:'app',uid:'pod1'}
const account={username:'large-qa',permissions:['cluster:list','pod:files:read','pod:files:write'],scope:{clusters:['dev'],namespaces:['team'],resources:['_core/pods']}}
const pod={metadata:{uid:'pod1'},spec:{containers:[{name:'app'}]},status:{containerStatuses:[{name:'app',state:{running:{}}}]}}
class Socket extends EventEmitter {
  closed=false;paused=false
  terminate(){this.closed=true}
  pause(){this.paused=true}
  resume(){this.paused=false;this.emit('resume')}
}
test('5 GiB boundaries use safe integer byte counts, independent of the editor limit',()=>{
  assert.equal(TRANSFER_LIMIT,5368709120)
  assert.equal(transferSize(String(TRANSFER_LIMIT)),TRANSFER_LIMIT)
  assert.equal(transferSize(0),0)
  for(const size of [TRANSFER_LIMIT+1,Number.MAX_SAFE_INTEGER])assert.throws(()=>transferSize(size),{status:413})
  for(const size of [-1,'1.2','1e5','',null,true])assert.throws(()=>transferSize(size),{status:400})
})
test('upload applies websocket backpressure, sends bytes unchanged and commits only after exact HTTP EOF',async()=>{
  const socket=new Socket(),frames=[],source=[Buffer.alloc(65537,255),Buffer.from('hello')];let pulled=0,receive,release
  socket.send=(frame,cb)=>{frames.push(Buffer.from(frame));release=()=>{cb();if(frames.length===3)receive(1,Buffer.from('R'),socket)}}
  const input=Readable.from((async function*(){for(const chunk of source){pulled++;yield chunk}})(),{highWaterMark:1})
  const execute=createTransferExecutor(async(_t,_c,stdin,cb)=>{assert.equal(stdin,true);receive=cb;return socket})
  const pending=execute(target,[],{input,size:65542})
  await tick();assert.equal(frames.length,1);assert.ok(pulled<=2)
  release();await tick();assert.equal(frames.length,2)
  release();await tick();assert.equal(frames.length,3)
  release();await tick();assert.equal(frames.length,4);assert.equal(frames[3].subarray(1).toString(),'C')
  release();receive(3,success,socket)
  assert.equal((await pending).bytes,65542)
  assert.deepEqual(Buffer.concat(frames.slice(0,3).map(f=>f.subarray(1))),Buffer.concat(source))
  assert.ok(frames.every(f=>f[0]===0&&f.length<=65537));assert.equal(socket.closed,true)
})
test('full 5 GiB upload and download cross the 32-bit boundary with bounded reusable chunks',async()=>{
  const chunk=Buffer.alloc(65536,123),socket=new Socket();let uploaded=0,receive,maxFrame=0,inFlight=0,maxInFlight=0
  socket.send=(frame,cb)=>{
    maxFrame=Math.max(maxFrame,frame.length);maxInFlight=Math.max(maxInFlight,++inFlight)
    if(frame.length===2){assert.equal(frame[1],67);assert.equal(uploaded,TRANSFER_LIMIT);queueMicrotask(()=>receive(3,success,socket))}
    else {uploaded+=frame.length-1;if(uploaded===TRANSFER_LIMIT)queueMicrotask(()=>receive(1,Buffer.from('R'),socket))}
    inFlight--;cb()
  }
  const exec=createTransferExecutor(async(_t,_c,_stdin,cb)=>{receive=cb;return socket})
  const input=Readable.from((function*(){for(let n=0;n<TRANSFER_LIMIT/chunk.length;n++)yield chunk})(),{highWaterMark:1})
  assert.equal((await exec(target,[],{input,size:TRANSFER_LIMIT})).bytes,TRANSFER_LIMIT)
  assert.equal(maxFrame,65537);assert.equal(maxInFlight,1)
  let downloaded=0
  const output=new Writable({write(data,_encoding,cb){downloaded+=data.length;cb()}})
  const pending=exec(target,[],{output,size:TRANSFER_LIMIT});await tick()
  for(let n=0;n<TRANSFER_LIMIT/chunk.length;n++)receive(1,chunk,socket)
  receive(3,success,socket)
  assert.equal((await pending).bytes,TRANSFER_LIMIT);assert.equal(downloaded,TRANSFER_LIMIT)
})
test('short, oversized and canceled uploads never send the commit marker',async()=>{
  for(const [data,size,status] of [['abc',4,400],['abc',2,413]]){
    const socket=new Socket(),frames=[];socket.send=(frame,cb)=>{frames.push(frame);cb()}
    const exec=createTransferExecutor(async()=>socket)
    await assert.rejects(exec(target,[],{input:Readable.from([Buffer.from(data)]),size}),{status})
    assert.ok(!frames.some(f=>f.subarray(1).toString()==='C'));assert.equal(socket.closed,true)
  }
  const socket=new Socket(),frames=[],controller=new AbortController()
  socket.send=(frame)=>{frames.push(frame);controller.abort()}
  const exec=createTransferExecutor(async()=>socket)
  await assert.rejects(exec(target,[],{input:Readable.from([Buffer.from('abc')]),size:3,signal:controller.signal}),{status:499})
  assert.equal(frames.length,1);assert.equal(socket.closed,true)
})
test('download pauses upstream until the HTTP response drains and rejects changed sizes',async()=>{
  const socket=new Socket();let receive,flush
  const output=new Writable({highWaterMark:1,write(_data,_encoding,cb){flush=cb}})
  const exec=createTransferExecutor(async(_t,_c,stdin,cb)=>{assert.equal(stdin,false);receive=cb;return socket})
  const pending=exec(target,[],{output,size:3});await tick()
  receive(1,Buffer.from('abc'),socket);assert.equal(socket.paused,true)
  flush();await tick();assert.equal(socket.paused,false)
  receive(3,success,socket);assert.equal((await pending).bytes,3)
  const tooMuch=exec(target,[],{output:new Writable({write(_d,_e,cb){cb()}}),size:1});await tick()
  receive(1,Buffer.from('ab'),socket);await assert.rejects(tooMuch,{status:409})
})
test('transfer closes on permission revocation, missing status, idle timeouts and nonzero exit',async()=>{
  let receive,socket
  const exec=createTransferExecutor(async(_t,_c,_stdin,cb)=>{receive=cb;socket=new Socket();return socket})
  const pending=exec(target,[],{size:0,idleMs:10000,authorize:()=>{if(socket)throw Object.assign(new Error('revoked'),{status:403})}})
  await assert.rejects(pending,{status:403});assert.equal(socket.closed,true)
  const idle=exec(target,[],{size:0,idleMs:5});await assert.rejects(idle,{status:504})
  const close=exec(target,[],{size:0});await tick();socket.emit('close');await assert.rejects(close,{status:502})
  const failure=exec(target,[],{size:0});await tick();receive(3,Buffer.from('{"status":"Failure"}'),socket);await assert.rejects(failure,{status:422})
})
test('download ticket is expiring, single-use and bound to user, session and cluster',()=>{
  let time=1;const tickets=createDownloadTickets({now:()=>time,limit:1}),t={...target,clusterId:'dev',path:'/tmp/a',bytes:5}
  const token=tickets.issue(account,'s1',{...t,unused:'must not persist arbitrary request fields'})
  assert.throws(()=>tickets.issue(account,'s1',t),{status:429})
  assert.throws(()=>tickets.consume(token,account,'s2','dev'),{status:403})
  assert.throws(()=>tickets.consume(token,{username:'other'},'s1','dev'),{status:403})
  assert.throws(()=>tickets.consume(token,account,'s1','other'),{status:403})
  assert.deepEqual(tickets.consume(token,account,'s1','dev'),t)
  assert.throws(()=>tickets.consume(token,account,'s1','dev'),{status:410})
  const expired=tickets.issue(account,'s1',t);time=60002
  assert.throws(()=>tickets.consume(expired,account,'s1','dev'),{status:410})
})
test('stream transfer preserves scope, live UID and running-container checks before executing',async()=>{
  let calls=0
  const service=createContainerTools({readPod:async()=>pod,execute:async()=>({stdout:Buffer.from(String(TRANSFER_LIMIT)),exitCode:0}),transfer:async(_t,_c,options)=>{calls++;return {bytes:options.size}},audit:()=>{}})
  const body={...target,path:'/tmp/file',size:TRANSFER_LIMIT,confirmed:true}
  assert.equal((await service.upload(account,'dev',body,{})).bytes,TRANSFER_LIMIT)
  assert.equal(await service.downloadInfo(account,'dev',body),TRANSFER_LIMIT)
  await assert.rejects(service.upload(account,'dev',{...body,namespace:'other'},{}),{status:403})
  await assert.rejects(service.upload(account,'dev',{...body,uid:'stale'},{}),{status:409})
  await assert.rejects(service.upload(account,'dev',{...body,container:'missing'},{}),{status:400})
  await assert.rejects(service.upload(account,'dev',{...body,size:TRANSFER_LIMIT+1},{}),{status:413})
  await assert.rejects(service.upload(account,'dev',{...body,confirmed:false},{}),{status:400})
  await assert.rejects(service.download(account,'dev',{...body,bytes:1},{onReady(){throw Error('unexpected')}}),{status:409})
  assert.equal(calls,1)
})
test('remote upload atomically commits binary files, preserves original on short input and refuses existing create',{skip:process.platform==='win32'},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kubepanel-stream-')),file=path.join(root,'$(literal); file')
  const bytes=Buffer.from([0,255,10,67,1]),run=(data,size,overwrite=false)=>new Promise((resolve,reject)=>{
    const cmd=transferCommand('upload',file,{size,overwrite}),child=spawn(cmd[0],cmd.slice(1))
    const timer=setTimeout(()=>{child.kill();reject(Error('shell timeout'))},5000)
    child.stdin.on('error',()=>{})
    child.stdout.on('data',ready=>{assert.equal(ready.toString(),'R');child.stdin.end('C')})
    child.on('error',reject);child.on('exit',status=>{clearTimeout(timer);resolve({status})})
    child.stdin.write(data);if(data.length<size)child.stdin.end()
  })
  try{
    assert.equal((await run(bytes,bytes.length)).status,0)
    assert.deepEqual(fs.readFileSync(file),bytes)
    fs.chmodSync(file,0o640)
    assert.notEqual((await run(Buffer.from('x'),5,true)).status,0);assert.deepEqual(fs.readFileSync(file),bytes)
    assert.notEqual((await run(Buffer.alloc(0),0)).status,0);assert.deepEqual(fs.readFileSync(file),bytes)
    assert.equal((await run(Buffer.alloc(0),0,true)).status,0);assert.equal(fs.statSync(file).size,0);assert.equal(fs.statSync(file).mode&0o777,0o640)
    assert.deepEqual(fs.readdirSync(root),[path.basename(file)])
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})
test('upload does not retain completed distinct chunks while waiting for HTTP EOF',()=>{
  const source=`
    import {Readable} from 'node:stream'; import {EventEmitter} from 'node:events';
    const {createTransferExecutor}=await import('./src/fileTransfer.js');
    let ready,release,receive; const atEnd=new Promise(r=>ready=r),gate=new Promise(r=>release=r);
    class Socket extends EventEmitter{count=0;terminate(){} send(frame,cb){cb();if(frame.length===2)queueMicrotask(()=>receive(3,Buffer.from('{"status":"Success"}'),this));else {this.count+=frame.length-1;if(this.count===256*1024**2)queueMicrotask(()=>receive(1,Buffer.from('R'),this))}}}
    const exec=createTransferExecutor(async(_t,_c,_i,cb)=>{receive=cb;return new Socket()});
    global.gc();global.gc();const before=process.memoryUsage().external;
    const input=Readable.from((async function*(){for(let n=0;n<4096;n++)yield Buffer.alloc(65536,n%251);ready();await gate})(),{highWaterMark:1});
    const pending=exec({},[],{input,size:256*1024**2});await atEnd;await new Promise(r=>setImmediate(r));global.gc();global.gc();
    const delta=process.memoryUsage().external-before;release();await pending;console.log(JSON.stringify({delta}));
  `
  const child=spawnSync(process.execPath,['--expose-gc','--input-type=module','-e',source],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:20000})
  assert.equal(child.status,0,child.stderr)
  assert.ok(JSON.parse(child.stdout).delta<32*1024**2,child.stdout)
})
test('destination becoming directory or symlink during upload fails without leaving a file inside',{skip:process.platform==='win32'},async()=>{
  for(const symlink of [false,true])for(const overwrite of [false,true]){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'kubepanel-race-')),file=path.join(root,'destination'),other=path.join(root,'other')
    const command=transferCommand('upload',file,{size:3,overwrite}),child=spawn(command[0],command.slice(1),{stdio:['pipe','pipe','ignore']})
    const completed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
    try{
      const ready=new Promise(resolve=>child.stdout.once('data',resolve))
      child.stdin.write('abc')
      assert.equal((await ready).toString(),'R')
      if(symlink){fs.mkdirSync(other);fs.symlinkSync(other,file)}else fs.mkdirSync(file)
      child.stdin.end('C')
      assert.notEqual(await completed,0)
      assert.deepEqual(fs.readdirSync(symlink?other:file),[])
      assert.ok(!fs.readdirSync(root).some(name=>name.startsWith('.kubepanel-upload.')))
    }finally{child.kill();fs.rmSync(root,{recursive:true,force:true})}
  }
})
