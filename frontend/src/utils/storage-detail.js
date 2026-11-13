const modes={ReadWriteOnce:'单节点读写（RWO）',ReadOnlyMany:'多节点只读（ROX）',ReadWriteMany:'多节点读写（RWX）',ReadWriteOncePod:'单容器组读写（RWOP）'}
export const accessModeText=value=>(value||[]).map(mode=>modes[mode]||mode).join('、')||'—'
export const storageState=value=>({Bound:'已绑定',Pending:'待绑定',Available:'可用',Released:'已释放',Failed:'失败',Lost:'已丢失'}[value]||value||'—')
export function storageFacts(resource){
 const s=resource.spec||{},st=resource.status||{}
 if(resource.kind==='StorageClass')return [['存储供给器',resource.provisioner||'—'],['回收策略',resource.reclaimPolicy||'Delete（默认）'],['绑定模式',resource.volumeBindingMode||'Immediate（默认）'],['允许扩容',resource.allowVolumeExpansion?'允许':'不允许'],['挂载选项',(resource.mountOptions||[]).join('、')||'—']]
 const rows=[['存储类',s.storageClassName===undefined?'未指定（由集群默认规则处理）':s.storageClassName||'无存储类'],['卷模式',s.volumeMode==='Block'?'裸块设备':'文件系统'],['状态',storageState(st.phase)]]
 if(resource.kind==='PersistentVolumeClaim')return [...rows,['申请访问模式',accessModeText(s.accessModes)],['实际访问模式',accessModeText(st.accessModes)],['申请容量',s.resources?.requests?.storage||'—'],['实际容量',st.capacity?.storage||'—'],['绑定持久卷',s.volumeName||'未绑定']]
 return [...rows,['访问模式',accessModeText(s.accessModes)],['容量',s.capacity?.storage||'—'],['回收策略',s.persistentVolumeReclaimPolicy||'—'],['挂载选项',(s.mountOptions||[]).join('、')||'—']]
}
export function volumeSourceRows(resource){
 const s=resource?.spec||{}
 if(s.hostPath)return [['类型','宿主机路径（hostPath）'],['路径',s.hostPath.path||'—'],['路径检查',s.hostPath.type||'不检查']]
 if(s.nfs)return [['类型','NFS'],['服务器',s.nfs.server||'—'],['共享路径',s.nfs.path||'—'],['只读',s.nfs.readOnly?'是':'否']]
 if(s.csi)return [['类型','CSI'],['存储驱动',s.csi.driver||'—'],['卷标识',s.csi.volumeHandle||'—'],['文件系统',s.csi.fsType||'未指定'],['只读',s.csi.readOnly?'是':'否'],...Object.entries(s.csi.volumeAttributes||{}).map(([k,v])=>['卷属性 · '+k,String(v)])]
 if(s.local)return [['类型','本地卷（local）'],['路径',s.local.path||'—'],['文件系统',s.local.fsType||'未指定']]
 const keys=['iscsi','cephfs','rbd','awsElasticBlockStore','azureDisk','azureFile','gcePersistentDisk','vsphereVolume','flexVolume','cinder','fc','glusterfs']
 const type=keys.find(k=>s[k]);return type?[['类型',type]]:[['类型','未提供存储源信息']]
}
export function storageRelation(resource){
 if(resource.kind==='PersistentVolumeClaim'&&resource.spec?.volumeName)return {kind:'PersistentVolume',plural:'persistentvolumes',namespace:'_all',name:resource.spec.volumeName}
 const claim=resource.spec?.claimRef
 if(resource.kind==='PersistentVolume'&&claim?.name&&claim.namespace)return {kind:'PersistentVolumeClaim',plural:'persistentvolumeclaims',namespace:claim.namespace,name:claim.name,uid:claim.uid}
 return null
}
