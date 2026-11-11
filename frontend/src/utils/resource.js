export function matchesSelector(labels = {}, selector = {}) {
  const structured = 'matchLabels' in selector || 'matchExpressions' in selector
  const exact = structured ? selector.matchLabels || {} : selector
  const expressions = structured ? selector.matchExpressions || [] : []
  if (!Object.keys(exact).length && !expressions.length) return false
  return Object.entries(exact).every(([k,v]) => labels[k] === v) && expressions.every(e => {
    const exists = Object.hasOwn(labels,e.key)
    if (e.operator === 'In') return exists && (e.values || []).includes(labels[e.key])
    if (e.operator === 'NotIn') return !exists || !(e.values || []).includes(labels[e.key])
    if (e.operator === 'Exists') return exists
    if (e.operator === 'DoesNotExist') return !exists
    return false
  })
}
export function relatedPods(resource, pods, intermediates = []) {
  const selector = resource.spec?.selector || {}
  const candidates = pods.filter(p => matchesSelector(p.metadata?.labels,selector))
  if (resource.kind === 'Service') return candidates
  const uid = resource.metadata?.uid
  if (!uid) return []
  const owners = new Set([uid])
  for (const r of intermediates) if ((r.metadata?.ownerReferences || []).some(o=>o.uid === uid && o.controller !== false)) owners.add(r.metadata?.uid)
  return candidates.filter(p => (p.metadata?.ownerReferences || []).some(o=>owners.has(o.uid) && o.controller !== false))
}
export function isAbnormal(status='') {
  return !['Running','Ready','Active','Bound','Succeeded','Completed','ScaledToZero','Suspended','Available','Normal','ClusterIP','NodePort','LoadBalancer','ExternalName'].includes(status)
}
export function filterRows(rows, f={}) {
 const includes=(v,q)=>!q || String(v || '').toLowerCase().includes(String(q).toLowerCase())
 return rows.filter(r => {
   const spec=r._raw?.spec || {}
   const podSpec=spec.template?.spec || spec.jobTemplate?.spec?.template?.spec || spec
   const images=[r.images, ...(podSpec.containers || []).map(c=>c.image), ...(podSpec.initContainers || []).map(c=>c.image)].filter(Boolean).join(' ')
   const ready=(r._raw?.status?.conditions || []).some(c=>c.type==='Ready' && c.status==='True')
   return includes(`${r.name} ${r.namespace}`,f.keyword)
     && (!f.phase || r._raw?.status?.phase===f.phase)
     && (!f.state || (f.state==='abnormal' ? isAbnormal(r.status) : f.state==='active-abnormal' ? isAbnormal(r.status) && !['Failed','Succeeded'].includes(r._raw?.status?.phase) && !r._raw?.metadata?.deletionTimestamp : r.status===f.state))
     && includes(r.reason,f.reason) && (!f.node || r.node===f.node)
     && includes(r.owner,f.owner) && Number(r.restarts || 0)>=Number(f.minRestarts || 0)
     && includes(images,f.image) && (!f.ready || (f.ready==='ready' ? ready : !ready))
 })
}
export function sortRows(rows,key,order) {
 if (!key || !order) return rows
 const actual=key==='age' ? 'createdAt' : key
 const direction=order==='descending' ? -1 : 1
 return [...rows].sort((a,b)=>direction*(typeof a[actual]==='number' && typeof b[actual]==='number' ? a[actual]-b[actual] : String(a[actual] ?? '').localeCompare(String(b[actual] ?? ''),undefined,{numeric:true})))
}
export function assertApplySuccess(data) {
 const results=data?.results
 if (!Array.isArray(results) || !results.length) throw new Error('服务端未返回逐项执行结果；请刷新确认资源状态')
 const failed=results.filter(r=>r.ok!==true)
 if (failed.length) throw new Error(failed.map(r=>`${r.name || '资源'}: ${r.message || '执行失败'}`).join('\n'))
 return results
}
export function createRequestGate() {
 let id=0
 return {next:()=>++id,current:value=>value===id,invalidate:()=>++id}
}
export function targetDescription(cluster, namespace, kind, name) { return `集群 ${cluster} · ${namespace || '集群级'} · ${kind}/${name || '(新建)'}` }
