import test from 'node:test'
import assert from 'node:assert/strict'
import {loadAll} from 'js-yaml'
import {newGeneratorDraft,buildGeneratedResources,generateResourceYaml,generatorContainerPorts} from '../src/utils/yaml-generator.js'

function workload(kind='Deployment'){
 const draft=newGeneratorDraft(kind,'team');draft.name='web';draft.containers[0].image='nginx:1.27'
 draft.containers[0].ports=[{id:'http',name:'http',containerPort:8080,protocol:'TCP'}]
 return draft
}
test('all workload generators use the correct pod template, restart policy and namespace',()=>{
 for(const kind of ['Deployment','StatefulSet','DaemonSet','Pod','Job','CronJob']){
  const draft=workload(kind),body=buildGeneratedResources(draft)[0]
  assert.equal(body.kind,kind);assert.equal(body.metadata.namespace,'team')
  const template=kind==='Pod'?body:kind==='CronJob'?body.spec.jobTemplate.spec.template:body.spec.template
  assert.equal(template.spec.containers[0].image,'nginx:1.27')
  assert.equal(template.spec.restartPolicy,['Job','CronJob'].includes(kind)?'OnFailure':'Always')
  if(['Deployment','StatefulSet','DaemonSet'].includes(kind))assert.deepEqual(body.spec.selector.matchLabels,template.metadata.labels)
  if(kind==='CronJob')assert.equal(body.spec.schedule,'0 * * * *')
 }
})
test('optional Service and Ingress share workload selectors and target the chosen container port',()=>{
 const draft=workload();draft.service.enabled=true;draft.service.type='NodePort';draft.service.ports[0].nodePort=32080
 draft.service.ports[0].target=generatorContainerPorts(draft)[0].key
 draft.ingress.enabled=true;draft.ingress.host='web.example.test';draft.ingress.tlsSecret='web-tls'
 const [deployment,service,ingress]=buildGeneratedResources(draft)
 assert.deepEqual(service.spec.selector,deployment.spec.selector.matchLabels)
 assert.equal(service.spec.ports[0].targetPort,8080);assert.equal(service.spec.ports[0].nodePort,32080)
 assert.deepEqual(ingress.spec.rules[0].http.paths[0].backend.service,{name:'web',port:{number:80}})
 assert.deepEqual(ingress.spec.tls,[{hosts:['web.example.test'],secretName:'web-tls'}])
 assert.equal(loadAll(generateResourceYaml(draft)).length,3)
})
test('StatefulSet gets its own headless governing Service without conflicting with optional Service',()=>{
 const draft=workload('StatefulSet');draft.service.enabled=true
 const [stateful,headless,service]=buildGeneratedResources(draft)
 assert.equal(stateful.spec.serviceName,'web-headless');assert.equal(headless.metadata.name,'web-headless')
 assert.equal(headless.spec.clusterIP,'None');assert.deepEqual(headless.spec.selector,stateful.spec.selector.matchLabels)
 assert.equal(service.metadata.name,'web')
})
test('repeatable containers, env, host ports, node selection and volume mounts generate real pod fields',()=>{
 const draft=workload('Pod');draft.nodeName='worker-a';draft.containers[0].env=[{name:'MODE',value:'true'}];draft.containers[0].ports[0].hostPort=18080
 draft.volumes=[{name:'config',type:'configMap',source:'web-config'},{name:'cache',type:'emptyDir',source:''}]
 draft.containers[0].mounts=[{name:'config',mountPath:'/etc/web',readOnly:true}]
 draft.containers.push({id:'sidecar',name:'sidecar',image:'busybox:1.37',ports:[],env:[],mounts:[]})
 const before=JSON.stringify(draft),body=buildGeneratedResources(draft)[0]
 assert.equal(body.spec.nodeName,'worker-a');assert.equal(body.spec.containers[0].ports[0].hostPort,18080)
 assert.deepEqual(body.spec.containers[0].env,[{name:'MODE',value:'true'}]);assert.deepEqual(body.spec.volumes[0],{name:'config',configMap:{name:'web-config'}})
 assert.equal(body.spec.containers[0].volumeMounts[0].mountPath,'/etc/web');assert.equal(body.spec.containers.length,2)
 assert.equal(JSON.stringify(draft),before)
})
test('standalone data resources preserve string literals and Namespace omits namespace',()=>{
 for(const kind of ['ConfigMap','Secret']){
  const draft=newGeneratorDraft(kind,'team');draft.name='settings';draft.data=[{key:'enabled',value:'true'},{key:'multiline',value:'first\nsecond'}]
  const body=loadAll(generateResourceYaml(draft))[0]
  assert.equal((body.data||body.stringData).enabled,'true');assert.equal((body.data||body.stringData).multiline,'first\nsecond')
  if(kind==='Secret')assert.equal(body.type,'Opaque')
 }
 const namespace=newGeneratorDraft('Namespace','team');namespace.name='sandbox'
 assert.equal(buildGeneratedResources(namespace)[0].metadata.namespace,undefined)
})
test('standalone Service supports selectors and numeric or named target ports',()=>{
 const draft=newGeneratorDraft('Service','team');draft.name='web';draft.serviceSelector=[{key:'app',value:'web'}]
 draft.service.ports[0].targetPort='http';const service=buildGeneratedResources(draft)[0]
 assert.deepEqual(service.spec.selector,{app:'web'});assert.equal(service.spec.ports[0].targetPort,'http')
})
test('generator rejects dangling references, invalid ports and duplicate fields before export',()=>{
 for(const [change,error] of [
  [draft=>draft.containers[0].image='',/镜像/],
  [draft=>draft.containers[0].ports[0].containerPort=70000,/端口/],
  [draft=>draft.containers[0].mounts=[{name:'missing',mountPath:'/data'}],/存储卷/],
  [draft=>draft.containers[0].env=[{name:'A',value:'1'},{name:'A',value:'2'}],/环境变量/],
  [draft=>{draft.service.enabled=true;draft.service.ports[0].target='removed/port'},/目标端口/],
 ]){const draft=workload();change(draft);assert.throws(()=>generateResourceYaml(draft),error)}
})
test('blank drafts contain no example image, IP or target resource and preview stays local and parseable',()=>{
 const first=newGeneratorDraft('Deployment','team'),second=newGeneratorDraft('Deployment','team')
 assert.equal(first.name,'');assert.equal(first.containers[0].image,'');first.containers[0].name='changed';assert.equal(second.containers[0].name,'app')
 assert.doesNotThrow(()=>loadAll(generateResourceYaml(second,{validate:false})))
})
test('namespace and Service names reject dotted labels and standalone selectors validate label syntax',()=>{
 const namespace=newGeneratorDraft('Namespace');namespace.name='team.example';assert.throws(()=>generateResourceYaml(namespace),/名称/)
 const service=newGeneratorDraft('Service');service.name='web.example';assert.throws(()=>generateResourceYaml(service),/名称/)
 service.name='web';service.serviceSelector=[{key:'bad key',value:'web'}];assert.throws(()=>generateResourceYaml(service),/选择器/)
 const deployment=workload();deployment.namespace='team.example';assert.throws(()=>generateResourceYaml(deployment),/命名空间/)
})
