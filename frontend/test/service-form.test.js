import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript} from '@vue/compiler-sfc'
import {ref,computed,reactive,watch,effectScope,nextTick} from 'vue'
import {mergeFormFields} from '../src/utils/resource-form.js'

function fixture(request,permission=()=>true){
 const cleanup=[],events=[],scope=effectScope()
 const props=reactive({modelValue:{metadata:{name:'web'},spec:{selector:{old:'value'},ports:[{name:'http',port:80,targetPort:'http',appProtocol:'http',custom:'keep'}]}},namespace:'team',clusterId:'dev',section:'config',disabled:false,creating:false})
 const {descriptor}=parse(fs.readFileSync(new URL('../src/components/ServiceForm.vue',import.meta.url),'utf8'))
 const source=compileScript(descriptor,{id:'service-form-test'}).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const bindings={ref,computed,watch,onUnmounted:fn=>cleanup.push(fn),api:{list:request},canResource:permission,mergeFormFields,KeyValueFields:{},StructuredFields:{},Plus:{},Delete:{},Refresh:{},Connection:{},Aim:{},Operation:{},Switch:{},Right:{},CircleCheckFilled:{}}
 const component=Function(...Object.keys(bindings),source)(...Object.values(bindings))
 const state=scope.run(()=>component.setup(props,{expose(){},emit:(...event)=>events.push(event)}))
 return {props,state,events,destroy(){cleanup.forEach(fn=>fn());scope.stop()}}
}
const pod={metadata:{name:'api',namespace:'team',uid:'pod-1',labels:{app:'api',tier:'web'}}}
test('Pod selector import reads the bound namespace/cluster and changes only the draft selector',async()=>{
 const calls=[],view=fixture(async(...args)=>{calls.push(args);return {items:[pod]}})
 try{
  await view.state.loadPods()
  assert.deepEqual(calls[0].slice(0,4),['','v1','pods',{namespace:'team',clusterId:'dev',limit:200}])
  assert.deepEqual(view.props.modelValue.spec.selector,{old:'value'})
  view.state.selectedPod.value='pod-1';view.state.importPodLabels()
  assert.deepEqual(view.props.modelValue.spec.selector,{app:'api',tier:'web'})
  assert.equal(view.props.modelValue.spec.ports[0].custom,'keep')
  view.props.modelValue.spec.selector.app='changed';assert.equal(pod.metadata.labels.app,'api')
  assert.ok(view.events.some(([name])=>name==='change'))
 }finally{view.destroy()}
})
test('late Pod lists cannot cross namespaces and missing list permission prevents reads',async()=>{
 let finish;const view=fixture(()=>new Promise(resolve=>finish=resolve))
 try{const loading=view.state.loadPods();view.props.namespace='other';await nextTick();finish({items:[pod]});await loading
  assert.equal(view.state.pods.value.length,0);view.state.selectedPod.value='pod-1';view.state.importPodLabels();assert.deepEqual(view.props.modelValue.spec.selector,{old:'value'})
 }finally{view.destroy()}
 let reads=0;const denied=fixture(async()=>{reads++;return {items:[pod]}},()=>false)
 try{await denied.state.loadPods();assert.equal(reads,0)}finally{denied.destroy()}
})
test('compact Service port controls preserve unknown settings and remove blank optional fields',()=>{
 const view=fixture(async()=>({items:[]}))
 try{const port=view.props.modelValue.spec.ports[0]
  view.state.setTargetPort(port,'8080-http');view.state.setAppProtocol(port,'kubernetes.io/h2c');assert.equal(port.custom,'keep')
  view.state.setAppProtocol(port,'');assert.equal(port.appProtocol,undefined)
  view.state.addPort();assert.equal(view.props.modelValue.spec.ports.length,2);view.state.removePort(1);assert.equal(port.targetPort,'8080-http')
 }finally{view.destroy()}
})
