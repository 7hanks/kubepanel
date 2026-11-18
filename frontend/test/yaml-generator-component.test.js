import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript} from '@vue/compiler-sfc'
import {ref,reactive,computed,watch,effectScope,nextTick} from 'vue'
import * as generator from '../src/utils/yaml-generator.js'
function fixture(file,bindings={},props={}){
 const scope=effectScope(),events=[],exposed={}
 const {descriptor}=parse(fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8'))
 const source=compileScript(descriptor,{id:file}).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const context={ref,reactive,computed,watch,onMounted(){},onUnmounted(){},...generator,Plus:{},Delete:{},CopyDocument:{},Download:{},Right:{},Refresh:{},KeyValueFields:{},ElMessage:{success(){},error(){},warning(){}},ElMessageBox:{confirm:async()=>{}},...bindings}
 const definition=Function(...Object.keys(context),source)(...Object.values(context))
 const state=scope.run(()=>definition.setup(reactive(props),{expose:value=>Object.assign(exposed,value),emit:(...args)=>events.push(args)}))
 return {state,events,exposed,destroy(){scope.stop()}}
}
test('generator retains each resource draft and emits YAML for preflight without any API mutation',async()=>{
 const view=fixture('components/YamlGenerator.vue',{}, {namespace:'team',canApply:true})
 try{
  view.state.draft.value.name='web';view.state.draft.value.containers[0].image='nginx:1.27'
  view.state.chooseKind('ConfigMap');view.state.draft.value.name='config';view.state.draft.value.data=[{key:'mode',value:'dev'}]
  view.state.chooseKind('Deployment');assert.equal(view.state.draft.value.name,'web')
  await view.state.toPreflight();assert.equal(view.events[0][0],'preflight');assert.match(view.events[0][1],/kind: Deployment/)
  assert.equal(view.state.dirty.value,true)
 }finally{view.destroy()}
})
test('copy and download export validated YAML locally while an invalid draft never exports',async()=>{
 const copied=[],downloaded=[],view=fixture('components/YamlGenerator.vue',{copyText:async value=>copied.push(value),downloadGeneratedYaml:(...args)=>downloaded.push(args)}, {namespace:'team',canApply:true})
 try{
  await view.state.copyYaml();view.state.downloadYaml();assert.equal(copied.length,0);assert.equal(downloaded.length,0)
  view.state.draft.value.name='web';view.state.draft.value.containers[0].image='nginx:1.27'
  await view.state.copyYaml();assert.match(copied[0],/image: nginx:1.27/);assert.equal(view.state.dirty.value,false)
  view.state.downloadYaml();assert.equal(downloaded[0][1],'deployment-web');assert.equal(downloaded[0][0],copied[0])
 }finally{view.destroy()}
})
test('removing a container port keeps a dangling Service selection invalid instead of redirecting traffic',()=>{
 const view=fixture('components/YamlGenerator.vue',{}, {namespace:'team',canApply:true})
 try{
  const draft=view.state.draft.value;draft.name='web';draft.containers[0].image='nginx:1.27';view.state.setServiceEnabled(true)
  const selected=generator.generatorContainerPorts(draft)[0].key;draft.service.ports[0].target=selected
  view.state.removePort(draft.containers[0],0);assert.match(view.state.validationError.value,/目标端口/)
 }finally{view.destroy()}
})
test('discarding generator drafts resets every type and clears dirty state',()=>{
 const view=fixture('components/YamlGenerator.vue',{}, {namespace:'team',canApply:true})
 try{view.state.draft.value.name='web';view.state.chooseKind('Secret');view.state.draft.value.data=[{key:'password',value:'local-secret'}];assert.equal(view.state.dirty.value,true);view.state.discardDraft();assert.equal(view.state.dirty.value,false);assert.equal(view.state.draft.value.kind,'Deployment');assert.equal(view.state.draft.value.name,'')}finally{view.destroy()}
})
test('a slow clipboard export cannot mark newer edits as exported',async()=>{
 let finish
 const view=fixture('components/YamlGenerator.vue',{copyText:()=>new Promise(resolve=>finish=resolve)},{namespace:'team',canApply:true})
 try{view.state.draft.value.name='web';view.state.draft.value.containers[0].image='nginx:1.27';const copying=view.state.copyYaml();view.state.draft.value.name='changed';finish();await copying;assert.equal(view.state.dirty.value,true)}finally{view.destroy()}
})
