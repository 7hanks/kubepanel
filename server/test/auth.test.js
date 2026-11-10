import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
const base=path.resolve(import.meta.dirname,'../../.local/tests')
fs.mkdirSync(base,{recursive:true})
const dir=fs.mkdtempSync(path.join(base,'auth-'))
process.env.DATA_DIR=dir
process.env.DASHBOARD_SECRET='fixture-auth-key-long-enough-for-tests'
process.env.DASHBOARD_PASSWORD='Fixture-Login-2026'
const auth=await import('../src/auth.js')
const {savePassword}=await import('../src/userStore.js')
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
function response(){return {headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(body){this.body=body;return this}}}
function reqFor(token,method='GET',csrf){return {method,headers:{authorization:`Bearer ${token}`,host:'localhost'},query:{},get(k){return this.headers[k.toLowerCase()]},body:{},ip:'127.0.0.1'}}

test('login produces HttpOnly cookie and persistent CSRF bound session; logout revokes token',async()=>{
  const res=response()
  await auth.login({body:{username:'admin',password:'Fixture-Login-2026'},headers:{host:'localhost'},ip:'127.0.0.1'},res)
  assert.equal(res.statusCode,200)
  assert.ok(res.headers['Set-Cookie'].includes('HttpOnly'))
  assert.ok(res.body.csrfToken)
  const req=reqFor(res.body.token)
  let next=false
  auth.authMiddleware(req,response(),()=>{next=true})
  assert.equal(next,true)
  auth.logout(req,response())
  const denied=response()
  auth.authMiddleware(reqFor(res.body.token),denied,()=>assert.fail('revoked token accepted'))
  assert.equal(denied.statusCode,401)
})
test('ambient cookie mutation requires correct CSRF and exact origin',async()=>{
  const res=response(); await auth.login({body:{username:'admin',password:'Fixture-Login-2026'},headers:{host:'localhost'},ip:'127.0.0.2'},res)
  const cookie=res.headers['Set-Cookie'].split(';')[0]
  const req={method:'POST',headers:{cookie,host:'localhost',origin:'http://localhost'},get(k){return this.headers[k.toLowerCase()]},query:{},body:{}}
  const rejected=response(); auth.authMiddleware(req,rejected,()=>assert.fail('missing csrf accepted')); assert.equal(rejected.statusCode,403)
  req.headers['x-csrf-token']=res.body.csrfToken
  let passed=false; auth.authMiddleware(req,response(),()=>{passed=true}); assert.equal(passed,true)
  req.headers.origin='http://evil.example'
  const origin=response(); auth.authMiddleware(req,origin,()=>assert.fail('wrong origin accepted')); assert.equal(origin.statusCode,403)
})
test('changing credentials invalidates existing sessions independent of JWT expiry',async()=>{
  const res=response(); await auth.login({body:{username:'admin',password:'Fixture-Login-2026'},headers:{host:'localhost'},ip:'127.0.0.3'},res)
  savePassword('Fixture-New-2026')
  const denied=response(); auth.authMiddleware(reqFor(res.body.token),denied,()=>assert.fail('old credentials accepted')); assert.equal(denied.statusCode,401)
})
test('login lockout is bounded and signals Retry-After',async()=>{
  let res
  for(let i=0;i<12;i++){res=response();await auth.login({body:{username:'no-such-user',password:'wrong'},headers:{host:'localhost'},ip:'192.0.2.1'},res)}
  assert.equal(res.statusCode,429)
  assert.ok(Number(res.headers['Retry-After'])>0)
})
test('an in-flight old-password verification cannot mint a session after password reset',async()=>{
  const res=response()
  const pending=auth.login({body:{username:'admin',password:'Fixture-New-2026'},headers:{host:'localhost'},ip:'127.0.0.9'},res)
  savePassword('Fixture-Reset-During-Login-2026')
  await pending
  assert.equal(res.statusCode,401)
  assert.equal(res.body.token,undefined)
})
