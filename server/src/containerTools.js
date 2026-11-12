import { PassThrough } from 'node:stream'
import { Exec } from '@kubernetes/client-node'
import { getKubeConfig, resRequest } from './kube.js'
import { assertResourceAccess } from './access.js'
import { can } from './permissions.js'
import { writeAudit } from './auditService.js'
import { createTransferExecutor, transferCommand, transferSize } from './fileTransfer.js'

const fail=(status,message)=>{throw Object.assign(new Error(message),{status})}
const FILE_LIMIT=1024*1024
const identity=value=>typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,252}$/.test(value)
export function safeContainerPath(value) {
 if(typeof value!=='string'||!value.startsWith('/')||value.length>4096||/[\x00-\x1f\x7f]/.test(value)||value.split('/').some(x=>x==='..')) fail(400,'路径必须是容器内的绝对路径，不能包含 .. 或控制字符')
 return value.replace(/\/+$/,'') || '/'
}
export function containerCommand(action,path,options={}) {
 const p=safeContainerPath(path)
 // All paths are positional arguments. Never concatenate untrusted paths into a script.
 const scripts={
  list:'p=$1; [ -d "$p" ] || exit 2; n=0; for f in "$p"/.[!.]* "$p"/..?* "$p"/*; do [ -e "$f" ] || [ -L "$f" ] || continue; n=$((n+1)); if [ "$n" -gt 200 ]; then printf "limit\\000"; break; fi; t=file; if [ -L "$f" ]; then t=link; elif [ -d "$f" ]; then t=directory; fi; printf "%s\\000%s\\000" "$t" "${f##*/}"; done',
  read:'[ -f "$1" ] && [ ! -L "$1" ] || exit 2; head -c 1048577 "$1"',
  write:'[ ! -L "$1" ] && { [ ! -e "$1" ] || [ -f "$1" ]; } || exit 2; if [ "$2" = create ]; then (set -C; head -c "$3" > "$1"); else head -c "$3" > "$1"; fi',
  mkdir:'mkdir "$1"',
  delete:'if [ -d "$1" ] && [ ! -L "$1" ]; then rmdir "$1"; else rm -f "$1"; fi',
 }
 if(!scripts[action]) fail(400,'不支持的文件操作')
 if(['write','mkdir','delete'].includes(action)&&p==='/') fail(400,'不能修改或删除容器根目录')
 return ['/bin/sh','-c',scripts[action],'kubepanel',p,...(action==='write' ? [options.overwrite===true ? 'overwrite':'create',String(options.bytes??0)]:[])]
}
export function createExecRunner(connect) { return function execute(target,command,{input,timeoutMs=10000,maxBytes=256*1024,signal,authorize=()=>{}}={}) {
 return new Promise((resolve,reject)=>{
  let socket,done=false,total=0;const out=[],err=[]
  const stdout=new PassThrough(),stderr=new PassThrough(),stdin=input===undefined ? null:new PassThrough()
  const finish=(error,status)=>{if(done)return;done=true;clearTimeout(timer);clearInterval(recheck);signal?.removeEventListener('abort',abort);stdout.destroy();stderr.destroy();stdin?.destroy();try{socket?.close()}catch{};if(error)reject(error);else resolve({stdout:Buffer.concat(out),stderr:Buffer.concat(err).toString('utf8'),exitCode:status?.status==='Success' ? 0:Number(status?.details?.causes?.find(x=>x.reason==='ExitCode')?.message ?? 1)})}
  const abort=()=>finish(Object.assign(new Error('请求已取消；已启动的容器进程可能继续运行'),{status:499}))
  const timer=setTimeout(()=>finish(Object.assign(new Error('执行等待超时；已启动的容器进程可能继续运行'),{status:504})),timeoutMs)
  const recheck=setInterval(()=>{try{authorize()}catch(e){finish(e)}},500)
  const chunk=(list,c)=>{total+=c.length;if(total>maxBytes){finish(Object.assign(new Error('输出超过限制，连接已关闭'),{status:413}));return}list.push(Buffer.from(c))}
  stdout.on('data',c=>chunk(out,c));stderr.on('data',c=>chunk(err,c))
  signal?.addEventListener('abort',abort,{once:true})
  try {
   authorize();if(signal?.aborted){abort();return}
   Promise.resolve(connect(target,command,stdout,stderr,stdin,status=>finish(null,status))).then(ws=>{
    socket=ws;if(done){try{ws.close()}catch{};return}
    ws.on?.('error',()=>finish(Object.assign(new Error('容器执行连接失败'),{status:502})))
    ws.on?.('close',()=>{if(!done)finish(Object.assign(new Error('连接已关闭，未收到执行结果'),{status:502}))})
    // v4 exec closes the entire channel on stdin EOF. The fixed remote writer
    // consumes an exact byte count, so keep stdin open until the status arrives.
    if(stdin)stdin.write(input)
   }).catch(()=>finish(Object.assign(new Error('无法建立容器执行连接；请检查容器状态及 pods/exec 权限'),{status:502})))
  } catch(e){finish(e)}
 })
}}
export const executeContainer=createExecRunner((target,command,stdout,stderr,stdin,callback)=>new Exec(getKubeConfig(target.clusterId)).exec(target.namespace,target.pod,target.container,command,stdout,stderr,stdin,false,callback))
const active=new Map()
export function createContainerTools({readPod=async t=>(await resRequest('GET',{group:'',version:'v1',plural:'pods'},{clusterId:t.clusterId,namespace:t.namespace,name:t.pod,timeout:4000})).data,execute=executeContainer,transfer=createTransferExecutor(),audit=writeAudit}={}) {
 const authorize=(account,clusterId,t,permission)=>{
  if(!can(account,permission))fail(403,'缺少独立的容器操作权限')
  if(![t.namespace,t.pod,t.container].every(identity)||!identity(clusterId)||!identity(t.uid))fail(400,'缺少合法的 Pod / 容器身份')
  assertResourceAccess(account,{clusterId,namespace:t.namespace,group:'',plural:'pods',verb:'get'})
 }
 async function run(account,clusterId,t,permission,command,options,live=()=>account,executor=execute) {
  const check=()=>authorize(live(),clusterId,t,permission)
  check();const target={...t,clusterId};const pod=await readPod(target);check()
  if(pod.metadata?.uid!==t.uid)fail(409,'Pod 已重新创建，请刷新后重新选择')
  if(![...(pod.spec?.containers||[]),...(pod.spec?.initContainers||[]),...(pod.spec?.ephemeralContainers||[])].some(c=>c.name===t.container))fail(400,'容器不存在')
  if(![...(pod.status?.containerStatuses||[]),...(pod.status?.initContainerStatuses||[]),...(pod.status?.ephemeralContainerStatuses||[])].some(c=>c.name===t.container&&c.state?.running))fail(409,'容器当前未运行')
  audit({username:account.username,action:permission,clusterId,namespace:t.namespace,resource:'pods/exec',name:t.pod,status:200})
  const result=await executor(target,command,{...options,authorize:check});check();return result
 }
 async function limited(account,fn){const key=account.username;if((active.get(key)||0)>=2)fail(429,'容器操作过于频繁，请等待当前操作完成');active.set(key,(active.get(key)||0)+1);try{return await fn()}finally{active.set(key,Math.max(0,(active.get(key)||1)-1))}}
 async function fileSize(account,clusterId,body,{signal,live}={}) {
  const path=safeContainerPath(body.path)
  const result=await run(account,clusterId,body,'pod:files:read',transferCommand('stat',path),{signal,maxBytes:2048},live)
  if(result.exitCode!==0)fail(422,'无法读取文件，请检查路径及容器内的 stat 工具')
  return transferSize(result.stdout.toString().trim())
 }
 return {
  upload:(account,clusterId,body,{input,signal,live}={})=>limited(account,async()=>{
   authorize(account,clusterId,body,'pod:files:write')
   const path=safeContainerPath(body.path),size=transferSize(body.size)
   if(path==='/')fail(400,'不能覆盖容器根目录')
   if(body.confirmed!==true)fail(400,'上传文件需要明确确认')
   const result=await run(account,clusterId,body,'pod:files:write',transferCommand('upload',path,{size,overwrite:body.overwrite===true}),{input,size,signal},live,transfer)
   return {ok:true,path,bytes:result.bytes}
  }),
  downloadInfo:(account,clusterId,body,options)=>limited(account,()=>fileSize(account,clusterId,body,options)),
  download:(account,clusterId,body,{output,onReady,signal,live}={})=>limited(account,async()=>{
   const path=safeContainerPath(body.path),size=await fileSize(account,clusterId,body,{signal,live})
   if(body.bytes!==size)fail(409,'文件大小已变化，请重新下载')
   onReady(size)
   return run(account,clusterId,body,'pod:files:read',transferCommand('download',path,{size}),{output,size,signal},live,transfer)
  }),
  file:(account,clusterId,body,{signal,live}={})=>limited(account,async()=>{
   const {action}=body,path=safeContainerPath(body.path),permission=['list','read'].includes(action)?'pod:files:read':'pod:files:write'
   authorize(account,clusterId,body,permission)
   if(!['list','read'].includes(action)&&body.confirmed!==true)fail(400,'文件变更需要明确确认')
   let input
   if(action==='write'){
    if(typeof body.base64!=='string'||body.base64.length>Math.ceil(FILE_LIMIT/3)*4+4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.base64))fail(400,'文件内容不是合法 Base64 或超过 1 MiB')
    input=Buffer.from(body.base64,'base64');if(input.length>FILE_LIMIT)fail(413,'在线编辑不能超过 1 MiB，请使用上传文件')
   }
   const command=containerCommand(action,path,{...body,bytes:input?.length||0})
   const result=await run(account,clusterId,body,permission,command,{input,signal,maxBytes:action==='read'?FILE_LIMIT+2048:128*1024},live)
   if(result.exitCode!==0)fail(422,`容器内文件操作失败（退出码 ${result.exitCode}）。请检查路径、读写权限和容器内工具是否可用。`)
   if(action==='list'){
    const parts=result.stdout.toString('utf8').split('\0'),entries=[];let truncated=false
    for(let i=0;i<parts.length-1;){const type=parts[i++];if(type==='limit'){truncated=true;break}const name=parts[i++];if(!name||!['file','directory','link'].includes(type))continue;entries.push({name,type,path:(path==='/'?'':path)+'/'+name})}
    return {path,entries,truncated}
   }
   if(action==='read'){if(result.stdout.length>FILE_LIMIT)fail(413,'文件超过 1 MiB，无法在线读取');return {path,base64:result.stdout.toString('base64'),bytes:result.stdout.length}}
   return {ok:true,path}
  }),
 }
}
export const containerTools=createContainerTools()
