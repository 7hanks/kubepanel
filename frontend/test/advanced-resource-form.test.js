import test from 'node:test'
import assert from 'node:assert/strict'
import {ADVANCED_FORM_KINDS,isAdvancedFormResource,advancedDraftFields,validateAdvancedResource} from '../src/utils/advanced-resource-form.js'

const draft=(kind)=>({apiVersion:kind==='HorizontalPodAutoscaler'?'autoscaling/v2':kind==='EndpointSlice'?'discovery.k8s.io/v1':'v1',kind,metadata:{name:'test',namespace:'team'},...advancedDraftFields(kind,'team')})
test('advanced forms recognize only the supported Kubernetes API groups and versions',()=>{
 for(const [kind,group,version] of [['HorizontalPodAutoscaler','autoscaling','v2'],['EndpointSlice','discovery.k8s.io','v1'],['Endpoints','','v1'],['ResourceQuota','','v1'],['LimitRange','','v1']]){
  assert.ok(ADVANCED_FORM_KINDS.includes(kind));assert.equal(isAdvancedFormResource({kind,group,version}),true)
  assert.equal(isAdvancedFormResource({kind,group:'custom.example',version}),false)
 }
 assert.equal(isAdvancedFormResource({kind:'HorizontalPodAutoscaler',group:'autoscaling',version:'v1'}),false)
})
test('new advanced drafts are independent and leave required workload, Service and endpoint references blank',()=>{
 const hpa=draft('HorizontalPodAutoscaler'),slice=draft('EndpointSlice'),endpoints=draft('Endpoints')
 assert.equal(hpa.spec.scaleTargetRef.name,'');assert.equal(slice.metadata.labels['kubernetes.io/service-name'],'')
 assert.equal(slice.endpoints[0].addresses[0],'');assert.equal(endpoints.subsets[0].addresses[0].ip,'')
 hpa.spec.metrics[0].resource.target.averageUtilization=99
 assert.equal(draft('HorizontalPodAutoscaler').spec.metrics[0].resource.target.averageUtilization,80)
})
test('HPA validates target references, replica bounds and CPU/memory target quantities without changing unknown fields',()=>{
 const body=draft('HorizontalPodAutoscaler');body.spec.scaleTargetRef.name='api'
 body.spec.metrics.push({type:'Resource',resource:{name:'memory',target:{type:'AverageValue',averageValue:'256Mi'}}},{type:'External',external:{metric:{name:'queue'},target:{type:'AverageValue',averageValue:'10'}}})
 body.spec.behavior={scaleDown:{stabilizationWindowSeconds:90}};body.spec.custom={keep:true}
 const before=JSON.stringify(body);assert.doesNotThrow(()=>validateAdvancedResource(body,{creating:true}));assert.equal(JSON.stringify(body),before)
 for(const [patch,error] of [
  [resource=>resource.spec.scaleTargetRef.name='',/目标.*名称/],
  [resource=>resource.spec.maxReplicas=0,/最大副本/],
  [resource=>resource.spec.minReplicas=5,/最小副本/],
  [resource=>resource.spec.metrics[0].resource.target.averageUtilization=0,/利用率/],
  [resource=>resource.spec.metrics[1].resource.target.averageValue='bad',/平均值/],
 ]){const broken=JSON.parse(before);patch(broken);assert.throws(()=>validateAdvancedResource(broken,{creating:true}),error)}
})
test('HPA zero minimum requires an Object or External metric',()=>{
 const body=draft('HorizontalPodAutoscaler');body.spec.scaleTargetRef.name='api';body.spec.minReplicas=0
 assert.throws(()=>validateAdvancedResource(body,{creating:true}),/0.*Object|External/)
 body.spec.metrics.push({type:'External',external:{metric:{name:'queue'},target:{type:'AverageValue',averageValue:'10'}}})
 assert.doesNotThrow(()=>validateAdvancedResource(body,{creating:true}))
})
test('quota quantities and conflicting scopes are validated while selectors remain untouched',()=>{
 const body=draft('ResourceQuota');body.spec.hard={'requests.cpu':'2',pods:'0'};body.spec.scopeSelector={matchExpressions:[{scopeName:'PriorityClass',operator:'In',values:['critical']}]}
 assert.doesNotThrow(()=>validateAdvancedResource(body,{creating:true}))
 body.spec.hard.pods='-1';assert.throws(()=>validateAdvancedResource(body,{creating:true}),/配额.*数量/)
 body.spec.hard.pods='10';body.spec.scopes=['BestEffort','NotBestEffort'];assert.throws(()=>validateAdvancedResource(body,{creating:true}),/范围.*冲突/)
})
test('LimitRange validates dynamic resource constraints and preserves extended resource maps',()=>{
 const body=draft('LimitRange');body.spec.limits=[{type:'Container',min:{cpu:'100m'},max:{cpu:'2'},default:{cpu:'1'},defaultRequest:{cpu:'500m'},maxLimitRequestRatio:{cpu:'4'},custom:'keep'}]
 assert.doesNotThrow(()=>validateAdvancedResource(body,{creating:true}))
 body.spec.limits[0].min.cpu='3';assert.throws(()=>validateAdvancedResource(body,{creating:true}),/最小.*最大/)
 body.spec.limits[0].min.cpu='100m';body.spec.limits[0].defaultRequest.cpu='2';assert.throws(()=>validateAdvancedResource(body,{creating:true}),/默认请求.*默认限制/)
})
test('LimitRange permits qualified custom types and checks Pod defaults and PVC storage bounds',()=>{
 const body=draft('LimitRange');body.spec.limits=[{type:'example.com/Custom',max:{'example.com/device':'4'}}]
 assert.doesNotThrow(()=>validateAdvancedResource(body,{creating:true}))
 body.spec.limits=[{type:'Pod',default:{cpu:'1'}}];assert.throws(()=>validateAdvancedResource(body,{creating:true}),/Pod.*默认/)
 body.spec.limits=[{type:'PersistentVolumeClaim',max:{}}];assert.throws(()=>validateAdvancedResource(body,{creating:true}),/存储.*最小|最大/)
 body.spec.limits[0].max.storage='10Gi';assert.doesNotThrow(()=>validateAdvancedResource(body,{creating:true}))
})
test('Endpoints validates each ready/unready IP and port without stripping targetRef or unknown fields',()=>{
 const body=draft('Endpoints');body.subsets[0].addresses=[{ip:'192.0.2.10',targetRef:{kind:'Pod',name:'api'},custom:'keep'}];body.subsets[0].notReadyAddresses=[{ip:'2001:db8::10'}];body.subsets[0].ports=[{port:8080,protocol:'TCP'}]
 const before=JSON.stringify(body);assert.doesNotThrow(()=>validateAdvancedResource(body,{creating:true}));assert.equal(JSON.stringify(body),before)
 body.subsets[0].notReadyAddresses[0].ip='not-an-ip';assert.throws(()=>validateAdvancedResource(body,{creating:true}),/端点.*IP/)
 body.subsets[0].notReadyAddresses=[];body.subsets[0].ports[0].port=70000;assert.throws(()=>validateAdvancedResource(body,{creating:true}),/端口/)
})
test('EndpointSlice enforces service label, address family, readiness and immutable address type',()=>{
 const body=draft('EndpointSlice');body.metadata.labels['kubernetes.io/service-name']='api';body.endpoints[0].addresses=['192.0.2.10'];body.ports=[{port:8080,protocol:'TCP',name:''}]
 assert.doesNotThrow(()=>validateAdvancedResource(body,{creating:true}))
 const original=JSON.parse(JSON.stringify(body));body.addressType='IPv6';body.endpoints[0].addresses=['2001:db8::10']
 assert.throws(()=>validateAdvancedResource(body,{original}),/地址类型.*不可修改/)
 assert.doesNotThrow(()=>validateAdvancedResource(body,{creating:true}))
 body.endpoints[0].addresses=['192.0.2.10'];assert.throws(()=>validateAdvancedResource(body,{creating:true}),/IPv6/)
 body.endpoints[0].addresses=['2001:db8::10'];body.endpoints[0].conditions.ready='yes';assert.throws(()=>validateAdvancedResource(body,{creating:true}),/就绪/)
})
