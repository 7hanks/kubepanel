export const STORAGE_KINDS = ['PersistentVolumeClaim','PersistentVolume','StorageClass']
export const STORAGE_ACCESS_MODES = ['ReadWriteOnce','ReadOnlyMany','ReadWriteMany','ReadWriteOncePod']
export const PV_SOURCE_FIELDS = ['gcePersistentDisk','awsElasticBlockStore','hostPath','glusterfs','nfs','rbd','iscsi','cinder','cephfs','fc','flocker','flexVolume','azureFile','vsphereVolume','quobyte','azureDisk','photonPersistentDisk','portworxVolume','scaleIO','local','storageos','csi']

// Compare quantities without rounding large storage values through JavaScript Number.
function quantity(value){
 if(!['string','number'].includes(typeof value))return null
 const text=String(value),match=text.match(/^([+-]?)(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+|[numkKMGTPE]|[KMGTPE]i)?$/)
 if(!match||text.length>2048)return null
 const [,sign,decimal,suffix='']=match,[integer,fraction='']=decimal.split('.')
 let numerator=BigInt(`${integer||'0'}${fraction}`)*(sign==='-'?-1n:1n),denominator=10n**BigInt(fraction.length)
 if(suffix.endsWith('i'))numerator*=2n**BigInt((['Ki','Mi','Gi','Ti','Pi','Ei'].indexOf(suffix)+1)*10)
 else{
  const power=/^[eE][+-]?\d+$/.test(suffix)?Number(suffix.slice(1)):({n:-9,u:-6,m:-3,'':0,k:3,K:3,M:6,G:9,T:12,P:15,E:18})[suffix]
  if(!Number.isSafeInteger(power)||Math.abs(power)>10000)return null
  if(power>=0)numerator*=10n**BigInt(power);else denominator*=10n**BigInt(-power)
 }
 return {numerator,denominator}
}
function compare(a,b){return a.numerator*b.denominator-b.numerator*a.denominator}
function same(a,b){
 if(a===b)return true
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false
 const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]))
}
function clone(value){return JSON.parse(JSON.stringify(value))}
function validateAccessModes(spec){
 if(!Array.isArray(spec.accessModes)||!spec.accessModes.length||spec.accessModes.some(mode=>!STORAGE_ACCESS_MODES.includes(mode)))throw new Error('至少选择一种有效的访问模式')
 if(new Set(spec.accessModes).size!==spec.accessModes.length)throw new Error('访问模式不能重复')
 if(spec.accessModes.includes('ReadWriteOncePod')&&spec.accessModes.length>1)throw new Error('ReadWriteOncePod 不能与其他访问模式组合')
 if(spec.volumeMode!==undefined&&!['Filesystem','Block'].includes(spec.volumeMode))throw new Error('卷模式必须是 Filesystem 或 Block')
}
function validateCapacity(value){const parsed=quantity(value);if(!parsed||parsed.numerator<=0n)throw new Error('容量必须是大于 0 的 Kubernetes 存储数量，例如 10Gi 或 500Mi');return parsed}
function validateStringMap(value,label){if(value!==undefined&&(value===null||Array.isArray(value)||typeof value!=='object'||Object.entries(value).some(([key,item])=>!key||typeof item!=='string')))throw new Error(`${label}的键不能为空，值必须是文本`)}

export function validateStorageResource(resource,{creating=false,original}={}){
 if(!STORAGE_KINDS.includes(resource?.kind))return
 const spec=resource.spec||{}
 if(resource.kind==='StorageClass'){
  if(typeof resource.provisioner!=='string'||!resource.provisioner.trim())throw new Error('存储供给器必填')
  validateStringMap(resource.parameters,'供给器参数')
  if(resource.reclaimPolicy!==undefined&&!['Retain','Delete'].includes(resource.reclaimPolicy))throw new Error('存储类回收策略必须是 Retain 或 Delete')
  if(resource.volumeBindingMode!==undefined&&!['Immediate','WaitForFirstConsumer'].includes(resource.volumeBindingMode))throw new Error('卷绑定模式无效')
  if(resource.allowVolumeExpansion!==undefined&&typeof resource.allowVolumeExpansion!=='boolean')throw new Error('允许扩容必须是布尔值')
  if(!creating&&original)for(const key of ['provisioner','parameters','reclaimPolicy','volumeBindingMode'])if(!same(resource[key],original[key]))throw new Error('供给器、参数、回收策略和绑定模式创建后不可修改')
  return
 }
 validateAccessModes(spec)
 const capacity=resource.kind==='PersistentVolumeClaim'?spec.resources?.requests?.storage:spec.capacity?.storage,current=validateCapacity(capacity)
 if(resource.kind==='PersistentVolumeClaim'){
  if(spec.storageClassName!==undefined&&typeof spec.storageClassName!=='string')throw new Error('存储类名称必须是文本')
  if(!creating&&original){
   const minimum=quantity(original.spec?.resources?.requests?.storage)
   if(minimum&&compare(current,minimum)<0n)throw new Error(`容量不能小于原申请容量 ${original.spec.resources.requests.storage}`)
   const nextSpec=clone(spec),oldSpec=original.spec||{}
   if(original.status?.phase==='Bound'&&nextSpec.resources?.requests)nextSpec.resources.requests.storage=oldSpec.resources?.requests?.storage
   if(!same(nextSpec,oldSpec))throw new Error('PVC 创建后配置不可修改；已绑定的 PVC 仅可增加申请容量')
  }
  return
 }
 if(spec.persistentVolumeReclaimPolicy!==undefined&&!['Retain','Delete','Recycle'].includes(spec.persistentVolumeReclaimPolicy))throw new Error('持久卷回收策略无效')
 const sources=PV_SOURCE_FIELDS.filter(key=>spec[key]!==undefined&&spec[key]!==null)
 if(sources.length>1||creating&&sources.length!==1)throw new Error('持久卷必须配置且只能配置一个存储源')
 if(spec.nfs){if(!spec.nfs.server?.trim())throw new Error('NFS 服务器必填');if(typeof spec.nfs.path!=='string'||!spec.nfs.path.startsWith('/'))throw new Error('NFS 共享路径必须是绝对路径')}
 if(spec.hostPath&&(typeof spec.hostPath.path!=='string'||!spec.hostPath.path.startsWith('/')))throw new Error('宿主机路径必须是绝对路径')
 if(spec.csi){if(!spec.csi.driver?.trim()||!spec.csi.volumeHandle?.trim())throw new Error('CSI 驱动和卷标识必填');validateStringMap(spec.csi.volumeAttributes,'CSI 卷属性')}
 if(!creating&&original){
  if(PV_SOURCE_FIELDS.some(key=>!same(spec[key],original.spec?.[key])))throw new Error('持久卷存储源创建后不可修改')
  if(!same(spec.volumeMode,original.spec?.volumeMode))throw new Error('持久卷的卷模式创建后不可修改')
 }
}
