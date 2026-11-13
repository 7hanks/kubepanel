import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript} from '@vue/compiler-sfc'
import * as Vue from 'vue'
import {podSpec,mergeFormFields,rowsToMap} from '../src/utils/resource-form.js'

function component(name,bindings={}){
 const {descriptor}=parse(fs.readFileSync(new URL(`../src/components/${name}.vue`,import.meta.url),'utf8'))
 const source=compileScript(descriptor,{id:`test-${name}`,inlineTemplate:true}).content
  .replace(/^import\s*\{([^}]+)\}\s*from\s*['"]vue['"][ \t]*;?/gm,(_,items)=>`const {${items.replace(/\s+as\s+/g,':')}}=Vue;`)
  .replace(/^import[^\n]+$/gm,'')
  .replace('export default','return')
 return Function('Vue',...Object.keys(bindings),source)(Vue,...Object.values(bindings))
}
function fixture(kind='Deployment',spec={},options={}){
 const events=[],draft=Vue.reactive(kind==='Pod'?{kind,spec}:kind==='CronJob'?{kind,spec:{jobTemplate:{spec:{template:{spec}}}}}:{kind,spec:{template:{spec}}})
 const StructuredFields=component('StructuredFields',{Plus:{}})
 const KeyValueFields=component('KeyValueFields',{rowsToMap,Plus:{},Delete:{}})
 const definition=component('WorkloadPodSettings',{podSpec,mergeFormFields,StructuredFields,KeyValueFields})
 const props=Vue.reactive({modelValue:draft,creating:true,disabled:false,...options})
 const renderer=Vue.createRenderer({
  createElement:type=>({type,props:{},children:[]}),createText:text=>({text}),createComment:text=>({text}),
  setText:(node,text)=>{node.text=text},setElementText:(node,text)=>{node.children=[{text}]},parentNode:node=>node.parent,
  nextSibling:()=>null,patchProp:(node,key,old,value)=>{node.props[key]=value},
  insert:(node,parent,anchor)=>{node.parent=parent;const index=parent.children.indexOf(anchor);if(index<0)parent.children.push(node);else parent.children.splice(index,0,node)},
  remove:node=>{const index=node.parent?.children.indexOf(node);if(index>=0)node.parent.children.splice(index,1)},
 })
 const app=renderer.createApp({render:()=>Vue.h(definition,{...props,onChange:()=>events.push('change'),onValidity:value=>events.push(['validity',value])})})
 for(const name of ['el-form','el-form-item','el-input','el-input-number','el-select','el-option','el-switch','el-button','el-empty'])app.component(name,{inheritAttrs:false,setup:(_,context)=>()=>Vue.h(name,context.attrs,context.slots.default?.())})
 const root={children:[]};app.mount(root)
 const nodes=()=>{const all=[];const visit=node=>{all.push(node);for(const child of node.children||[])visit(child)};visit(root);return all}
 const find=label=>{const node=nodes().find(node=>node.props?.['aria-label']===label);assert.ok(node,`missing ${label}`);return node}
 return {draft,props,events,root,nodes,find,async update(label,value){find(label).props['onUpdate:modelValue'](value);await Vue.nextTick()},destroy:()=>app.unmount()}
}
function richSpec(){return {containers:[{name:'app',image:'nginx'}],restartPolicy:'Always',affinity:{nodeAffinity:{preferredDuringSchedulingIgnoredDuringExecution:[{weight:10,preference:{matchExpressions:[{key:'zone',operator:'In',values:['a']}]}}]}},automountServiceAccountToken:false,topologySpreadConstraints:[{maxSkew:1,topologyKey:'zone',whenUnsatisfiable:'ScheduleAnyway'}],securityContext:{runAsUser:2000,supplementalGroups:[3000],seccompProfile:{type:'RuntimeDefault'}}}}

test('mounting sparse Pod templates never writes defaults or security context',()=>{
 for(const kind of ['Pod','Deployment','CronJob']){
  const spec={containers:[{name:'app',image:'nginx'}]},before=JSON.stringify(spec),view=fixture(kind,spec)
  try{assert.equal(JSON.stringify(podSpec(view.draft)),before);assert.equal(view.events.includes('change'),false)}finally{view.destroy()}
 }
})
test('Chinese scalar controls edit Pod settings while preserving advanced arrays and security fields',async()=>{
 const view=fixture('Deployment',richSpec()),original=JSON.parse(JSON.stringify(podSpec(view.draft)))
 try{
  await view.update('优雅终止时长（秒）',45)
  await view.update('DNS 策略','ClusterFirstWithHostNet')
  await view.update('调度器','custom-scheduler')
  await view.update('服务账号','builder')
  await view.update('镜像仓库密文',['registry'])
  await view.update('运行用户 ID',1234)
  const spec=podSpec(view.draft)
  assert.equal(spec.terminationGracePeriodSeconds,45);assert.equal(spec.dnsPolicy,'ClusterFirstWithHostNet');assert.equal(spec.schedulerName,'custom-scheduler');assert.equal(spec.serviceAccountName,'builder')
  assert.deepEqual(spec.imagePullSecrets,[{name:'registry'}]);assert.equal(spec.securityContext.runAsUser,1234)
  assert.deepEqual(spec.affinity,original.affinity);assert.equal(spec.automountServiceAccountToken,false);assert.deepEqual(spec.topologySpreadConstraints,original.topologySpreadConstraints)
  assert.deepEqual(spec.securityContext.seccompProfile,{type:'RuntimeDefault'});assert.deepEqual(spec.securityContext.supplementalGroups,[3000])
  assert.ok(view.events.includes('change'))
 }finally{view.destroy()}
})
test('optional security controls remove only their own field and preserve false and zero',async()=>{
 const view=fixture('CronJob',richSpec())
 try{
  await view.update('自定义非 Root 用户运行',true);await view.update('非 Root 用户运行',false)
  await view.update('自定义运行组 ID',true);await view.update('运行组 ID',0)
  await view.update('自定义文件系统组 ID',true);await view.update('文件系统组 ID',4000)
  await view.update('自定义运行用户 ID',false)
  assert.deepEqual(podSpec(view.draft).securityContext,{supplementalGroups:[3000],seccompProfile:{type:'RuntimeDefault'},runAsNonRoot:false,runAsGroup:0,fsGroup:4000})
 }finally{view.destroy()}
})
test('reserved Pod fields cannot be added through the collapsed advanced editor',async()=>{
 const view=fixture('Deployment',richSpec())
 try{
  const details=view.nodes().find(node=>node.type==='details'&&node.props.class==='pod-settings-additional')
  assert.ok(details);assert.notEqual(details.props.open,true)
  await view.update('新字段 podSpec','restartPolicy')
  const button=view.find('新字段 podSpec').parent.children.find(node=>node.type==='el-button')
  assert.ok(button);button.props.onClick();await Vue.nextTick()
  assert.equal(podSpec(view.draft).restartPolicy,'Always')
  assert.ok(view.nodes().some(node=>node.text?.includes('此字段由专用表单管理')))
 }finally{view.destroy()}
})
test('editing node selectors and uncommon settings retains managed values and nested security data',async()=>{
 const view=fixture('Deployment',{...richSpec(),nodeSelector:{zone:'a'},imagePullSecrets:[{name:'registry',custom:'keep'}]})
 try{
  await view.update('节点选择器值 1','b');view.find('节点选择器值 1').props.onInput('b');await Vue.nextTick()
  await view.update('podSpec.automountServiceAccountToken',true)
  await view.update('securityContext.seccompProfile.type','Localhost')
  await view.update('镜像仓库密文',['registry','new-registry'])
  assert.deepEqual(podSpec(view.draft).nodeSelector,{zone:'b'})
  assert.equal(podSpec(view.draft).automountServiceAccountToken,true)
  assert.equal(podSpec(view.draft).securityContext.runAsUser,2000)
  assert.equal(podSpec(view.draft).securityContext.seccompProfile.type,'Localhost')
  assert.deepEqual(podSpec(view.draft).securityContext.supplementalGroups,[3000])
  assert.deepEqual(podSpec(view.draft).imagePullSecrets,[{name:'registry',custom:'keep'},{name:'new-registry'}])
  assert.equal(podSpec(view.draft).containers[0].image,'nginx')
 }finally{view.destroy()}
})
test('controller restart options and existing Pod locks do not change creating Pod behavior',async()=>{
 const controller=fixture('Deployment'),job=fixture('CronJob'),pod=fixture('Pod',{}, {creating:false})
 try{
  const choices=view=>view.nodes().filter(node=>node.type==='el-option'&&['Always','OnFailure','Never'].includes(node.props.value)).map(node=>node.props.value)
  assert.deepEqual(choices(controller),['Always']);assert.deepEqual(choices(job),['OnFailure','Never']);assert.equal(pod.find('服务账号').props.disabled,true)
  await pod.update('服务账号','blocked');assert.equal(podSpec(pod.draft).serviceAccountName,undefined)
  controller.props.disabled=true;await Vue.nextTick();await controller.update('调度器','blocked');assert.equal(podSpec(controller.draft).schedulerName,undefined)
 }finally{controller.destroy();job.destroy();pod.destroy()}
 const creating=fixture('Pod')
 try{assert.equal(creating.find('服务账号').props.disabled,false);await creating.update('服务账号','pod-account');assert.equal(podSpec(creating.draft).serviceAccountName,'pod-account')}finally{creating.destroy()}
})
