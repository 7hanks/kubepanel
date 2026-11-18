import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript} from '@vue/compiler-sfc'
import {computed,ref,reactive,watch,effectScope,nextTick} from 'vue'
import {advancedDraftFields,validateAdvancedResource} from '../src/utils/advanced-resource-form.js'

function fixture(body,creating=false,disabled=false,options={}){
 const scope=effectScope(),events=[],props=reactive({modelValue:body,creating,disabled,clusterId:'c-a',active:true,...options.props})
 const {descriptor}=parse(fs.readFileSync(new URL('../src/components/AdvancedResourceForm.vue',import.meta.url),'utf8'))
 const source=compileScript(descriptor,{id:'advanced-test'}).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const bindings={computed,ref,watch,validateAdvancedResource,KeyValueFields:{},Plus:{},Delete:{},
  api:options.api||{list:async()=>({items:[]})},store:options.store||{discovery:[]},
  canResource:options.canResource||(()=>true)}
 const component=Function(...Object.keys(bindings),source)(...Object.values(bindings))
 const state=scope.run(()=>component.setup(props,{expose(){},emit:(...event)=>events.push(event)}))
 return {state,props,events,destroy(){scope.stop()}}
}
const hpa=()=>({apiVersion:'autoscaling/v2',kind:'HorizontalPodAutoscaler',metadata:{name:'autoscale'},...advancedDraftFields('HorizontalPodAutoscaler')})
const workload=(name,namespace)=>({metadata:{name,namespace}})
const flush=()=>new Promise(resolve=>setImmediate(resolve))

test('HPA target options load paged workload names scoped to the selected cluster and namespace', async()=>{
 const body=hpa()
 body.metadata.namespace='team'
 const requests=[]
 const view=fixture(body,true,false,{api:{list:async(group,version,plural,params)=>{
  requests.push([group,version,plural,params])
  return params.continue
   ? {items:[workload('api','team'),workload('foreign','outside')]}
   : {items:[workload('worker','team')],metadata:{continue:'page-2'}}
 }}})
 try {
  await flush()
  assert.deepEqual(view.state.targetNames.value,['api','worker'])
  assert.deepEqual(requests.map(([group,version,plural,params])=>[group,version,plural,params.clusterId,params.namespace,params.continue]),[
   ['apps','v1','deployments','c-a','team',undefined],
   ['apps','v1','deployments','c-a','team','page-2'],
  ])
  assert.equal(body.spec.scaleTargetRef.name,'')
 }finally{view.destroy()}
})

test('a stale target lookup cannot override a new namespace or type and the old name is cleared', async()=>{
 const body=hpa()
 body.metadata.namespace='team'
 body.spec.scaleTargetRef.name='previous'
 const requests=[]
 const view=fixture(body,true,false,{api:{list:(group,version,plural,params,{signal})=>new Promise(resolve=>requests.push({plural,params,signal,resolve}))}})
 try{
  await flush()
  view.props.modelValue.metadata.namespace='prod'
  view.state.setTargetKind('StatefulSet')
  await flush()
  assert.equal(body.spec.scaleTargetRef.name,'')
  assert.equal(requests[0].signal.aborted,true)
  assert.equal(requests[1].plural,'statefulsets')
  assert.equal(requests[1].params.namespace,'prod')
  requests[1].resolve({items:[workload('cache','prod')]})
  requests[0].resolve({items:[workload('previous','team')]})
  await flush()
  assert.deepEqual(view.state.targetNames.value,['cache'])
 }finally{view.destroy()}
})

test('HPA target list reuses cluster discovery and skips unauthorized or all-namespace requests', async()=>{
 const body=hpa()
 body.metadata.namespace='all'
 body.spec.scaleTargetRef={kind:'Scalable',apiVersion:'example.org/v1',name:'existing'}
 const meta={kind:'Scalable',group:'example.org',version:'v1',plural:'scalables',namespaced:true,verbs:['list']}
 const scope=ref(false)
 const requests=[]
 const view=fixture(body,false,false,{
  canResource:()=>scope.value,store:{discovery:[meta]},
  api:{list:async(group,version,plural,params)=>{requests.push([group,version,plural,params.namespace]);return {items:[]}}},
 })
 try{
  await flush()
  assert.equal(requests.length,0)
  view.props.modelValue.metadata.namespace='team'
  await flush()
  assert.equal(requests.length,0)
  scope.value=true
  await flush()
  assert.deepEqual(requests,[['example.org','v1','scalables','team']])
  assert.equal(body.spec.scaleTargetRef.name,'existing')
 }finally{view.destroy()}
})
test('HPA plain controls preserve custom metrics and behavior while editing CPU/memory targets',()=>{
 const body=hpa();body.spec.scaleTargetRef.custom='keep';body.spec.behavior={scaleDown:{stabilizationWindowSeconds:120}}
 const custom={type:'External',external:{metric:{name:'queue'},target:{type:'AverageValue',averageValue:'5'}}};body.spec.metrics.unshift(custom)
 body.spec.metrics[1].resource.target.custom='keep'
 const view=fixture(body)
 try{
  view.state.setTargetRef('name','api');view.state.setMetricTargetType(body.spec.metrics[1],'AverageValue');view.state.setMetricValue(body.spec.metrics[1],'200m')
  assert.equal(body.spec.scaleTargetRef.name,'api');assert.equal(body.spec.scaleTargetRef.custom,'keep')
  assert.deepEqual(body.spec.metrics[0],custom);assert.equal(body.spec.metrics[1].resource.target.averageUtilization,undefined)
  assert.equal(body.spec.metrics[1].resource.target.averageValue,'200m');assert.equal(body.spec.metrics[1].resource.target.custom,'keep')
  view.state.addMetric('memory');assert.equal(body.spec.metrics[2].resource.name,'memory')
  view.state.removeMetric(2);assert.equal(body.spec.metrics.length,2);assert.equal(body.spec.behavior.scaleDown.stabilizationWindowSeconds,120)
 }finally{view.destroy()}
})
test('quota and LimitRange field updates preserve unrelated selectors and extension fields',()=>{
 const quota={apiVersion:'v1',kind:'ResourceQuota',spec:{hard:{pods:'10'},scopeSelector:{custom:'keep'}}},view=fixture(quota)
 try{view.state.setQuotaHard({'requests.cpu':'2'});view.state.setQuotaScopes(['NotBestEffort']);assert.deepEqual(quota.spec.scopeSelector,{custom:'keep'});assert.deepEqual(quota.spec.hard,{'requests.cpu':'2'})}finally{view.destroy()}
 const limits={apiVersion:'v1',kind:'LimitRange',spec:{limits:[{type:'Container',default:{cpu:'1'},custom:'keep'}],unknown:'keep'}},form=fixture(limits)
 try{form.state.setLimitMap(limits.spec.limits[0],'min',{cpu:'100m'});form.state.addLimit();form.state.removeLimit(1);assert.equal(limits.spec.limits[0].custom,'keep');assert.equal(limits.spec.unknown,'keep')}finally{form.destroy()}
})
test('switching LimitRange to Pod removes incompatible defaults and deleting a row retains other local errors',async()=>{
 const body={apiVersion:'v1',kind:'LimitRange',spec:{limits:[{type:'Container',default:{cpu:'1'},defaultRequest:{cpu:'100m'},custom:'keep'},{type:'Pod',max:{cpu:'2'}}]}},view=fixture(body)
 try{
  const first=body.spec.limits[0],second=body.spec.limits[1]
  view.state.setLimitType(first,'Pod');assert.equal(first.default,undefined);assert.equal(first.defaultRequest,undefined);assert.equal(first.custom,'keep')
  view.state.setChildValidity(`limit-${view.state.addressKey(second)}-max`,'键名称重复')
  view.state.removeLimit(0);await nextTick()
  assert.ok(view.events.some(([name,value])=>name==='validity'&&value==='键名称重复'))
  assert.equal(view.state.validity.value,'键名称重复')
 }finally{view.destroy()}
})
test('Endpoints readiness changes move the same address object without losing target references',()=>{
 const address={ip:'192.0.2.10',targetRef:{kind:'Pod',name:'api'},hostname:'api'}
 const body={apiVersion:'v1',kind:'Endpoints',subsets:[{addresses:[address],ports:[{port:8080}]}]},view=fixture(body)
 try{view.state.setEndpointReady(body.subsets[0],address,false);assert.equal(body.subsets[0].addresses.length,0);assert.equal(body.subsets[0].notReadyAddresses[0],address);assert.deepEqual(address.targetRef,{kind:'Pod',name:'api'})}finally{view.destroy()}
})
test('EndpointSlice controls preserve endpoint conditions and enforce immutable address type in edit mode',()=>{
 const body={apiVersion:'discovery.k8s.io/v1',kind:'EndpointSlice',...advancedDraftFields('EndpointSlice','team')};body.endpoints[0].conditions.serving=true;body.endpoints[0].targetRef={kind:'Pod',name:'api'}
 const view=fixture(body)
 try{view.state.setAddressType('IPv6');assert.equal(body.addressType,'IPv4');view.state.setSliceReady(body.endpoints[0],false);assert.equal(body.endpoints[0].conditions.serving,true);assert.deepEqual(body.endpoints[0].targetRef,{kind:'Pod',name:'api'});view.state.setServiceName('api');assert.equal(body.metadata.labels['endpointslice.kubernetes.io/managed-by'],'kubepanel.example.com/manual')}finally{view.destroy()}
})
test('invalid local key-value edits emit validity and disabled forms refuse mutation handlers',async()=>{
 const body=hpa(),view=fixture(body)
 try{view.state.setChildValidity('hard','键名称重复');await nextTick();assert.ok(view.events.some(([name,value])=>name==='validity'&&value==='键名称重复'))}finally{view.destroy()}
 const disabled=fixture(body,true,true),before=JSON.stringify(body)
 try{disabled.state.setTargetRef('name','changed');disabled.state.addMetric('memory');disabled.state.removeMetric(0);assert.equal(JSON.stringify(body),before);assert.equal(disabled.events.some(([name])=>name==='change'),false)}finally{disabled.destroy()}
})
