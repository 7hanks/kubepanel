import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc'
import {computed,reactive,effectScope,nextTick} from 'vue'
import {mergeFormFields} from '../src/utils/resource-form.js'

function fixture(resource,options={}){
 const events=[],scope=effectScope(),props=reactive({modelValue:resource,creating:false,disabled:false,...options})
 const {descriptor}=parse(fs.readFileSync(new URL('../src/components/WorkloadStrategyForm.vue',import.meta.url),'utf8'))
 const source=compileScript(descriptor,{id:'workload-strategy-test'}).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const bindings={computed,mergeFormFields,KeyValueFields:{},StructuredFields:{}}
 const component=Function(...Object.keys(bindings),source)(...Object.values(bindings))
 const state=scope.run(()=>component.setup(props,{expose(){},emit:(...event)=>events.push(event)}))
 return {props,state,events,destroy:()=>scope.stop()}
}
const deployment=()=>({kind:'Deployment',spec:{replicas:3,selector:{matchLabels:{app:'web'},matchExpressions:[{key:'tier',operator:'In',values:['frontend']}]},strategy:{type:'RollingUpdate',customStrategy:'keep',rollingUpdate:{maxUnavailable:'35%',maxSurge:2,customRolling:{retain:true}}},template:{metadata:{labels:{app:'web',tier:'frontend'}},spec:{containers:[{name:'app',image:'nginx'}]}},customTop:{retain:true}}})

test('opening strategy controls leaves absent defaults and existing rollout settings untouched',async()=>{
 for(const resource of [{kind:'Deployment',spec:{}},deployment(),{kind:'CronJob',spec:{schedule:'* * * * *'}},{kind:'StatefulSet'}]){
  const before=structuredClone(resource),view=fixture(resource)
  try{
   void view.state.spec.value;void view.state.strategyType.value;void view.state.additionalFields.value
   await nextTick()
   assert.deepEqual(resource,before)
  }finally{view.destroy()}
 }
})

test('common controls preserve the selector, pod template and unknown rollout fields',()=>{
 const resource=deployment(),before=structuredClone(resource),view=fixture(resource)
 try{
  view.state.setNumber('replicas',5)
  view.state.setRollingValue('maxUnavailable',40)
  view.state.setRollingValue('maxSurge',4)
  view.state.setOptionalNumber('revisionHistoryLimit',true,10)
  view.state.setNumber('revisionHistoryLimit',6)
  assert.equal(resource.spec.replicas,5)
  assert.equal(resource.spec.strategy.rollingUpdate.maxUnavailable,'40%')
  assert.equal(resource.spec.strategy.rollingUpdate.maxSurge,4)
  assert.equal(resource.spec.revisionHistoryLimit,6)
  assert.deepEqual(resource.spec.selector,before.spec.selector)
  assert.deepEqual(resource.spec.template,before.spec.template)
  assert.deepEqual(resource.spec.customTop,{retain:true})
  assert.equal(resource.spec.strategy.customStrategy,'keep')
  assert.deepEqual(resource.spec.strategy.rollingUpdate.customRolling,{retain:true})
 }finally{view.destroy()}
})

test('strategy switches remove incompatible rolling settings only when selecting the replacement type',()=>{
 const resource=deployment(),view=fixture(resource)
 try{
  view.state.setStrategyType('RollingUpdate')
  assert.deepEqual(resource.spec.strategy.rollingUpdate,{maxUnavailable:'35%',maxSurge:2,customRolling:{retain:true}})
  view.state.setStrategyType('Recreate')
  assert.deepEqual(resource.spec.strategy,{type:'Recreate',customStrategy:'keep'})
  view.state.setStrategyType('RollingUpdate')
  assert.deepEqual(resource.spec.strategy,{type:'RollingUpdate',customStrategy:'keep'})
 }finally{view.destroy()}
})

test('rolling value and unit controls round-trip Kubernetes integer and percentage types including zero',()=>{
 const resource=deployment(),view=fixture(resource)
 try{
  assert.equal(view.state.rollingUnit('maxUnavailable'),'percent')
  assert.equal(view.state.rollingNumber('maxUnavailable'),35)
  assert.equal(view.state.rollingUnit('maxSurge'),'count')
  assert.equal(view.state.rollingNumber('maxSurge'),2)
  view.state.setRollingUnit('maxUnavailable','count')
  assert.equal(resource.spec.strategy.rollingUpdate.maxUnavailable,35)
  view.state.setRollingUnit('maxSurge','percent')
  assert.equal(resource.spec.strategy.rollingUpdate.maxSurge,'2%')
  view.state.setRollingValue('maxSurge',0)
  assert.equal(resource.spec.strategy.rollingUpdate.maxSurge,'0%')
  view.state.setRollingUnit('maxSurge','count')
  assert.equal(resource.spec.strategy.rollingUpdate.maxSurge,0)
  view.state.setRollingValue('maxSurge',undefined)
  assert.equal(resource.spec.strategy.rollingUpdate.maxSurge,0)
 }finally{view.destroy()}
})

test('optional fields retain explicit zero and are removed only by an explicit toggle',()=>{
 const resource=deployment(),view=fixture(resource)
 try{
  resource.spec.minReadySeconds=0
  view.state.setOptionalNumber('minReadySeconds',true,10)
  assert.equal(resource.spec.minReadySeconds,0)
  view.state.setNumber('minReadySeconds',undefined)
  assert.equal(resource.spec.minReadySeconds,0)
  view.state.setOptionalNumber('minReadySeconds',false,10)
  assert.equal(Object.hasOwn(resource.spec,'minReadySeconds'),false)
  view.state.toggleRollingField('maxSurge',false)
  assert.equal(Object.hasOwn(resource.spec.strategy.rollingUpdate,'maxSurge'),false)
  assert.deepEqual(resource.spec.strategy.rollingUpdate.customRolling,{retain:true})
 }finally{view.destroy()}
})

test('existing selectors cannot be changed by common or advanced strategy controls',()=>{
 const resource=deployment(),before=structuredClone(resource.spec.selector),view=fixture(resource)
 try{
  view.state.setSelectorLabels({app:'other'})
  view.state.setAdditionalFields({selector:{matchLabels:{app:'other'}},template:{},replicas:99,customTop:{retain:'updated'}})
  assert.deepEqual(resource.spec.selector,before)
  assert.equal(resource.spec.replicas,3)
  assert.equal(resource.spec.template.spec.containers[0].image,'nginx')
  assert.deepEqual(resource.spec.customTop,{retain:'updated'})
 }finally{view.destroy()}
 const created=deployment(),newView=fixture(created,{creating:true})
 try{
  newView.state.setSelectorLabels({app:'new'})
  assert.deepEqual(created.spec.selector.matchLabels,{app:'new'})
  assert.deepEqual(created.spec.selector.matchExpressions,[{key:'tier',operator:'In',values:['frontend']}])
 }finally{newView.destroy()}
})

test('other workload kinds expose their own controls and reject Deployment-only mutations',()=>{
 for(const kind of ['StatefulSet','DaemonSet','ReplicaSet','Job','CronJob']){
  const resource={kind,spec:{custom:'keep',...(kind==='CronJob'?{jobTemplate:{spec:{template:{spec:{containers:[]}},customJob:'keep'}}}:{})}},view=fixture(resource)
  try{
   const before=structuredClone(resource)
   view.state.setOptionalNumber('progressDeadlineSeconds',true,600)
   view.state.setBoolean('paused',true)
   assert.deepEqual(resource,before)
   if(['StatefulSet','DaemonSet'].includes(kind)){
    view.state.setStrategyType('OnDelete')
    assert.deepEqual(resource.spec.updateStrategy,{type:'OnDelete'})
    assert.equal(resource.spec.strategy,undefined)
    view.state.setStrategyType('Recreate')
    assert.equal(resource.spec.updateStrategy.type,'OnDelete')
   }
   if(kind==='CronJob'){
    view.state.setOptionalNumber('parallelism',true,1,'job')
    view.state.setNumber('parallelism',3,'job')
    assert.equal(resource.spec.jobTemplate.spec.parallelism,3)
    assert.equal(resource.spec.parallelism,undefined)
    assert.equal(resource.spec.jobTemplate.spec.customJob,'keep')
   }
  }finally{view.destroy()}
 }
})

test('disabled strategy form prevents helper mutations',()=>{
 const resource=deployment(),before=structuredClone(resource),view=fixture(resource,{disabled:true,creating:true})
 try{
  view.state.setNumber('replicas',8)
  view.state.setStrategyType('Recreate')
  view.state.setRollingValue('maxSurge',8)
  view.state.setRollingUnit('maxUnavailable','count')
  view.state.toggleRollingField('maxSurge',false)
  view.state.setOptionalNumber('revisionHistoryLimit',true,10)
  view.state.setSelectorLabels({app:'changed'})
  view.state.setAdditionalFields({custom:'changed'})
  assert.deepEqual(resource,before)
 }finally{view.destroy()}
})

test('the strategy form template compiles for the supported policy controls',()=>{
 const {descriptor}=parse(fs.readFileSync(new URL('../src/components/WorkloadStrategyForm.vue',import.meta.url),'utf8'))
 const result=compileTemplate({source:descriptor.template.content,filename:'WorkloadStrategyForm.vue',id:'workload-strategy-test'})
 assert.deepEqual(result.errors,[])
})

test('invalid cleared numeric controls block validation instead of silently approving the old model',()=>{
 const view=fixture(deployment())
 try{view.state.setNumber('replicas',undefined);assert.equal(view.state.spec.value.replicas,3);assert.ok(view.events.at(-1)[1]);view.state.setNumber('replicas',4);assert.deepEqual(view.events.filter(e=>e[0]==='validity').at(-1),['validity',''])}finally{view.destroy()}
})
