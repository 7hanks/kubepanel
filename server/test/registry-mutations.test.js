import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import express from 'express'

const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'kubepanel-registry-mutations-'))
process.env.DATA_DIR=dataDir
process.env.DASHBOARD_SECRET='registry-mutations-secret-only-abcdefghijklmnopqrstuvwxyz'
process.env.DASHBOARD_PASSWORD='Fixture-Registry-2026'
const registry=await import('../src/registryService.js')
const {default:router}=await import('../src/routes.js')
const {auditMiddleware,listAudit}=await import('../src/auditService.js')
test.after(()=>{assert.equal(path.dirname(dataDir),os.tmpdir());fs.rmSync(dataDir,{recursive:true,force:true})})

const digest='sha256:'+'a'.repeat(64)
const target={project:'library',repository:'library/team/image',digest,tag:'release-1'}
const auth='Basic '+Buffer.from('robot$writer:fixture-saved-password').toString('base64')
function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))}
async function fixture(handler,run,{credentials=true,prefix=''}={}){
 const calls=[]
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk
  const call={method:req.method,url:req.url,headers:req.headers,body:body?JSON.parse(body):undefined};calls.push(call)
  if(await handler?.(call,res))return
  if(req.url.endsWith('/users/current/permissions'))return json(res,[])
  res.writeHead(req.method==='POST'?201:200);res.end()
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 let record
 try{record=await registry.addRegistry({url:`http://127.0.0.1:${server.address().port}${prefix}`,...(credentials?{username:'robot$writer',password:'fixture-saved-password'}:{})});return await run(record,calls)}
 finally{if(record)registry.removeRegistry(record.id);await new Promise(resolve=>server.close(resolve))}
}
async function route(method,pattern,request){
 const layer=router.stack.find(item=>item.route?.path===pattern&&item.route.methods[method.toLowerCase()]);assert.ok(layer,`route ${method} ${pattern}`)
 return new Promise((resolve,reject)=>{
  const res={statusCode:200,status(value){this.statusCode=value;return this},json(body){resolve({status:this.statusCode,body});return this}}
  let index=0
  const next=error=>{if(error)return reject(error);const fn=layer.route.stack[index++]?.handle;if(!fn)return reject(new Error('route did not respond'));try{Promise.resolve(fn(request,res,next)).catch(reject)}catch(error){reject(error)}}
  next()
 })
}

test('project creation uses saved authenticated credentials and defaults to private metadata',async()=>{
 assert.equal(typeof registry.createProject,'function')
 await fixture(null,async(record,calls)=>{
  assert.deepEqual(await registry.createProject(record.id,{name:'new-project',username:'attacker',password:'ignored',url:'http://invalid.test'}),{ok:true,project:'new-project',public:false})
  const request=calls.find(call=>call.method==='POST')
  assert.equal(request.url,'/prefix/api/v2.0/projects');assert.deepEqual(request.body,{project_name:'new-project',metadata:{public:'false'}})
  assert.equal(request.headers['content-type'],'application/json');assert.ok(Number(request.headers['content-length'])>0)
  assert.ok(calls.every(call=>call.headers.authorization===auth));assert.equal(calls[0].url,'/prefix/api/v2.0/users/current/permissions')
  await registry.createProject(record.id,{name:'shared',public:true});assert.equal(calls.at(-1).body.metadata.public,'true')
 },{prefix:'/prefix'})
})

test('tag creation and deletion plus artifact deletion pin the immutable digest and double encode nested repository once',async()=>{
 for(const key of ['createArtifactTag','deleteArtifactTag','deleteArtifact'])assert.equal(typeof registry[key],'function')
 await fixture(null,async(record,calls)=>{
  const expected={ok:true,project:'library',repository:'team/image',digest,tag:'release-1'}
  assert.deepEqual(await registry.createArtifactTag(record.id,target),expected)
  assert.deepEqual(await registry.deleteArtifactTag(record.id,target),expected)
  assert.deepEqual(await registry.deleteArtifact(record.id,target),{ok:true,project:'library',repository:'team/image',digest})
  const mutations=calls.filter(call=>call.method!=='GET'),base=`/api/v2.0/projects/library/repositories/team%252Fimage/artifacts/sha256%3A${'a'.repeat(64)}`
  assert.deepEqual(mutations.map(call=>[call.method,call.url,call.body]),[['POST',base+'/tags',{name:'release-1'}],['DELETE',base+'/tags/release-1',undefined],['DELETE',base,undefined]])
  assert.ok(calls.every(call=>call.headers.authorization===auth))
 })
})

test('a repository prefix and expected Harbor address unambiguously pin a write to the selected target',async()=>{
 await fixture(null,async(record,calls)=>{
  await assert.rejects(registry.deleteArtifact(record.id,{...target,repository:'team/image'}),{status:400})
  await assert.rejects(registry.deleteArtifact(record.id,{...target,expectedUrl:'https://different.example.test'}),{status:409})
  assert.equal(calls.length,0)
  const reply=await registry.deleteArtifact(record.id,{...target,repository:'library/library/image',expectedUrl:record.url})
  assert.equal(reply.repository,'library/image')
  assert.match(calls.at(-1).url,/\/repositories\/library%252Fimage\/artifacts\//)
 })
})

test('write success requires the documented Harbor response status',async()=>{
 await fixture((call,res)=>{if(call.method==='POST'){json(res,{},200);return true}},async(record,calls)=>{
  await assert.rejects(registry.createProject(record.id,{name:'safe'}),{status:502})
  assert.equal(calls.filter(call=>call.method==='POST').length,1)
 })
})

test('anonymous saved configurations cannot issue Harbor mutation or authentication requests',async()=>{
 assert.equal(typeof registry.createProject,'function')
 await fixture(null,async(record,calls)=>{
  for(const run of [()=>registry.createProject(record.id,{name:'safe'}),()=>registry.createArtifactTag(record.id,target),()=>registry.deleteArtifactTag(record.id,target),()=>registry.deleteArtifact(record.id,target)])await assert.rejects(run(),error=>error.status===400&&/账号|凭据/.test(error.message))
  assert.equal(calls.length,0)
 },{credentials:false})
})

test('invalid mutation targets and non-boolean visibility fail before any upstream access',async()=>{
 assert.equal(typeof registry.createProject,'function')
 await fixture(null,async(record,calls)=>{
  for(const body of [{name:''},{name:'../escape'},{name:'UPPER'},{name:'safe',public:'false'},{name:['safe']}])await assert.rejects(registry.createProject(record.id,body),{status:400})
  for(const body of [{...target,project:'../escape'},{...target,repository:'team/../escape'},{...target,repository:'team%2Fimage'},{...target,digest:'latest'},{...target,digest:'sha256:short'},{...target,tag:'bad/tag'},{...target,tag:['valid']}])await assert.rejects(registry.createArtifactTag(record.id,body),{status:400})
  await assert.rejects(registry.deleteArtifact(record.id,{...target,digest:'latest'}),{status:400})
  assert.equal(calls.length,0)
 })
})

test('failed Harbor credential proof prevents mutations and preserves the upstream auth distinction',async()=>{
 assert.equal(typeof registry.createProject,'function')
 for(const status of [401,403])await fixture((call,res)=>{if(call.url.endsWith('/permissions')){json(res,{errors:[{message:'do not relay credentials'}]},status);return true}},async(record,calls)=>{
  await assert.rejects(registry.createProject(record.id,{name:'safe'}),{status,details:{source:'harbor',upstreamStatus:status}})
  assert.equal(calls.length,1);assert.equal(calls[0].method,'GET')
 })
})

test('Harbor mutation failures preserve auth, missing-target, immutable and conflict status without leaking response secrets',async()=>{
 assert.equal(typeof registry.createArtifactTag,'function')
 for(const status of [401,403,404,405,409,412])await fixture((call,res)=>{if(call.method==='POST'){json(res,{errors:[{message:'fixture-saved-password'}]},status);return true}},async(record,calls)=>{
  await assert.rejects(registry.createArtifactTag(record.id,target),error=>error.status===status&&error.details?.source==='harbor'&&error.details.upstreamStatus===status&&!error.message.includes('fixture-saved-password'))
  assert.equal(calls.filter(call=>call.method==='POST').length,1)
 })
})

test('mutation redirects are never replayed even to the configured Harbor origin',async()=>{
 assert.equal(typeof registry.createProject,'function')
 await fixture((call,res)=>{if(call.method==='POST'){res.writeHead(307,{Location:'/unexpected-write'});res.end();return true}},async(record,calls)=>{
  await assert.rejects(registry.createProject(record.id,{name:'safe'}),error=>error.status===502&&/重定向/.test(error.message))
  assert.equal(calls.filter(call=>call.method!=='GET').length,1);assert.ok(!calls.some(call=>call.url==='/unexpected-write'))
 })
})

test('new registry routes enforce separate create, update and delete permissions before upstream access',async()=>{
 await fixture(null,async(record,calls)=>{
  const cases=[['POST','/v1/registries/:id/projects','registry:create',{name:'safe'}],['POST','/v1/registries/:id/tags','registry:update',target],['DELETE','/v1/registries/:id/tags','registry:delete',target],['DELETE','/v1/registries/:id/artifacts','registry:delete',target]]
  for(const [method,pattern,permission,input] of cases){
   const request={params:{id:record.id},query:method==='DELETE'?input:{},body:method==='POST'?input:{},account:{username:'reader',permissions:['registry:list','registry:detail']}}
   assert.equal((await route(method,pattern,request)).status,403)
   const result=await route(method,pattern,{...request,account:{username:'writer',permissions:[permission]}})
   assert.equal(result.status,method==='POST'?201:200);assert.equal(result.body.ok,true)
  }
  assert.equal(calls.filter(call=>call.method!=='GET').length,4)
 })
})

test('cookie mutation routes retain CSRF protection and audit target identity without credentials or request body',async()=>{
 await fixture(null,async(record,calls)=>{
  const app=express();app.use(express.json());app.use('/api',auditMiddleware);app.use('/api',router);app.use((error,req,res,next)=>res.status(error.status||500).json({message:error.message,details:error.details}))
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`
  try{
   const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'Fixture-Registry-2026'})})
   const session=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0]
   const url=origin+`/api/v1/registries/${record.id}/tags`,headers={cookie,origin,'Content-Type':'application/json'}
   assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(target)})).status,403)
   assert.equal(calls.length,0)
   const result=await fetch(url,{method:'POST',headers:{...headers,'X-CSRF-Token':session.csrfToken},body:JSON.stringify({...target,password:'DO-NOT-STORE',token:'DO-NOT-STORE'})})
   assert.equal(result.status,201);assert.equal((await result.json()).ok,true)
   const event=listAudit({limit:1}).items[0]
   assert.equal(event.username,'admin');assert.equal(event.registryId,record.id);assert.equal(event.project,'library');assert.equal(event.repository,'library/team/image');assert.equal(event.digest,digest);assert.equal(event.tag,'release-1');assert.equal(event.status,201)
   const audit=fs.readFileSync(path.join(dataDir,'audit.jsonl'),'utf8');assert.ok(!audit.includes('DO-NOT-STORE'));assert.ok(!audit.includes('fixture-saved-password'))
  }finally{await new Promise(resolve=>server.close(resolve))}
 })
})
