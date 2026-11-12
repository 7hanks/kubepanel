const titles={Pod:'容器组',Deployment:'部署',StatefulSet:'有状态副本集',DaemonSet:'守护进程集',ReplicaSet:'副本集',Job:'任务',CronJob:'定时任务',Service:'服务',Ingress:'路由',NetworkPolicy:'网络策略',ConfigMap:'配置字典',Secret:'密文',PersistentVolumeClaim:'持久卷声明',PersistentVolume:'持久卷',StorageClass:'存储类',Node:'节点',Namespace:'命名空间',Event:'事件',ServiceAccount:'服务账户',Role:'角色',RoleBinding:'角色绑定',ClusterRole:'集群角色',ClusterRoleBinding:'集群角色绑定',HorizontalPodAutoscaler:'自动扩缩容',ResourceQuota:'资源配额',LimitRange:'限制范围',CustomResourceDefinition:'自定义资源定义'}
export const resourceTitle=meta=>titles[meta.kind]||meta.label||meta.kind||'资源'
export function filterResourceRows(rows,{type='',createdRange=[]}={}){
 const validRange=Array.isArray(createdRange)&&createdRange.length===2
 const start=validRange?new Date(createdRange[0]):null,end=validRange?new Date(createdRange[1]):null
 start?.setHours(0,0,0,0);end?.setHours(23,59,59,999)
 return rows.filter(row=>{
  if(type&&row.type!==type)return false
  if(validRange){const timestamp=Date.parse(row._raw?.metadata?.creationTimestamp);if(!Number.isFinite(timestamp)||timestamp<start.getTime()||timestamp>end.getTime())return false}
  return true
 })
}
export function servicePortLabel(port){return `${port.port} → ${port.targetPort??port.port} / ${port.protocol||'TCP'}${port.nodePort?` · ${port.nodePort}`:''}`}
export function podScaleAvailability(row){
 const owners=(row._raw?.metadata?.ownerReferences||[]).filter(owner=>owner.controller===true)
 if(owners.length!==1)return '独立 Pod 没有可调整的副本数'
 if(!['ReplicaSet','StatefulSet'].includes(owners[0].kind)||owners[0].apiVersion!=='apps/v1')return '该控制器不支持调整副本数'
 return ''
}
