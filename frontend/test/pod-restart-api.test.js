import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import axios from 'axios'

test('Pod restart dry-run and execution keep selected UID, CSRF, cluster snapshot and abort signal',async()=>{
  const requests=[],messages=[],removed=[],location={pathname:'/c/dev/overview'},client=axios.create({withCredentials:true});let failure
  client.interceptors.request.use(config=>{config.adapter=async request=>{requests.push(request);if(failure)throw {response:{status:failure,data:{message:'fixture denied'}},config:request};return {data:{ok:true,dryRun:JSON.parse(request.data).dryRun},status:200,statusText:'OK',headers:{},config:request}};return config})
  const source=fs.readFileSync(new URL('../src/api/index.js',import.meta.url),'utf8').replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replaceAll('export function ','function ').replace('export const api =','const api =').replace('export default api','return api')
  const api=Function('axios','ElMessage','uploadFile','localStorage','sessionStorage','location',source)({...axios,create:()=>client},{error:message=>messages.push(message)},()=>{}, {getItem:()=> 'new-active-cluster',removeItem:key=>removed.push(key)},{getItem:()=> 'csrf-selected',removeItem:key=>removed.push(key)}, location)
  const controller=new AbortController()
  for(const dryRun of [true,false]){
    await api.restartPod('team','web',{uid:'selected-pod-uid',dryRun,clusterId:'selected-cluster',signal:controller.signal})
    const request=requests.at(-1)
    assert.deepEqual(JSON.parse(request.data),{uid:'selected-pod-uid',dryRun})
    assert.equal(request.params.clusterId,'selected-cluster')
    assert.equal(request.signal,controller.signal)
    assert.equal(request.headers.get('X-CSRF-Token'),'csrf-selected')
    assert.equal(request.withCredentials,true)
  }
  await api.restartPod('team','web')
  assert.equal(requests.at(-1).params.clusterId,'new-active-cluster')
  assert.equal(JSON.parse(requests.at(-1).data).dryRun,false)
  failure=429
  await assert.rejects(api.restartPod('team','web',{silent:true}))
  assert.equal(messages.length,0,'per-row batch errors must not stack global toast messages')
  await assert.rejects(api.restartPod('team','web'))
  assert.equal(messages.length,1)
  failure=401
  await assert.rejects(api.restartPod('team','web',{silent:true}))
  assert.equal(location.href,'/login');assert.ok(removed.includes('kp_csrf'))
})
