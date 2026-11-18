import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc'
import {computed,ref,watch,reactive,effectScope,nextTick} from 'vue'

const rbac=await import('../src/utils/rbac-form.js').catch(()=>({}))
const group='rbac.authorization.k8s.io'
const rule=()=>({apiGroups:[''],resources:['pods'],verbs:['get','list'],resourceNames:['app'],custom:{enabled:false}})
const role=(kind='Role')=>({apiVersion:`${group}/v1`,kind,metadata:{name:'reader',namespace:'team'},rules:[rule()],custom:{count:0}})
const binding=(kind='RoleBinding')=>({apiVersion:`${group}/v1`,kind,metadata:{name:'readers',namespace:'team'},roleRef:{apiGroup:group,kind:kind==='RoleBinding'?'Role':'ClusterRole',name:'reader',custom:false},subjects:[{kind:'ServiceAccount',apiGroup:'',name:'reader',namespace:'team',custom:0}],custom:{enabled:false}})

test('RBAC recognition requires the exact API group and defaults never grant or name example identities',()=>{
 assert.equal(typeof rbac.isRbacResource,'function')
 assert.equal(rbac.isRbacResource({group,kind:'Role'}),true)
 for(const meta of [{group:'example.io',kind:'Role'},{group:'',kind:'RoleBinding'},{group,kind:'Deployment'}])assert.equal(rbac.isRbacResource(meta),false)
 const fields=rbac.rbacDraftFields('Role','team');assert.deepEqual(fields,{rules:[{apiGroups:[''],resources:[],verbs:[]}]})
 fields.rules[0].verbs.push('get');assert.deepEqual(rbac.rbacDraftFields('Role','team').rules[0].verbs,[])
 const draft=rbac.rbacDraftFields('ClusterRoleBinding','team')
 assert.equal(draft.roleRef.kind,'ClusterRole');assert.equal(draft.roleRef.name,'');assert.equal(draft.subjects[0].name,'');assert.equal(draft.subjects[0].namespace,'')
 assert.deepEqual(rbac.rbacDraftFields('Other','team'),{})
})

test('resource rules require verbs, API groups and resources while preserving core API groups and unknown fields',()=>{
 assert.equal(typeof rbac.validateRbacResource,'function')
 const resource=role(),before=structuredClone(resource)
 assert.doesNotThrow(()=>rbac.validateRbacResource(resource,{creating:true}));assert.deepEqual(resource,before)
 for(const [key,value,pattern] of [['verbs',[],/动作|verbs/],['resources',[],/资源|resources/],['apiGroups',[],/API 组|apiGroups/],['verbs',[''],/动作|verbs/]]){
  const draft=role();draft.rules[0][key]=value;assert.throws(()=>rbac.validateRbacResource(draft,{creating:true}),pattern)
 }
 const empty=role();empty.rules=[];assert.doesNotThrow(()=>rbac.validateRbacResource(empty,{creating:true}))
})

test('only ClusterRole accepts non-resource URLs and resource and URL rules cannot be mixed',()=>{
 assert.equal(typeof rbac.validateRbacResource,'function')
 const resource=role('ClusterRole');resource.rules=[{nonResourceURLs:['/healthz','/metrics/*'],verbs:['get']}]
 assert.doesNotThrow(()=>rbac.validateRbacResource(resource,{creating:true}))
 const namespaced=structuredClone(resource);namespaced.kind='Role';assert.throws(()=>rbac.validateRbacResource(namespaced),/ClusterRole|非资源/)
 for(const extra of [{resources:['pods']},{apiGroups:['']},{resourceNames:['app']}]){
  const mixed=structuredClone(resource);Object.assign(mixed.rules[0],extra);assert.throws(()=>rbac.validateRbacResource(mixed),/混|同时/)
 }
 const aggregate=role('ClusterRole');delete aggregate.rules;aggregate.aggregationRule={clusterRoleSelectors:[{matchLabels:{team:'readers'}}]}
 const before=structuredClone(aggregate);assert.doesNotThrow(()=>rbac.validateRbacResource(aggregate));assert.deepEqual(aggregate,before)
})

test('URL rules reject malformed known resource fields instead of hiding them in an otherwise valid rule',()=>{
 for(const key of ['apiGroups','resources','resourceNames']){
  const resource=role('ClusterRole');resource.rules=[{verbs:['get'],nonResourceURLs:['/healthz'],[key]:{invalid:true}}]
  assert.throws(()=>rbac.validateRbacResource(resource),/API 组|资源/)
 }
})

test('bindings validate reference kinds, names and typed subject API groups without requiring live accounts',()=>{
 assert.equal(typeof rbac.validateRbacResource,'function')
 for(const kind of ['RoleBinding','ClusterRoleBinding'])assert.doesNotThrow(()=>rbac.validateRbacResource(binding(kind),{creating:true}))
 const cluster=binding('ClusterRoleBinding');cluster.roleRef.kind='Role';assert.throws(()=>rbac.validateRbacResource(cluster),/ClusterRole/)
 const blank=binding();blank.roleRef.name='';assert.throws(()=>rbac.validateRbacResource(blank),/角色.*名称|引用.*名称/)
 for(const subject of [{kind:'User',apiGroup:'',name:'alice'},{kind:'Group',apiGroup:'',name:'team'},{kind:'ServiceAccount',apiGroup:group,name:'app',namespace:'team'},{kind:'Other',name:'app'}]){
  const draft=binding();draft.subjects=[subject];assert.throws(()=>rbac.validateRbacResource(draft),/API 组|主体类型/)
 }
 const users=binding();users.subjects=[{kind:'User',apiGroup:group,name:'alice'},{kind:'Group',apiGroup:group,name:'ops'}];assert.doesNotThrow(()=>rbac.validateRbacResource(users))
 const namespace=binding('ClusterRoleBinding');delete namespace.subjects[0].namespace;assert.throws(()=>rbac.validateRbacResource(namespace),/命名空间/)
 const implicit=binding();delete implicit.subjects[0].namespace;assert.doesNotThrow(()=>rbac.validateRbacResource(implicit))
 const noSubjects=binding();noSubjects.subjects=[];assert.doesNotThrow(()=>rbac.validateRbacResource(noSubjects))
})

test('binding roleRef is immutable when editing but subjects can change without loss of unknown fields',()=>{
 assert.equal(typeof rbac.validateRbacResource,'function')
 const original=binding(),changed=structuredClone(original);changed.subjects[0].name='other'
 assert.doesNotThrow(()=>rbac.validateRbacResource(changed,{creating:false,original}))
 changed.roleRef.name='other';assert.throws(()=>rbac.validateRbacResource(changed,{creating:false,original}),/不可修改/)
 assert.doesNotThrow(()=>rbac.validateRbacResource(changed,{creating:true,original}))
})

test('RoleBinding can refer to a ClusterRole without moving either the binding or its service account namespace',()=>{
 const resource=binding();resource.roleRef.kind='ClusterRole';resource.subjects[0].namespace='other-team'
 const before=structuredClone(resource)
 assert.doesNotThrow(()=>rbac.validateRbacResource(resource,{creating:true}))
 assert.deepEqual(resource,before)
})

function fixture(resource,options={}){
 const events=[],scope=effectScope(),props=reactive({modelValue:resource,creating:false,disabled:false,...options})
 const {descriptor}=parse(fs.readFileSync(new URL('../src/components/RbacResourceForm.vue',import.meta.url),'utf8'))
 const source=compileScript(descriptor,{id:'rbac-form-test'}).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const bindings={computed,ref,watch,...rbac,Plus:{},Delete:{}}
 const component=Function(...Object.keys(bindings),source)(...Object.values(bindings))
 const state=scope.run(()=>component.setup(props,{expose(){},emit:(...event)=>events.push(event)}))
 return {state,props,events,destroy:()=>scope.stop()}
}

test('RBAC controls initialize without changing draft or blocking an unopened blank form',async()=>{
 assert.equal(typeof rbac.rbacDraftFields,'function')
 for(const resource of [role(),binding(),{apiVersion:`${group}/v1`,kind:'RoleBinding',...rbac.rbacDraftFields('RoleBinding','team')}]){
  const before=structuredClone(resource),view=fixture(resource,{creating:true})
  try{void view.state.rules.value;void view.state.subjects.value;await nextTick();assert.deepEqual(resource,before);assert.equal(view.events.filter(([name])=>name==='change').length,0);assert.equal(view.events.filter(([name])=>name==='validity').at(-1)[1],'')}finally{view.destroy()}
 }
})

test('rule controls preserve unknown and aggregation fields and explicit URL switches remove incompatible rule fields',async()=>{
 const resource=role('ClusterRole');resource.aggregationRule={clusterRoleSelectors:[{matchLabels:{team:'readers'}}]};const before=structuredClone(resource),view=fixture(resource,{creating:true})
 try{
  view.state.setRuleList(0,'verbs',['get']);assert.deepEqual(resource.rules[0].custom,{enabled:false});assert.deepEqual(resource.aggregationRule,before.aggregationRule)
  view.state.setRuleType(0,'url');assert.equal(Object.hasOwn(resource.rules[0],'resources'),false);assert.equal(Object.hasOwn(resource.rules[0],'apiGroups'),false);assert.equal(Object.hasOwn(resource.rules[0],'resourceNames'),false)
  view.state.setRuleList(0,'nonResourceURLs',['/metrics']);assert.deepEqual(resource.rules[0].nonResourceURLs,['/metrics']);assert.deepEqual(resource.rules[0].custom,{enabled:false})
  view.state.addRule();assert.equal(resource.rules.length,2);view.state.removeRule(1);assert.equal(resource.rules.length,1)
  await nextTick();assert.equal(view.events.filter(([name])=>name==='validity').at(-1)[1],'')
 }finally{view.destroy()}
})

test('binding controls lock edited role references and update subject kind without losing unknown fields',()=>{
 const resource=binding(),before=structuredClone(resource),view=fixture(resource)
 try{
  view.state.setRoleRef('name','other');view.state.setRoleRef('kind','ClusterRole');assert.deepEqual(resource.roleRef,before.roleRef)
  view.state.setSubjectKind(0,'User');assert.equal(resource.subjects[0].apiGroup,group);assert.equal(Object.hasOwn(resource.subjects[0],'namespace'),false);assert.equal(resource.subjects[0].custom,0)
  view.state.setSubjectField(0,'name','alice');assert.equal(resource.subjects[0].name,'alice')
  view.state.setSubjectKind(0,'ServiceAccount');assert.equal(resource.subjects[0].apiGroup,'');assert.equal(Object.hasOwn(resource.subjects[0],'namespace'),false)
  view.state.addSubject();view.state.removeSubject(1);assert.equal(resource.subjects.length,1);assert.deepEqual(resource.custom,{enabled:false})
 }finally{view.destroy()}
})

test('disabled RBAC handlers cannot mutate draft and creating controls cannot select invalid reference kinds',()=>{
 const resource=binding(),before=structuredClone(resource),view=fixture(resource,{disabled:true,creating:true})
 try{view.state.setRoleRef('name','other');view.state.setSubjectField(0,'name','other');view.state.setSubjectKind(0,'Group');view.state.addSubject();view.state.removeSubject(0);assert.deepEqual(resource,before)}finally{view.destroy()}
 const cluster=binding('ClusterRoleBinding'),created=fixture(cluster,{creating:true})
 try{created.state.setRoleRef('kind','Role');assert.equal(cluster.roleRef.kind,'ClusterRole');created.state.setRoleRef('name','new-reader');assert.equal(cluster.roleRef.name,'new-reader')}finally{created.destroy()}
 const roleDraft=role(),disabled=fixture(roleDraft,{disabled:true,creating:true}),prior=structuredClone(roleDraft)
 try{disabled.state.setRuleList(0,'verbs',['delete']);disabled.state.setRuleType(0,'url');disabled.state.addRule();disabled.state.removeRule(0);assert.deepEqual(roleDraft,prior)}finally{disabled.destroy()}
})

test('manual binding entry keeps incomplete input in the draft and clears validity after required fields are filled',async()=>{
 const resource={apiVersion:`${group}/v1`,kind:'RoleBinding',metadata:{name:'readers',namespace:'team'},...rbac.rbacDraftFields('RoleBinding','team')},view=fixture(resource,{creating:true})
 try{
  view.state.setRoleRef('kind','ClusterRole');view.state.setRoleRef('name','reader');await nextTick()
  assert.ok(view.events.some(([name,error])=>name==='validity'&&/主体名称/.test(error)))
  view.state.setSubjectField(0,'name','app-reader');await nextTick()
  assert.equal(view.events.filter(([name])=>name==='validity').at(-1)[1],'')
  assert.deepEqual(resource.roleRef,{apiGroup:group,kind:'ClusterRole',name:'reader'})
  assert.deepEqual(resource.subjects,[{kind:'ServiceAccount',apiGroup:'',name:'app-reader'}])
 }finally{view.destroy()}
})

test('new RoleBinding subjects follow binding namespace changes until a namespace is explicitly chosen',()=>{
 const resource={apiVersion:`${group}/v1`,kind:'RoleBinding',metadata:{name:'readers',namespace:'default'},...rbac.rbacDraftFields('RoleBinding','default')},view=fixture(resource,{creating:true})
 try{
  assert.equal(Object.hasOwn(resource.subjects[0],'namespace'),false)
  resource.metadata.namespace='team'
  assert.equal(view.state.subjectNamespace(resource.subjects[0]),'team')
  view.state.setSubjectField(0,'name','reader');view.state.setRoleRef('name','reader')
  assert.doesNotThrow(()=>rbac.validateRbacResource(resource,{creating:true}))
  view.state.addSubject();assert.equal(Object.hasOwn(resource.subjects[1],'namespace'),false)
  resource.metadata.namespace='production';assert.equal(view.state.subjectNamespace(resource.subjects[1]),'production')
  view.state.setSubjectField(0,'namespace','accounts');view.state.setSubjectKind(0,'ServiceAccount')
  resource.metadata.namespace='other';assert.equal(view.state.subjectNamespace(resource.subjects[0]),'accounts')
  view.state.setSubjectKind(1,'User');view.state.setSubjectKind(1,'ServiceAccount')
  assert.equal(Object.hasOwn(resource.subjects[1],'namespace'),false);assert.equal(view.state.subjectNamespace(resource.subjects[1]),'other')
 }finally{view.destroy()}
 const cluster={apiVersion:`${group}/v1`,kind:'ClusterRoleBinding',metadata:{name:'readers'},...rbac.rbacDraftFields('ClusterRoleBinding','default')},clusterView=fixture(cluster,{creating:true})
 try{assert.equal(cluster.subjects[0].namespace,'');clusterView.state.addSubject();assert.equal(cluster.subjects[1].namespace,'');clusterView.state.setSubjectKind(1,'User');clusterView.state.setSubjectKind(1,'ServiceAccount');assert.equal(cluster.subjects[1].namespace,'')}finally{clusterView.destroy()}
})

test('RBAC form compiles with rule and subject controls',()=>{
 const {descriptor}=parse(fs.readFileSync(new URL('../src/components/RbacResourceForm.vue',import.meta.url),'utf8'))
 const result=compileTemplate({source:descriptor.template.content,filename:'RbacResourceForm.vue',id:'rbac-form-test'})
 assert.deepEqual(result.errors,[])
})
