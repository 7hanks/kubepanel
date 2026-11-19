import {resRequest,kubeStream,KubeError} from './kube.js'
import {assertResourceAccess} from './access.js'
import {authorizeContainerTarget,verifyContainerTarget,executeContainer} from './containerTools.js'
import {writeAudit} from './auditService.js'

export const BATCH_EXEC_LIMITS=Object.freeze({maxTargets:20,timeoutMs:10000,maxOutputBytes:64*1024,totalTimeoutMs:60000,concurrency:2,maxCommandBytes:8192})
export const LOG_DOWNLOAD_LIMITS=Object.freeze({maxBytes:5*1024*1024,maxTailLines:20000,timeoutMs:15000})
const identity=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,252}$/.test(value)
const fail=(status,message)=>{throw new KubeError(status,message)}
const batchActive=new Map(),logActive=new Map()
function controllerOf(resource){const owners=resource.metadata?.ownerReferences;if(owners!==undefined&&!Array.isArray(owners))fail(409,'控制器引用已变化，请刷新');const controllers=(owners||[]).filter(owner=>owner?.controller===true);if(controllers.length!==1)fail(409,'无法确认唯一的工作负载控制器');return controllers[0]}
function verifyResource(resource,{kind,namespace,name,uid}){
 if(resource?.kind!==kind||resource.apiVersion!==(kind==='Pod'?'v1':'apps/v1')||resource.metadata?.namespace!==namespace||resource.metadata?.name!==name||resource.metadata?.uid!==uid||resource.metadata?.deletionTimestamp)fail(409,'Pod 或工作负载身份已变化或正在删除，请刷新后重新选择')
}
function linkedDeadline(signal,timeoutMs,message){
 const controller=new AbortController(),abort=()=>controller.abort(signal?.reason instanceof Error&&signal.reason.status?signal.reason:new KubeError(499,'请求已取消'))
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true})
 const timer=setTimeout(()=>controller.abort(new KubeError(504,message)),timeoutMs)
 return {signal:controller.signal,abort:error=>controller.abort(error),check(){if(controller.signal.aborted)throw controller.signal.reason},cleanup(){clearTimeout(timer);signal?.removeEventListener('abort',abort)}}
}
async function limited(active,account,maximum,action){const key=account?.username||'';if((active.get(key)||0)>=maximum)fail(429,'当前操作过于频繁，请等待已开始的操作完成');active.set(key,(active.get(key)||0)+1);try{return await action()}finally{const count=(active.get(key)||1)-1;if(count)active.set(key,count);else active.delete(key)}}

/** Human-triggered operations only. All resource paths come from the authorized cluster and a pinned workload. */
export function createContainerActions({readResource=async(clusterId,group,plural,namespace,name)=>(await resRequest('GET',{group,version:'v1',plural},{clusterId,namespace,name,timeout:4000})).data,execute=executeContainer,stream=kubeStream,audit=writeAudit}={}){
 const read=async(account,clusterId,group,plural,namespace,name)=>{assertResourceAccess(account,{clusterId,namespace,group,plural,verb:'get'});return readResource(clusterId,group,plural,namespace,name)}
 async function batchExec(account,clusterId,body,{signal,live=()=>account}={}){
  if(body?.confirmed!==true)fail(400,'批量执行命令需要明确确认')
  const workload=body.workload,targets=body.targets,shell=body.shell||'/bin/sh'
  if(!workload||!['Deployment','Pod'].includes(workload.kind)||![workload.namespace,workload.name,workload.uid].every(identity))fail(400,'请选择合法且带 UID 的 Deployment 或 Pod')
  if(!['/bin/sh','/bin/bash','/bin/ash'].includes(shell))fail(400,'Shell 仅支持 /bin/sh、/bin/bash 或 /bin/ash')
  if(typeof body.command!=='string'||!body.command.trim()||Buffer.byteLength(body.command,'utf8')>BATCH_EXEC_LIMITS.maxCommandBytes||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body.command))fail(400,'命令不能为空、包含控制字符或超过 8 KiB')
  if(!Array.isArray(targets)||!targets.length||targets.length>BATCH_EXEC_LIMITS.maxTargets)fail(400,'每次请选择 1–20 个容器')
  const seen=new Set(),pinned=targets.map(target=>{
   if(!target||![target.pod,target.uid,target.container].every(identity)||target.namespace!==undefined&&target.namespace!==workload.namespace)fail(400,'容器目标缺少合法的 Pod / UID / 容器名称')
   if(typeof target.startedAt!=='string'||!target.startedAt||!Number.isFinite(Date.parse(target.startedAt)))fail(400,'容器目标缺少合法的 startedAt，请刷新后重新选择')
   if(target.containerID!==undefined&&(typeof target.containerID!=='string'||!target.containerID||target.containerID.length>1024||/[\x00-\x1f\x7f]/.test(target.containerID)))fail(400,'容器运行实例标识不合法')
   if(workload.kind==='Pod'&&(target.pod!==workload.name||target.uid!==workload.uid))fail(400,'所选容器不属于当前 Pod')
   const key=`${target.pod}/${target.container}`;if(seen.has(key))fail(400,'所选容器不能重复执行');seen.add(key)
   return {namespace:workload.namespace,pod:target.pod,uid:target.uid,container:target.container,startedAt:target.startedAt,...(target.containerID?{containerID:target.containerID}:{})}
  })
  const guard=target=>{const fresh=live();authorizeContainerTarget(fresh,clusterId,target,'pod:exec');if(workload.kind==='Deployment'){assertResourceAccess(fresh,{clusterId,namespace:workload.namespace,group:'apps',plural:'deployments',verb:'get'});assertResourceAccess(fresh,{clusterId,namespace:workload.namespace,group:'apps',plural:'replicasets',verb:'get'})}return fresh}
  for(const target of pinned)guard(target)
  return limited(batchActive,account,1,async()=>{
   const deadline=linkedDeadline(signal,BATCH_EXEC_LIMITS.totalTimeoutMs,'批量执行等待超时；已启动的容器进程可能继续运行')
   async function verify(target){
    deadline.check();let fresh=guard(target)
    const pod=await read(fresh,clusterId,'','pods',target.namespace,target.pod)
    deadline.check();guard(target);verifyResource(pod,{kind:'Pod',namespace:target.namespace,name:target.pod,uid:target.uid});verifyContainerTarget(pod,target,{pinRuntime:true})
    if(workload.kind==='Deployment'){
     const owner=controllerOf(pod)
     if(owner.kind!=='ReplicaSet'||owner.apiVersion!=='apps/v1'||![owner.name,owner.uid].every(identity))fail(409,'所选 Pod 不属于当前 Deployment 的 ReplicaSet')
     fresh=guard(target)
     const replicaSet=await read(fresh,clusterId,'apps','replicasets',target.namespace,owner.name)
     deadline.check();guard(target);verifyResource(replicaSet,{kind:'ReplicaSet',namespace:target.namespace,name:owner.name,uid:owner.uid})
     const deploymentOwner=controllerOf(replicaSet)
     if(deploymentOwner.kind!=='Deployment'||deploymentOwner.apiVersion!=='apps/v1'||deploymentOwner.name!==workload.name||deploymentOwner.uid!==workload.uid)fail(409,'所选 Pod 不属于当前 Deployment')
     const deployment=await read(guard(target),clusterId,'apps','deployments',workload.namespace,workload.name)
     deadline.check();guard(target);verifyResource(deployment,workload)
     // Controller reads may outlive a container restart; pin the Pod again immediately before exec.
     const currentPod=await read(guard(target),clusterId,'','pods',target.namespace,target.pod)
     deadline.check();guard(target);verifyResource(currentPod,{kind:'Pod',namespace:target.namespace,name:target.pod,uid:target.uid});verifyContainerTarget(currentPod,target,{pinRuntime:true})
     const currentOwner=controllerOf(currentPod)
     if(currentOwner.kind!==owner.kind||currentOwner.apiVersion!==owner.apiVersion||currentOwner.name!==owner.name||currentOwner.uid!==owner.uid)fail(409,'Pod 控制器引用已变化，请刷新后重新选择')
    }
   }
   const results=new Array(pinned.length);let cursor=0
   async function worker(){
    while(cursor<pinned.length){
     const index=cursor++,target=pinned[index],result={pod:target.pod,uid:target.uid,container:target.container,startedAt:target.startedAt,ok:false,stdout:'',stderr:'',status:0,uncertain:false};let started=false
     try{
      deadline.check();await verify(target);guard(target);deadline.check()
      audit({username:account.username,action:'pod:exec',clusterId,namespace:target.namespace,resource:'pods/exec',name:target.pod,status:202})
      started=true
      const output=await execute({...target,clusterId},[shell,'-c',body.command],{signal:deadline.signal,timeoutMs:BATCH_EXEC_LIMITS.timeoutMs,maxBytes:BATCH_EXEC_LIMITS.maxOutputBytes,authorize:()=>{deadline.check();guard(target)}})
      result.stdout=Buffer.isBuffer(output.stdout)?output.stdout.toString('utf8'):String(output.stdout||'');result.stderr=String(output.stderr||'');result.exitCode=output.exitCode
      await verify(target)
      result.ok=output.exitCode===0;result.status=result.ok?200:422;result.phase='completed';if(!result.ok)result.message=`命令退出码 ${output.exitCode}`
     }catch(error){
      const failure=deadline.signal.aborted?deadline.signal.reason:error
      result.status=failure?.status||502;result.message=failure?.message||'容器命令执行失败';result.uncertain=started;result.phase=started?'uncertain':'not-started'
      if(started&&!/可能继续运行|无法确认/.test(result.message))result.message+='；命令可能已开始执行，结果无法确认，请勿直接重试'
      if([401,403].includes(result.status))deadline.abort(failure)
     }
     results[index]=result
    }
   }
   try{await Promise.all(Array.from({length:Math.min(BATCH_EXEC_LIMITS.concurrency,pinned.length)},()=>worker()));return {ok:results.every(result=>result.ok),results,limits:BATCH_EXEC_LIMITS,timedOut:deadline.signal.aborted&&deadline.signal.reason?.status===504}}
   finally{deadline.cleanup()}
  })
 }
 async function downloadLogs(account,clusterId,target,query={}, {signal,live=()=>account}={}){
  authorizeContainerTarget(live(),clusterId,target,'pod:logs')
  const tailLines=query.tailLines===undefined?2000:Number(query.tailLines)
  if(!Number.isInteger(tailLines)||tailLines<1||tailLines>LOG_DOWNLOAD_LIMITS.maxTailLines)fail(400,'下载日志行数必须为 1–20000 的整数')
  if(target.startedAt!==undefined&&(typeof target.startedAt!=='string'||!Number.isFinite(Date.parse(target.startedAt))))fail(400,'日志容器启动时间不合法')
  if(target.containerID!==undefined&&(typeof target.containerID!=='string'||!target.containerID||target.containerID.length>1024||/[\x00-\x1f\x7f]/.test(target.containerID)))fail(400,'容器运行实例标识不合法')
  const previous=['1','true',true].includes(query.previous),timestamps=['1','true',true].includes(query.timestamps)
  return limited(logActive,account,2,async()=>{
   const deadline=linkedDeadline(signal,LOG_DOWNLOAD_LIMITS.timeoutMs,'下载日志超时，请缩小日志行数后重试');let upstream
   const guard=()=>{deadline.check();const fresh=live();authorizeContainerTarget(fresh,clusterId,target,'pod:logs');return fresh}
   const verify=async()=>{const pod=await read(guard(),clusterId,'','pods',target.namespace,target.pod);guard();verifyResource(pod,{kind:'Pod',namespace:target.namespace,name:target.pod,uid:target.uid});verifyContainerTarget(pod,target,{requireRunning:false,pinRuntime:true})}
   const abort=()=>upstream?.destroy(deadline.signal.reason)
   deadline.signal.addEventListener('abort',abort,{once:true})
   try{
    await verify()
    const params=new URLSearchParams({container:target.container,tailLines:String(tailLines),limitBytes:String(LOG_DOWNLOAD_LIMITS.maxBytes+1),follow:'false',timestamps:String(timestamps),previous:String(previous)})
    const path=`/api/v1/namespaces/${encodeURIComponent(target.namespace)}/pods/${encodeURIComponent(target.pod)}/log?${params}`
    upstream=await stream('GET',path,{clusterId,headers:{Accept:'*/*'},timeout:LOG_DOWNLOAD_LIMITS.timeoutMs,signal:deadline.signal})
    guard();let bytes=0;const chunks=[]
    for await(const chunk of upstream){guard();const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=buffer.length;if(bytes>LOG_DOWNLOAD_LIMITS.maxBytes)fail(413,'日志超过 5 MiB，请缩小日志行数后重新下载');chunks.push(buffer)}
    await verify()
    audit({username:account.username,action:'pod:logs:download',clusterId,namespace:target.namespace,resource:'pods/log',name:target.pod,status:200})
    return {buffer:Buffer.concat(chunks),filename:`${target.pod}-${target.container}${previous?'-previous':''}.log`,tailLines,previous,timestamps}
   }catch(error){throw deadline.signal.aborted?deadline.signal.reason:error}
   finally{deadline.signal.removeEventListener('abort',abort);deadline.cleanup();upstream?.destroy()}
  })
 }
 return {batchExec,downloadLogs}
}
export const containerActions=createContainerActions()
