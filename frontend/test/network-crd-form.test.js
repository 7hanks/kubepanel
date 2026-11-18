import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc'
import {computed,ref,watch,reactive,effectScope,nextTick} from 'vue'
import * as network from '../src/utils/network-resource-form.js'
import * as crd from '../src/utils/crd-resource-form.js'

function fixture(name,resource,options={}){
 const events=[],scope=effectScope(),props=reactive({modelValue:resource,creating:true,disabled:false,...options})
 const {descriptor}=parse(fs.readFileSync(new URL(`../src/components/${name}.vue`,import.meta.url),'utf8'))
 const source=compileScript(descriptor,{id:'network-crd-test'}).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const bindings={computed,ref,watch,...network,...crd,KeyValueFields:{},StructuredFields:{}}
 const component=Function(...Object.keys(bindings),source)(...Object.values(bindings))
 const state=scope.run(()=>component.setup(props,{expose(){},emit:(...event)=>events.push(event)}))
 return {props,state,events,destroy:()=>scope.stop()}
}
const ingress=()=>({apiVersion:'networking.k8s.io/v1',kind:'Ingress',metadata:{name:'web',namespace:'apps'},spec:{ingressClassName:'nginx',rules:[{host:'app.example.com',http:{paths:[{path:'/',pathType:'Prefix',backend:{service:{name:'web',port:{number:80}}},custom:{count:0}}]},custom:false}],tls:[{hosts:['app.example.com'],secretName:'web-tls',custom:false}],custom:{enabled:false}}})
const policy=()=>({apiVersion:'networking.k8s.io/v1',kind:'NetworkPolicy',metadata:{name:'web',namespace:'apps'},spec:{podSelector:{matchLabels:{app:'web'},matchExpressions:[{key:'tier',operator:'Exists'}]},policyTypes:['Ingress','Egress'],ingress:[{from:[{namespaceSelector:{matchLabels:{team:'a'}},podSelector:{matchLabels:{app:'client'}},custom:false}],ports:[{port:80,protocol:'TCP',endPort:90,custom:0}],custom:false}],egress:[],custom:{count:0}}})
const definition=()=>({apiVersion:'apiextensions.k8s.io/v1',kind:'CustomResourceDefinition',metadata:{name:'widgets.example.com'},spec:{group:'example.com',names:{plural:'widgets',singular:'widget',kind:'Widget',shortNames:['wd'],custom:false},scope:'Namespaced',versions:[{name:'v1',served:true,storage:true,schema:{openAPIV3Schema:{type:'object',properties:{spec:{type:'object','x-kubernetes-preserve-unknown-fields':true}},custom:false},custom:0},subresources:{status:{}},custom:false}],conversion:{strategy:'None'},custom:0}})

test('network and CRD forms only claim their owning API groups',()=>{
 assert.equal(network.isNetworkFormResource({kind:'Ingress',group:'networking.k8s.io',version:'v1'}),true)
 assert.equal(network.isNetworkFormResource({kind:'NetworkPolicy',group:'example.com'}),false)
 assert.equal(crd.isCrdFormResource({kind:'CustomResourceDefinition',group:'apiextensions.k8s.io'}),true)
 assert.equal(crd.isCrdFormResource({kind:'CustomResourceDefinition',group:''}),false)
})

test('network draft defaults cannot accidentally submit broad or deny-all policies',()=>{
 const fresh={kind:'NetworkPolicy',...network.networkDraftFields('NetworkPolicy','apps')}
 assert.deepEqual(fresh.spec.policyTypes,[])
 assert.throws(()=>network.validateNetworkResource(fresh,{creating:true}),/方向/)
 const web={kind:'Ingress',...network.networkDraftFields('Ingress','apps')}
 assert.throws(()=>network.validateNetworkResource(web,{creating:true}),/服务名称/)
})

test('Ingress validates named and numeric service ports, path type and resource backends',()=>{
 const value=ingress();network.validateNetworkResource(value,{creating:true})
 value.spec.rules[0].http.paths[0].backend.service.port={name:'http'};network.validateNetworkResource(value,{creating:true})
 value.spec.rules[0].http.paths[0].backend.service.port={number:80,name:'http'};assert.throws(()=>network.validateNetworkResource(value),/端口/)
 value.spec.rules[0].http.paths[0].backend={resource:{apiGroup:'example.com',kind:'Bucket',name:'files'}};network.validateNetworkResource(value)
 value.spec.rules[0].http.paths[0].path='relative';assert.throws(()=>network.validateNetworkResource(value),/路径/)
 value.spec.rules[0].http.paths[0].pathType='ImplementationSpecific';network.validateNetworkResource(value)
 value.spec.rules=[];assert.throws(()=>network.validateNetworkResource(value),/规则|默认后端/)
 value.spec.defaultBackend={service:{name:'fallback',port:{number:8080}}};network.validateNetworkResource(value)
})

test('network policy preserves valid explicit deny-all and allow-all payloads',()=>{
 const value=policy();network.validateNetworkResource(value,{creating:true})
 value.spec.ingress=[];network.validateNetworkResource(value,{creating:true})
 value.spec.ingress=[{}];network.validateNetworkResource(value,{creating:true})
 delete value.spec.policyTypes;network.validateNetworkResource(value)
 assert.throws(()=>network.validateNetworkResource(value,{creating:true}),/方向/)
})

test('network policy validates selectors, CIDRs, mutually exclusive peers and port ranges',()=>{
 const value=policy(),peer=value.spec.ingress[0].from[0]
 peer.ipBlock={cidr:'10.0.0.0/8'};assert.throws(()=>network.validateNetworkResource(value),/组合/)
 delete peer.podSelector;delete peer.namespaceSelector;peer.ipBlock={cidr:'10.0.0.0/8',except:['10.2.0.0/16']};network.validateNetworkResource(value)
 peer.ipBlock.except=['192.168.0.0/16'];assert.throws(()=>network.validateNetworkResource(value),/子网/)
 peer.ipBlock={cidr:'2001:db8::/32',except:['2001:db8:1::/48']};network.validateNetworkResource(value)
 peer.ipBlock.cidr='2001:db8:::1/64';assert.throws(()=>network.validateNetworkResource(value),/CIDR/)
 peer.ipBlock={cidr:'10.0.0.0/33'};assert.throws(()=>network.validateNetworkResource(value),/CIDR/)
 peer.ipBlock={cidr:'10.0.0.0/8'};value.spec.ingress[0].ports[0].port='http';assert.throws(()=>network.validateNetworkResource(value),/结束端口/)
 delete value.spec.ingress[0].ports[0].endPort;network.validateNetworkResource(value)
 value.spec.podSelector.matchExpressions[0]={key:'tier',operator:'In',values:[]};assert.throws(()=>network.validateNetworkResource(value),/选择器/)
})

test('opening network forms does not mutate drafts or inject defaults',async()=>{
 for(const resource of [ingress(),policy(),{kind:'NetworkPolicy',spec:{}},{kind:'Ingress'}]){
  const before=structuredClone(resource),view=fixture('NetworkResourceForm',resource)
  try{void view.state.spec.value;void view.state.additionalFields.value;await nextTick();assert.deepEqual(resource,before);assert.equal(view.events.filter(([name])=>name==='change').length,0)}finally{view.destroy()}
 }
})

test('network controls preserve unmanaged fields and require explicit policy modes',()=>{
 const value=policy(),view=fixture('NetworkResourceForm',value)
 try{
  view.state.setAdditionalFields({custom:{count:1},podSelector:{bad:true}});assert.deepEqual(value.spec.custom,{count:1});assert.deepEqual(value.spec.podSelector.matchLabels,{app:'web'})
  view.state.setPeerType(value.spec.ingress[0].from[0],'ip');assert.equal(value.spec.ingress[0].from[0].custom,false);assert.equal(Object.hasOwn(value.spec.ingress[0].from[0],'podSelector'),false)
  assert.throws(()=>network.validateNetworkResource(value),/CIDR/)
  view.state.setDirectionMode('egress','rules');assert.equal(value.spec.egress.length,1);assert.throws(()=>network.validateNetworkResource(value),/CIDR/)
  view.state.setDirectionMode('egress','deny');assert.deepEqual(value.spec.egress,[])
  view.state.setDirectionMode('egress','off');assert.equal(Object.hasOwn(value.spec,'egress'),false);assert.deepEqual(value.spec.policyTypes,['Ingress'])
 }finally{view.destroy()}
})

test('Ingress service edits and advanced fields retain unrelated backend and rule data',()=>{
 const value=ingress(),view=fixture('NetworkResourceForm',value),path=value.spec.rules[0].http.paths[0]
 try{view.state.setServicePort(path.backend,'http');assert.deepEqual(path.backend.service.port,{name:'http'});assert.deepEqual(path.custom,{count:0});view.state.setAdditionalFields({custom:{enabled:false},ingressClassName:'wrong'});assert.equal(value.spec.ingressClassName,'nginx');assert.equal(value.spec.rules[0].custom,false);assert.equal(value.spec.tls[0].custom,false)}finally{view.destroy()}
})

test('CRD validates coherent names, versions and schema without changing the payload',()=>{
 const value=definition(),before=structuredClone(value);crd.validateCrdResource(value,{creating:true});assert.deepEqual(value,before)
 value.metadata.name='wrong.example.com';assert.throws(()=>crd.validateCrdResource(value),/名称/)
 value.metadata.name=before.metadata.name;value.spec.versions.push({...structuredClone(value.spec.versions[0]),name:'v2'});assert.throws(()=>crd.validateCrdResource(value),/存储版本/)
 value.spec.versions[1].storage=false;crd.validateCrdResource(value)
 value.spec.versions[1].name='v1';assert.throws(()=>crd.validateCrdResource(value),/重复/)
 value.spec.versions[1].name='v2';value.spec.versions[1].schema.openAPIV3Schema.type='string';assert.throws(()=>crd.validateCrdResource(value),/object/)
})

test('CRD form opening and basic/version updates preserve conversion and schema extensions',async()=>{
 const value=definition(),before=structuredClone(value),view=fixture('CrdResourceForm',value)
 try{
  await nextTick();assert.deepEqual(value,before);assert.equal(view.events.filter(([name])=>name==='change').length,0)
  view.state.setName('singular','gadget');assert.deepEqual(value.spec.names.shortNames,['wd']);assert.equal(value.spec.names.custom,false)
  view.state.setVersionSchema(value.spec.versions[0],{type:'object',properties:{count:{type:'integer'}},custom:false});assert.equal(value.spec.versions[0].schema.custom,0);assert.equal(value.spec.versions[0].custom,false);assert.deepEqual(value.spec.versions[0].subresources,{status:{}})
  view.state.setAdditionalFields({custom:0,group:'wrong'});assert.equal(value.spec.group,'example.com');assert.equal(value.spec.custom,0)
 }finally{view.destroy()}
})

test('CRD update validation protects fixed identity and stored versions',()=>{
 const original=definition(),value=structuredClone(original);value.spec.group='other.com';assert.throws(()=>crd.validateCrdResource(value,{original}),/不可修改/)
 const stored=definition();stored.status={storedVersions:['v1']};const next=structuredClone(stored);next.spec.versions[0].name='v2';assert.throws(()=>crd.validateCrdResource(next,{original:stored}),/存储过/)
})

test('CRD auto-naming follows only blank or previously derived creation names',()=>{
 const value={kind:'CustomResourceDefinition',metadata:{name:''},...crd.crdDraftFields('CustomResourceDefinition')},view=fixture('CrdResourceForm',value)
 try{
  view.state.setGroup('example.com');view.state.setName('plural','widgets');assert.equal(value.metadata.name,'widgets.example.com')
  view.state.setName('plural','gadgets');assert.equal(value.metadata.name,'gadgets.example.com')
  value.metadata.name='manually-entered';view.state.setGroup('other.com');assert.equal(value.metadata.name,'manually-entered')
 }finally{view.destroy()}
})

test('network child selector errors survive unrelated edits and disappear only with that selector',async()=>{
 const value=policy(),view=fixture('NetworkResourceForm',value),selector=view.props.modelValue.spec.ingress[0].from[0].podSelector
 try{
  view.state.setChildValidity(selector,'键名称重复：app');view.state.setDirectionMode('egress','deny');await nextTick();assert.equal(view.events.at(-1)[1],'键名称重复：app')
  view.state.removeItem(view.props.modelValue.spec.ingress[0].ports,0);await nextTick();assert.equal(view.state.validity.value,'键名称重复：app')
  view.state.removeItem(view.props.modelValue.spec.ingress[0].from,0);await nextTick();assert.equal(view.state.validity.value,'')
 }finally{view.destroy()}
})

test('disabled network and CRD controls do not mutate their draft',()=>{
 for(const [name,value] of [['NetworkResourceForm',policy()],['CrdResourceForm',definition()]]){
  const before=structuredClone(value),view=fixture(name,value,{disabled:true})
  try{if(name==='NetworkResourceForm'){view.state.setDirectionMode('ingress','deny');view.state.setAdditionalFields({changed:true})}else{view.state.setGroup('other.com');view.state.addVersion();view.state.setVersionSchema(value.spec.versions[0],{})}assert.deepEqual(value,before)}finally{view.destroy()}
 }
})

test('network and CRD templates compile',()=>{
 for(const name of ['NetworkResourceForm','CrdResourceForm']){const {descriptor}=parse(fs.readFileSync(new URL(`../src/components/${name}.vue`,import.meta.url),'utf8'));assert.deepEqual(compileTemplate({source:descriptor.template.content,filename:`${name}.vue`,id:'network-crd'}).errors,[])}
})
