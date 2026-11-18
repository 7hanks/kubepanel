const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const dnsLabel=value=>typeof value==='string'&&value.length>0&&value.length<=63&&/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value)
const dnsName=value=>typeof value==='string'&&value.length<=253&&value.split('.').every(dnsLabel)
const kindName=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9]*$/.test(value)

export function isCrdFormResource(meta){return meta?.group==='apiextensions.k8s.io'&&meta.kind==='CustomResourceDefinition'}
export function crdDraftFields(kind){
 if(kind!=='CustomResourceDefinition')return {}
 return {spec:{group:'',names:{plural:'',singular:'',kind:''},scope:'Namespaced',versions:[{name:'v1',served:true,storage:true,schema:{openAPIV3Schema:{type:'object',properties:{}}}}]}}
}
export function validateCrdResource(body,{original}={}){
 if(body?.kind!=='CustomResourceDefinition'||body.apiVersion&&body.apiVersion.split('/')[0]!=='apiextensions.k8s.io')return
 const spec=body.spec,names=spec?.names
 if(!object(spec))throw new Error('CRD spec 必须是对象')
 if(original){
  if(['group','scope'].some(key=>spec[key]!==original.spec?.[key])||['plural','kind'].some(key=>names?.[key]!==original.spec?.names?.[key]))throw new Error('CRD 的 API 组、作用范围、复数名称和类型创建后不可修改')
 }
 if(!dnsName(spec.group))throw new Error('CRD API 组必填，且必须是有效域名，例如 example.com')
 if(!object(names)||!dnsLabel(names.plural))throw new Error('CRD 资源复数名称必填，且必须是小写 DNS 标签')
 if(names.singular!==undefined&&names.singular!==''&&!dnsLabel(names.singular))throw new Error('CRD 资源单数名称必须是小写 DNS 标签')
 if(!kindName(names.kind))throw new Error('CRD 资源类型必填，且必须以字母开头、仅包含字母和数字')
 if(names.listKind!==undefined&&!kindName(names.listKind))throw new Error('CRD 列表类型必须以字母开头、仅包含字母和数字')
 if(!['Namespaced','Cluster'].includes(spec.scope))throw new Error('CRD 作用范围必须是 Namespaced 或 Cluster')
 if(body.metadata?.name!==`${names.plural}.${spec.group}`)throw new Error(`CRD 资源名称必须为 ${names.plural}.${spec.group}`)
 if(!Array.isArray(spec.versions)||!spec.versions.length)throw new Error('CRD 至少需要一个 API 版本')
 const versions=new Set()
 for(const version of spec.versions){
  if(!object(version)||!dnsLabel(version.name))throw new Error('CRD 版本名称必填，且必须是小写 DNS 标签，例如 v1')
  if(versions.has(version.name))throw new Error(`CRD 版本名称不能重复：${version.name}`)
  versions.add(version.name)
  if(typeof version.served!=='boolean'||typeof version.storage!=='boolean')throw new Error('每个 CRD 版本都需要明确设置 served 和 storage')
  if(!object(version.schema?.openAPIV3Schema)||version.schema.openAPIV3Schema.type!=='object')throw new Error(`版本 ${version.name} 需要根类型为 object 的 OpenAPI v3 schema`)
 }
 if(spec.versions.filter(version=>version.storage).length!==1)throw new Error('CRD 必须且只能选择一个存储版本')
 if(!spec.versions.some(version=>version.served))throw new Error('CRD 至少需要一个对外提供服务的版本（served）')
 for(const version of original?.status?.storedVersions||[])if(!versions.has(version))throw new Error(`版本 ${version} 存储过数据，迁移完成并更新 storedVersions 后才能移除`)
}
