import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript} from '@vue/compiler-sfc'
import {ref,computed,watch,effectScope,nextTick} from 'vue'
import * as yaml from 'js-yaml'
import {assertApplySuccess,createRequestGate} from '../src/utils/resource.js'
function fixture(allowReplace=true){
 const scope=effectScope(),calls=[],exposed={};let confirms=0
 const {descriptor}=parse(fs.readFileSync(new URL('../src/components/YamlApplyWorkbench.vue',import.meta.url),'utf8'))
 const source=compileScript(descriptor,{id:'apply-workbench'}).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const bindings={ref,computed,watch,onUnmounted(){},yaml,assertApplySuccess,createRequestGate,can:()=>true,store:{currentClusterId:'dev',currentCluster:{name:'Dev'},namespace:'team',discovery:[{kind:'ConfigMap',group:'',version:'v1',plural:'configmaps',namespaced:true}]},ElMessage:{success(){}},ElMessageBox:{confirm:async()=>{confirms++;if(!allowReplace)throw new Error('cancel')}},api:{get:async()=>{throw {status:404}},apply:async(text,options)=>{calls.push({text,options});return {ok:true,results:[{ok:true,name:'settings',operation:'created'}]}}}}
 const component=Function(...Object.keys(bindings),source)(...Object.values(bindings))
 const state=scope.run(()=>component.setup({}, {expose:value=>Object.assign(exposed,value)}))
 return {state,calls,exposed,confirms:()=>confirms,destroy(){scope.stop()}}
}
const generated='apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\n  namespace: team\ndata:\n  mode: dev\n'
test('staging generated YAML requires consent before replacing a dirty Apply draft',async()=>{
 const view=fixture(false)
 try{view.state.text.value='unsaved';assert.equal(await view.state.stageYaml(generated),false);assert.equal(view.state.text.value,'unsaved');assert.equal(view.confirms(),1);assert.equal(view.calls.length,0)}finally{view.destroy()}
})
test('staging never calls Apply and submission remains gated by explicit successful server preflight',async()=>{
 const view=fixture()
 try{assert.equal(await view.state.stageYaml(generated),true);await nextTick();assert.equal(view.calls.length,0);assert.equal(view.state.approved.value,false)
  await view.state.submit();assert.equal(view.calls.length,0)
  await view.state.preflight();assert.equal(view.calls[0].options.dryRun,true);assert.equal(view.state.approved.value,true)
  await view.state.submit();assert.equal(view.calls[1].options.dryRun,false);assert.equal(view.confirms(),1)
 }finally{view.destroy()}
})
