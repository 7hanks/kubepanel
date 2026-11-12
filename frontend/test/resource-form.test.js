import test from 'node:test'
import assert from 'node:assert/strict'
const form = await import('../src/utils/resource-form.js').catch(()=>({}))
const meta = (kind,group='',plural=kind.toLowerCase()+'s')=>({kind,group,plural,version:'v1',namespaced:kind!=='Namespace'})
test('workload creation produces the correct pod template and matching labels for each kind',()=>{
 for(const kind of ['Pod','Deployment','StatefulSet','DaemonSet','ReplicaSet','Job','CronJob']){
  const m=meta(kind,['Job','CronJob'].includes(kind)?'batch':kind==='Pod'?'':'apps')
  const draft=form.newResourceDraft(m,'team')
  draft.metadata.name='web'
  const pod=form.podSpec(draft)
  assert.equal(pod.containers.length,1)
  pod.containers[0].image='nginx:1.25'
  if(kind==='StatefulSet')draft.spec.serviceName='web'
  const body=form.resourceBody(draft,{meta:m,creating:true})
  assert.equal(body.metadata.namespace,'team')
  assert.equal(body.apiVersion,m.group?m.group+'/v1':'v1')
  if(['Deployment','StatefulSet','DaemonSet','ReplicaSet'].includes(kind))assert.equal(body.spec.selector.matchLabels.app,form.podTemplate(body).metadata.labels.app)
  if(['Job','CronJob'].includes(kind))assert.equal(form.podSpec(body).restartPolicy,'OnFailure')
 }
})
test('form changes preserve unknown settings, resource identity and optimistic locking',()=>{
 const m=meta('Deployment','apps')
 const original={apiVersion:'apps/v1',kind:'Deployment',metadata:{name:'web',namespace:'team',uid:'u1',resourceVersion:'18',annotations:{custom:'keep'}},spec:{selector:{matchLabels:{app:'custom'}},strategy:{type:'RollingUpdate',rollingUpdate:{maxSurge:'40%'}},template:{metadata:{labels:{app:'custom'}},spec:{containers:[{name:'app',image:'old',livenessProbe:{httpGet:{path:'/health',port:80}},securityContext:{runAsNonRoot:true}}],volumes:[{name:'config',configMap:{name:'settings'}}],affinity:{nodeAffinity:{custom:'kept'}}}}},status:{availableReplicas:1}}
 const draft=structuredClone(original);form.podSpec(draft).containers[0].image='new'
 const body=form.resourceBody(draft,{meta:m,creating:false,original})
 assert.equal(body.spec.template.spec.containers[0].image,'new')
 assert.deepEqual(body.spec.template.spec.containers[0].livenessProbe,original.spec.template.spec.containers[0].livenessProbe)
 assert.deepEqual(body.spec.template.spec.volumes,original.spec.template.spec.volumes)
 assert.equal(body.metadata.resourceVersion,'18');assert.equal(body.metadata.uid,'u1')
 assert.equal(body.status,undefined);assert.equal(original.spec.template.spec.containers[0].image,'old')
 draft.metadata.name='other';assert.throws(()=>form.resourceBody(draft,{meta:m,creating:false,original}),/名称|身份/)
})
test('ConfigMap values stay strings and binary data survives unrelated changes',()=>{
 const m=meta('ConfigMap'),draft=form.newResourceDraft(m,'team')
 draft.metadata.name='settings';draft.data={'app.conf':'a=1\nb=2\n',number:'123'};draft.binaryData={image:'AAEC'}
 const body=form.resourceBody(draft,{meta:m,creating:true})
 assert.equal(body.data.number,'123');assert.equal(body.data['app.conf'],'a=1\nb=2\n');assert.equal(body.binaryData.image,'AAEC')
})
test('key/value rows reject duplicates instead of silently discarding an entry',()=>{
 assert.throws(()=>form.rowsToMap([{key:'same',value:'1'},{key:'same',value:'2'}]),/重复/)
 assert.throws(()=>form.rowsToMap([{key:'',value:'data'}]),/名称|键/)
 assert.deepEqual(form.rowsToMap([{key:'a',value:'line1\nline2'}]),{a:'line1\nline2'})
})
test('YAML import validates identity and retains the original server resource version',()=>{
 const m=meta('ConfigMap'),original={apiVersion:'v1',kind:'ConfigMap',metadata:{name:'settings',namespace:'team',resourceVersion:'18',uid:'u1'},data:{key:'old'}}
 const parsed=form.parseResourceYaml('apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\n  namespace: team\ndata:\n  key: new\n',{meta:m,creating:false,original})
 assert.equal(parsed.metadata.resourceVersion,'18');assert.equal(parsed.metadata.uid,'u1')
 assert.throws(()=>form.parseResourceYaml('apiVersion: v1\nkind: Secret\nmetadata:\n  name: settings',{meta:m,creating:false,original}),/类型|kind|apiVersion/)
})
test('advanced fields cannot replace settings owned by dedicated form controls',()=>{
 const source={name:'app',resources:{requests:{cpu:'500m'},limits:{memory:'1Gi'}},livenessProbe:{httpGet:{path:'/health',port:80}}}
 const merged=form.mergeFormFields(source,['name','resources'],{resources:{},name:'wrong',livenessProbe:{httpGet:{path:'/ready',port:80}}})
 assert.deepEqual(merged.resources,source.resources);assert.equal(merged.name,'app');assert.equal(merged.livenessProbe.httpGet.path,'/ready')
 const root={kind:'Deployment',metadata:{name:'original'},spec:{template:{spec:{containers:[{name:'app',image:'image'}]}}}}
 assert.deepEqual(form.mergeFormFields(root,['kind','metadata','spec'],{spec:{},metadata:{name:'wrong'}}),root)
})
