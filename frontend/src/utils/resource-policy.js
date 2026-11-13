import {WORKLOAD_KINDS} from './resource-form.js'

export function resourceUiPolicy(meta){
 const group=meta.group||'',core=group===''||group==='_core'
 const observed=meta.kind==='Event'&&(core||group==='events.k8s.io')
 if(observed)return {create:'none',edit:'none',yamlReadonly:true,reason:'事件由集群组件记录，此处仅提供查看。'}
 if(core&&meta.kind==='Node')return {create:'none',edit:'simple',reason:'新增节点需要在目标主机完成安装和集群接入，创建 Node 对象不会让机器加入集群。'}
 if(core&&['Namespace','ServiceAccount'].includes(meta.kind))return {create:'simple',edit:'simple'}
 if(core&&meta.kind==='Pod')return {create:'form',edit:'none',reason:'容器组不提供表单编辑，请在所属工作负载中修改容器组模板。'}
 const specialized=core&&['Service','ConfigMap','Secret','PersistentVolumeClaim','PersistentVolume'].includes(meta.kind)
  ||group==='storage.k8s.io'&&meta.kind==='StorageClass'
  ||['apps','batch'].includes(group)&&WORKLOAD_KINDS.includes(meta.kind)
 return {create:specialized?'form':'yaml',edit:specialized?'form':'yaml'}
}
