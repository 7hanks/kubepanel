export function parseScope(scope = {}) {
 const result={}
 for(const key of ['clusters','namespaces','resources']) {
  const values=scope[key] ?? ['*']
  if(!Array.isArray(values)) throw new Error('范围必须是标签列表')
  result[key]=[...new Set(values.flatMap(v=>String(v).split(/[,，]/)).map(v=>v.trim()).filter(Boolean))]
  if(result[key].some(v=>v.length>253 || /[\s\\\x00-\x1f]/.test(v)))throw new Error('范围标签含非法字符')
  if(key==='resources' && result[key].some(v=>v!=='*' && !/^[_a-z0-9.-]+\/[a-z0-9.-]+$/.test(v)))throw new Error('资源范围应为 group/plural，例如 _core/pods')
  if(key!=='resources' && result[key].some(v=>v.includes('/') || v==='.' || v==='..'))throw new Error('集群和命名空间必须是名称')
 }
 return result
}
export function scopeAllows(scope, {clusterId,group='',plural,namespaced,namespace}) {
 const s=parseScope(scope)
 const has=(values,value)=>values.includes('*') || values.includes(value)
 if(!has(s.clusters,clusterId) || !has(s.resources,`${group && group!=='_core' ? group:'_core'}/${plural}`))return false
 if(!namespaced)return s.namespaces.includes('*')
 if(!namespace || ['all','_all'].includes(namespace))return s.namespaces.length>0
 return has(s.namespaces,namespace)
}
