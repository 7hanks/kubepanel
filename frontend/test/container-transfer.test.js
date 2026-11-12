import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import axios from 'axios'

const transfer=await import('../src/utils/container-transfer.js').catch(()=>({}))
const limit=5*1024**3

test('file transfer accepts exactly 5 GiB without reading the file and rejects larger or malformed sizes',()=>{
 assert.equal(typeof transfer.validateUpload,'function')
 let reads=0
 const file={name:'large.bin',size:limit,arrayBuffer(){reads++;throw new Error('must stream original File')}}
 assert.equal(transfer.validateUpload(file),file)
 assert.equal(reads,0)
 assert.throws(()=>transfer.validateUpload({...file,size:limit+1}),/5 GiB/)
 for(const size of [-1,NaN,Infinity,1.5,'10'])assert.throws(()=>transfer.validateUpload({...file,size}),/大小/)
 assert.equal(transfer.validateUpload({...file,size:0}).size,0)
})

test('transfer validation rejects path components and control characters in a local filename',()=>{
 assert.equal(typeof transfer.validateUpload,'function')
 for(const name of ['', '.', '..','../file','folder/file','folder\\file','file\nname'])assert.throws(()=>transfer.validateUpload({name,size:1}),/名称/)
 assert.equal(transfer.validateUpload({name:'文件 $(text); space.bin',size:1}).name,'文件 $(text); space.bin')
})

test('upload sends the original File through XHR with snapshot scope, cancellation and bounded progress',async()=>{
 assert.equal(typeof transfer.uploadFile,'function')
 const file={name:'large.bin',size:limit,arrayBuffer(){throw new Error('must not buffer File')}}
 const signal=new AbortController().signal,progress=[];let outgoing
 const result=await transfer.uploadFile({post:async(url,body,config)=>{outgoing={url,body,config};config.onUploadProgress({loaded:3*1024**3,total:limit});config.onUploadProgress({loaded:limit+10,total:limit+10});return {ok:true,bytes:limit}}},{clusterId:'selected-cluster',namespace:'team',pod:'web',container:'app',uid:'pod1',path:'/tmp/large.bin',overwrite:true,confirmed:true},file,{signal,onProgress:value=>progress.push(value)})
 assert.equal(outgoing.url,'/v1/container/files/upload')
 assert.equal(outgoing.body,file)
 assert.equal(outgoing.config.adapter,'xhr')
 assert.equal(outgoing.config.timeout,0)
 assert.equal(outgoing.config.signal,signal)
 assert.equal(outgoing.config.headers['Content-Type'],'application/octet-stream')
 assert.equal(outgoing.config.transformRequest[0](file),file)
 assert.deepEqual(outgoing.config.params,{clusterId:'selected-cluster',namespace:'team',pod:'web',container:'app',uid:'pod1',path:'/tmp/large.bin',size:limit,overwrite:'true',confirmed:'true'})
 assert.deepEqual(progress,[{loaded:3*1024**3,total:limit},{loaded:limit,total:limit}])
 assert.deepEqual(result,{ok:true,bytes:limit})
})

test('upload refuses oversize and unconfirmed requests before contacting the server',async()=>{
 assert.equal(typeof transfer.uploadFile,'function')
 let calls=0;const client={post(){calls++;return Promise.resolve({})}}
 await assert.rejects(transfer.uploadFile(client,{confirmed:true},{name:'large',size:limit+1}),/5 GiB/)
 await assert.rejects(transfer.uploadFile(client,{confirmed:false},{name:'file',size:1}),/确认/)
 assert.equal(calls,0)
})

test('native download uses a same-origin ticket URL without fetching or buffering file contents',()=>{
 assert.equal(typeof transfer.startNativeDownload,'function')
 const events=[],link={click(){events.push('click')},remove(){events.push('remove')}}
 const environment={origin:'https://console.example',document:{createElement:name=>{assert.equal(name,'a');return link},body:{appendChild:value=>{assert.equal(value,link);events.push('append')}}}}
 transfer.startNativeDownload('/api/v1/container/files/download?ticket=one-use&clusterId=dev','large.bin',environment)
 assert.equal(link.href,'https://console.example/api/v1/container/files/download?ticket=one-use&clusterId=dev')
 assert.equal(link.download,'large.bin')
 assert.equal(link.referrerPolicy,'no-referrer')
 assert.deepEqual(events,['append','click','remove'])
 assert.throws(()=>transfer.startNativeDownload('https://external.example/file','file',environment),/同源/)
 assert.throws(()=>transfer.startNativeDownload('javascript:alert(1)','file',environment),/同源/)
 assert.throws(()=>transfer.startNativeDownload(undefined,'file',environment),/下载地址/)
})

test('raw upload and download-ticket requests keep shared CSRF credentials and explicit cluster scope',async()=>{
 const outgoing=[]
 const client=axios.create({withCredentials:true})
 // Replace only the network boundary; run the real Axios interceptor and
 // request-transform pipeline used by the production API module.
 client.interceptors.request.use(config=>{config.adapter=async request=>{outgoing.push(request);return {data:{ok:true,bytes:limit,url:'/api/v1/container/files/download?ticket=one'},status:200,statusText:'OK',headers:{},config:request}};return config})
 const source=fs.readFileSync(new URL('../src/api/index.js',import.meta.url),'utf8').replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replaceAll('export function ','function ').replace('export const api =','const api =').replace('export default api','return api')
 const api=Function('axios','ElMessage','uploadFile','localStorage','sessionStorage','location',source)({...axios,create:()=>client},{error(){}},transfer.uploadFile,{getItem:()=> 'other-cluster'}, {getItem:()=> 'csrf-test-token'}, {pathname:'/c/dev/overview'})
 const target={clusterId:'dev',namespace:'team',pod:'web',container:'app',uid:'pod1',path:'/large.bin',confirmed:true}
 const file=new File([],'large.bin');Object.defineProperty(file,'size',{value:limit})
 await api.containerUpload(target,file)
 await api.containerDownloadTicket(target)
 assert.equal(outgoing.length,2)
 assert.equal(outgoing[0].data,file)
 for(const request of outgoing){assert.equal(request.params.clusterId,'dev');assert.equal(request.headers.get('X-CSRF-Token'),'csrf-test-token');assert.equal(request.withCredentials,true)}
 assert.equal(outgoing[0].headers.get('Content-Type'),'application/octet-stream')
 assert.equal(JSON.parse(outgoing[1].data).uid,'pod1')
})
