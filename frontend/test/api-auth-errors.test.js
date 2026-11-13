import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
function fixture(){
 const removed=[],messages=[],location={pathname:'/c/dev/registries',href:''}
 let rejectResponse
 const http={interceptors:{request:{use(){}},response:{use(_success,failure){rejectResponse=failure}}}}
 const axios={create:()=>http,isCancel:()=>false}
 const source=fs.readFileSync(new URL('../src/api/index.js',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replace(/export default api\s*$/,'').replaceAll('export ','')
 Function('axios','ElMessage','uploadFile','localStorage','sessionStorage','location',source)(axios,{error:message=>messages.push(message)},()=>{}, {getItem:()=>null,removeItem:key=>removed.push(key)},{getItem:()=>null,removeItem:key=>removed.push(key)},location)
 return {removed,messages,location,fail:(status,details,url='/v1/registries/r1/projects')=>rejectResponse({response:{status,data:{message:'access denied',details}},config:{url}})}
}
test('Harbor credential rejection keeps the platform session and reports the upstream error',async()=>{
 const view=fixture()
 await assert.rejects(view.fail(401,{source:'harbor',upstreamStatus:401}),{status:401,message:'access denied'})
 assert.deepEqual(view.removed,[]);assert.equal(view.location.href,'');assert.deepEqual(view.messages,['access denied'])
})
test('a real platform 401 still clears the session even on a registry URL',async()=>{
 const view=fixture();await assert.rejects(view.fail(401),{status:401})
 assert.ok(view.removed.includes('kp_authenticated'));assert.ok(view.removed.includes('kp_csrf'));assert.equal(view.location.href,'/login')
})
test('an unrelated details object cannot bypass platform 401 handling',async()=>{
 const view=fixture();await assert.rejects(view.fail(401,{source:'other',upstreamStatus:401}),{status:401})
 assert.equal(view.location.href,'/login')
})
