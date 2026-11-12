import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript} from '@vue/compiler-sfc'
import {ref,computed,watch,reactive,effectScope} from 'vue'
import {newResourceDraft,podSpec,mergeFormFields,resourceBody} from '../src/utils/resource-form.js'
test('new advanced container fields update reactive form signatures immediately',()=>{
 const scope=effectScope(),meta={kind:'Deployment',group:'apps',version:'v1',namespaced:true}
 const draft=reactive(newResourceDraft(meta,'team'));draft.metadata.name='app';podSpec(draft).containers[0].image='nginx:1.25'
 const {descriptor}=parse(fs.readFileSync(new URL('../src/components/WorkloadForm.vue',import.meta.url),'utf8'))
 const source=compileScript(descriptor,{id:'workload-form-test'}).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const bindings={ref,computed,watch,podSpec,mergeFormFields,Plus:{},Delete:{},StructuredFields:{}}
 const definition=Function(...Object.keys(bindings),source)(...Object.values(bindings))
 try{
  const state=scope.run(()=>definition.setup(reactive({modelValue:draft,creating:true,disabled:false,section:'containers'}),{expose(){}}))
  const signature=computed(()=>JSON.stringify(resourceBody(draft,{meta,creating:true})))
  const before=signature.value;assert.deepEqual(state.containerExtra.value,{})
  state.setContainerExtra({livenessProbe:{httpGet:{path:'/health',port:80}}})
  assert.notEqual(signature.value,before)
  assert.equal(state.containerExtra.value.livenessProbe.httpGet.path,'/health')
 }finally{scope.stop()}
})
