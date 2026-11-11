export function ownedPods(resource,pods,intermediates=[]) {
 const uid=resource?.metadata?.uid,namespace=resource?.metadata?.namespace
 if(!uid||!namespace)return []
 if(resource.kind==='Pod')return pods.filter(p=>p.metadata?.uid===uid&&p.metadata?.namespace===namespace)
 const owners=new Set([uid]);let changed=true
 while(changed){changed=false;for(const item of intermediates){if(item.metadata?.namespace!==namespace||!item.metadata?.uid)continue;if((item.metadata.ownerReferences||[]).some(owner=>owner.controller===true&&owners.has(owner.uid))&&!owners.has(item.metadata.uid)){owners.add(item.metadata.uid);changed=true}}}
 return pods.filter(p=>p.metadata?.namespace===namespace&&(p.metadata?.ownerReferences||[]).some(owner=>owner.controller===true&&owners.has(owner.uid)))
}
export function podContainers(pod) {
 return ['containers','initContainers','ephemeralContainers'].flatMap((field,index)=>(pod.spec?.[field]||[]).map(c=>{
  const status=pod.status?.[['containerStatuses','initContainerStatuses','ephemeralContainerStatuses'][index]]?.find(s=>s.name===c.name)
  return {...c,type:['Container','Init','Ephemeral'][index],running:!!status?.state?.running,state:status?.state?.running?'Running':status?.state?.waiting?.reason||status?.state?.terminated?.reason||'Unknown',startedAt:status?.state?.running?.startedAt||status?.state?.terminated?.startedAt||'',namespace:pod.metadata.namespace,pod:pod.metadata.name,uid:pod.metadata.uid,container:c.name,key:pod.metadata.uid+'/'+c.name}
 }))
}
