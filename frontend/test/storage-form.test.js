import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc'
import {computed,ref,watch,reactive,effectScope,nextTick} from 'vue'
import {mergeFormFields} from '../src/utils/resource-form.js'
import * as storage from '../src/utils/storage-form.js'

function fixture(resource,options={}){
 const events=[],scope=effectScope(),props=reactive({modelValue:resource,creating:false,disabled:false,...options})
 const {descriptor}=parse(fs.readFileSync(new URL('../src/components/StorageForm.vue',import.meta.url),'utf8'))
 const source=compileScript(descriptor,{id:'storage-form-test'}).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const bindings={computed,ref,watch,mergeFormFields,...storage,KeyValueFields:{},StructuredFields:{}}
 const component=Function(...Object.keys(bindings),source)(...Object.values(bindings))
 const state=scope.run(()=>component.setup(props,{expose(){},emit:(...event)=>events.push(event)}))
 return {props,state,events,destroy:()=>scope.stop()}
}
const pvc=()=>({kind:'PersistentVolumeClaim',metadata:{name:'data'},spec:{accessModes:['ReadWriteOnce'],resources:{requests:{storage:'10Gi',custom:0},limits:{custom:0}},storageClassName:'fast',volumeName:'pv-data',custom:{enabled:false}},status:{phase:'Bound',capacity:{storage:'10Gi'}}})
const pv=()=>({kind:'PersistentVolume',metadata:{name:'data'},spec:{capacity:{storage:'10Gi',custom:0},accessModes:['ReadWriteMany'],persistentVolumeReclaimPolicy:'Retain',storageClassName:'nfs',nfs:{server:'nfs.internal',path:'/share',readOnly:false,custom:0},mountOptions:['hard'],custom:{enabled:false}}})
const sc=()=>({kind:'StorageClass',metadata:{name:'fast'},provisioner:'driver.example.com',parameters:{type:'ssd'},reclaimPolicy:'Retain',volumeBindingMode:'WaitForFirstConsumer',allowVolumeExpansion:false,mountOptions:['discard'],custom:{count:0,enabled:false}})

test('opening storage controls does not inject defaults or change explicit false and zero values',async()=>{
 for(const resource of [{kind:'PersistentVolumeClaim'},pvc(),pv(),sc(),{kind:'StorageClass',provisioner:'driver.example.com'}]){
  const before=structuredClone(resource),view=fixture(resource,{creating:true})
  try{void view.state.spec.value;void view.state.classMode.value;void view.state.sourceType.value;void view.state.additionalFields.value;await nextTick();assert.deepEqual(resource,before);assert.equal(view.events.filter(([name])=>name==='change').length,0)}finally{view.destroy()}
 }
})

test('pre-mounted incomplete forms do not block entering the storage tab',()=>{
 for(const resource of [{kind:'PersistentVolume',spec:{csi:{driver:'',volumeHandle:''}}},{kind:'StorageClass',provisioner:''}]){
  const view=fixture(resource,{creating:true})
  try{assert.equal(view.events.filter(([name])=>name==='validity').at(-1)[1],'')}finally{view.destroy()}
 }
})

test('PVC storage class controls distinguish omitted default, explicit no class and named classes',()=>{
 const resource=pvc(),view=fixture(resource,{creating:true})
 try{
  view.state.setClassMode('none');assert.equal(resource.spec.storageClassName,'')
  view.state.setClassMode('default');assert.equal(Object.hasOwn(resource.spec,'storageClassName'),false)
  view.state.setClassMode('named');view.state.setStorageClass('slow');assert.equal(resource.spec.storageClassName,'slow')
  assert.deepEqual(resource.spec.resources,{requests:{storage:'10Gi',custom:0},limits:{custom:0}})
 }finally{view.destroy()}
})

test('bound PVC edits change only capacity and preserve unknown resources and spec fields',()=>{
 const resource=pvc(),before=structuredClone(resource),view=fixture(resource,{original:structuredClone(resource)})
 try{
  view.state.setCapacity('12Gi');view.state.setField('volumeMode','Block');view.state.setField('volumeName','other');view.state.setClassMode('none');view.state.setAccessModes(['ReadOnlyMany']);view.state.setAdditionalFields({selector:{matchLabels:{app:'other'}}})
  before.spec.resources.requests.storage='12Gi';assert.deepEqual(resource,before)
  assert.ok(view.events.some(([name])=>name==='change'))
 }finally{view.destroy()}
})

test('pending PVC and disabled controls cannot mutate storage settings',()=>{
 for(const options of [{disabled:true,creating:true},{creating:false}]){
  const resource=pvc();resource.status.phase='Pending';const before=structuredClone(resource),view=fixture(resource,options)
  try{view.state.setCapacity('12Gi');view.state.setClassMode('none');view.state.setField('volumeName','other');assert.deepEqual(resource,before)}finally{view.destroy()}
 }
})

test('capacity validation compares Kubernetes decimal, exponent and binary quantities exactly',()=>{
 const original=pvc()
 for(const value of ['10Gi','10240Mi','10737418240','1.073741824e10','11Gi']){const resource=pvc();resource.spec.resources.requests.storage=value;assert.doesNotThrow(()=>storage.validateStorageResource(resource,{original}))}
 for(const value of ['9Gi','10239Mi','10737418239']){const resource=pvc();resource.spec.resources.requests.storage=value;assert.throws(()=>storage.validateStorageResource(resource,{original}),/不能小于/)}
 for(const value of ['',0,'0','-1Gi','NaNGi','1GB','1 Gi']){const resource=pvc();resource.spec.resources.requests.storage=value;assert.throws(()=>storage.validateStorageResource(resource,{creating:true}),/容量/)}
 const large=pvc();large.spec.resources.requests.storage='9007199254740993';const smaller=pvc();smaller.spec.resources.requests.storage='9007199254740992';assert.throws(()=>storage.validateStorageResource(smaller,{original:large}),/不能小于/)
})

test('PVC reports a reduction through validity without losing the typed draft',async()=>{
 const resource=pvc(),view=fixture(resource,{original:structuredClone(resource)})
 try{view.state.setCapacity('1Gi');await nextTick();assert.equal(resource.spec.resources.requests.storage,'1Gi');assert.ok(view.events.some(([name,error])=>name==='validity'&&/不能小于/.test(error)))}finally{view.destroy()}
})

test('PV source controls preserve unknown source fields when editing the selected source',()=>{
 const resource=pv(),view=fixture(resource,{creating:true})
 try{view.state.setSourceType('nfs');view.state.setSourceField('server','new.internal');view.state.setSourceField('readOnly',true);assert.equal(resource.spec.nfs.custom,0);assert.equal(resource.spec.nfs.path,'/share');assert.equal(resource.spec.nfs.readOnly,true);assert.deepEqual(resource.spec.custom,{enabled:false});assert.deepEqual(resource.spec.mountOptions,['hard'])}finally{view.destroy()}
})

test('CSI advanced controls preserve secret references and cannot overwrite driver fields',()=>{
 const resource=pv();delete resource.spec.nfs;resource.spec.csi={driver:'driver.example.com',volumeHandle:'volume-1',readOnly:false,volumeAttributes:{tier:'fast'},controllerPublishSecretRef:{name:'driver-secret',namespace:'infra'},custom:{count:0,enabled:false}}
 const view=fixture(resource,{creating:true})
 try{view.state.setSourceAdditionalFields({...view.state.sourceAdditionalFields.value,driver:'bad',readOnly:true,extra:{value:0}});assert.equal(resource.spec.csi.driver,'driver.example.com');assert.equal(resource.spec.csi.readOnly,false);assert.deepEqual(resource.spec.csi.controllerPublishSecretRef,{name:'driver-secret',namespace:'infra'});assert.deepEqual(resource.spec.csi.custom,{count:0,enabled:false});assert.deepEqual(resource.spec.csi.extra,{value:0});storage.validateStorageResource(resource,{creating:true})}finally{view.destroy()}
})

test('PV source switches remove only incompatible sources after explicit selection',()=>{
 const resource=pv(),view=fixture(resource,{creating:true})
 try{view.state.setSourceType('hostPath');assert.equal(Object.hasOwn(resource.spec,'nfs'),false);view.state.setSourceField('path','/var/data');view.state.setSourceField('type','Directory');assert.deepEqual(resource.spec.hostPath,{path:'/var/data',type:'Directory'});assert.deepEqual(resource.spec.capacity,{storage:'10Gi',custom:0});assert.deepEqual(resource.spec.custom,{enabled:false})}finally{view.destroy()}
})

test('PV edits leave the source and fixed settings unchanged while changing capacity and reclaim policy',()=>{
 const resource=pv(),before=structuredClone(resource),view=fixture(resource,{original:structuredClone(resource)})
 try{view.state.setSourceType('csi');view.state.setSourceField('path','/other');view.state.setField('storageClassName','other');view.state.setAccessModes(['ReadWriteOnce']);view.state.setAdditionalFields({custom:{enabled:true}});view.state.setCapacity('20Gi');view.state.setField('persistentVolumeReclaimPolicy','Delete');before.spec.capacity.storage='20Gi';before.spec.persistentVolumeReclaimPolicy='Delete';assert.deepEqual(resource,before)}finally{view.destroy()}
})

test('PV and PVC advanced fields cannot overwrite fields owned by dedicated controls',()=>{
 const resource=pv(),view=fixture(resource,{creating:true})
 try{view.state.setAdditionalFields({capacity:{storage:'1Gi'},nfs:{server:'bad',path:'/bad'},custom:{enabled:false,count:0},nodeAffinity:{required:{nodeSelectorTerms:[]}}});assert.equal(resource.spec.capacity.storage,'10Gi');assert.equal(resource.spec.nfs.server,'nfs.internal');assert.deepEqual(resource.spec.custom,{enabled:false,count:0});assert.ok(resource.spec.nodeAffinity)}finally{view.destroy()}
})

test('StorageClass edit controls protect immutable fields and retain explicit expansion false',()=>{
 const resource=sc(),before=structuredClone(resource),view=fixture(resource,{original:structuredClone(resource)})
 try{view.state.setField('provisioner','other');view.state.setField('reclaimPolicy','Delete');view.state.setField('volumeBindingMode','Immediate');view.state.setParameters({bad:'value'});view.state.setAdditionalFields({custom:'bad'});assert.deepEqual(resource,before);view.state.setExpansion(true);assert.equal(resource.allowVolumeExpansion,true);view.state.setExpansion(false);assert.equal(resource.allowVolumeExpansion,false);view.state.setExpansion('default');assert.equal(Object.hasOwn(resource,'allowVolumeExpansion'),false);assert.deepEqual(resource.custom,{count:0,enabled:false})}finally{view.destroy()}
})

test('StorageClass parameters and CSI attributes keep child validation errors until resolved',async()=>{
 const resource=sc(),view=fixture(resource,{creating:true})
 try{view.state.setChildValidity('parameters','键名称重复：type');view.state.setField('reclaimPolicy','Delete');await nextTick();assert.ok(view.events.some(([name,error])=>name==='validity'&&error==='键名称重复：type'));view.state.setChildValidity('parameters','');await nextTick();assert.equal(view.events.at(-1)[1],'')}finally{view.destroy()}
})

test('StorageClass advanced edits can remove unknown fields without changing managed identity',()=>{
 const resource=sc(),before=structuredClone(resource),view=fixture(resource,{creating:true})
 try{view.state.setAdditionalFields({apiVersion:'wrong',kind:'bad',metadata:{name:'wrong'},allowVolumeExpansion:true,allowedTopologies:[{matchLabelExpressions:[{key:'zone',values:['a']}]}]});assert.equal(Object.hasOwn(resource,'custom'),false);assert.deepEqual(resource.metadata,before.metadata);assert.equal(resource.kind,'StorageClass');assert.equal(resource.allowVolumeExpansion,false);assert.equal(resource.allowedTopologies.length,1)}finally{view.destroy()}
})

test('storage validation rejects malformed required settings and immutable updates',()=>{
 const noModes=pvc();noModes.spec.accessModes=[];assert.throws(()=>storage.validateStorageResource(noModes,{creating:true}),/访问模式/)
 const mixed=pvc();mixed.spec.accessModes=['ReadWriteOncePod','ReadWriteOnce'];assert.throws(()=>storage.validateStorageResource(mixed,{creating:true}),/ReadWriteOncePod/)
 const noSource=pv();delete noSource.spec.nfs;assert.throws(()=>storage.validateStorageResource(noSource,{creating:true}),/存储源/)
 const doubleSource=pv();doubleSource.spec.hostPath={path:'/data'};assert.throws(()=>storage.validateStorageResource(doubleSource,{creating:true}),/存储源/)
 const badNfs=pv();badNfs.spec.nfs.path='relative';assert.throws(()=>storage.validateStorageResource(badNfs,{creating:true}),/绝对路径/)
 const changedPv=pv();changedPv.spec.nfs.server='other';assert.throws(()=>storage.validateStorageResource(changedPv,{original:pv()}),/存储源/)
 const changedPvc=pvc();changedPvc.spec.storageClassName='other';assert.throws(()=>storage.validateStorageResource(changedPvc,{original:pvc()}),/不可修改/)
 const pending=pvc();pending.status.phase='Pending';const changedPending=structuredClone(pending);changedPending.spec.resources.requests.storage='12Gi';assert.throws(()=>storage.validateStorageResource(changedPending,{original:pending}),/不可修改/)
 const changedSc=sc();changedSc.provisioner='other';assert.throws(()=>storage.validateStorageResource(changedSc,{original:sc()}),/不可修改/)
 const noProvisioner=sc();noProvisioner.provisioner='';assert.throws(()=>storage.validateStorageResource(noProvisioner,{creating:true}),/供给器/)
})

test('storage template compiles for dedicated accessible controls',()=>{
 const {descriptor}=parse(fs.readFileSync(new URL('../src/components/StorageForm.vue',import.meta.url),'utf8'))
 const result=compileTemplate({source:descriptor.template.content,filename:'StorageForm.vue',id:'storage-form-test'})
 assert.deepEqual(result.errors,[])
})
