import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc'
import * as Vue from 'vue'
import {renderToString} from '@vue/server-renderer'
import {ref,computed,watch,reactive,effectScope,nextTick} from 'vue'
import {loadAll,dump} from 'js-yaml'
import {yamlPreview} from '../src/utils/yaml-preview.js'
import {importYamlDraft,MAX_YAML_IMPORT_BYTES} from '../src/utils/yaml-import.js'

function fixture(options={}) {
 const scope=effectScope(),props=reactive({modelValue:true,mode:'view',readonly:false,creating:false,content:'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: app\n',title:'查看 app',...options}),events=[]
 const {descriptor}=parse(fs.readFileSync(new URL('../src/components/YamlDialog.vue',import.meta.url),'utf8'))
 const compiled=compileScript(descriptor,{id:'yaml-modes'})
 const source=compiled.content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const bindings={ref,computed,watch,onMounted(){},onUnmounted(){},loadAll,dump,yamlPreview,importYamlDraft,MAX_YAML_IMPORT_BYTES,registerUnsavedGuard:()=>()=>{},ElMessage:{success(){}},ElMessageBox:{confirm:async()=>{}},YamlViewToggle:{render:()=>null},YamlDiff:{render:()=>null},EditPen:{}}
 const definition=Function(...Object.keys(bindings),source)(...Object.values(bindings))
 const state=scope.run(()=>definition.setup(props,{expose(){},emit:(...event)=>events.push(event)}))
 async function html(){
  const template=compileTemplate({source:descriptor.template.content,id:'yaml-modes',filename:'YamlDialog.vue',compilerOptions:{mode:'function',bindingMetadata:compiled.bindings}})
  const app=Vue.createSSRApp({props:definition.props,setup:()=>state,render:Function('Vue',template.code)(Vue)},props)
  for(const name of ['el-dialog','el-button','el-tag','el-alert'])app.component(name,{setup:(_,{slots})=>()=>Vue.h(name,{},[slots.default?.(),slots.footer?.()])})
  return renderToString(app)
 }
 return {state,props,events,html,destroy:()=>scope.stop()}
}

test('YAML viewing exports only, while entering existing-resource edit enables import and retains draft guards',async()=>{
 const view=fixture();try{
  assert.equal(view.state.allowImport.value,false);assert.equal(view.state.allowExport.value,true)
  let picks=0;view.state.fileInput.value={click(){picks++}};view.state.pickFile();assert.equal(picks,0)
  await view.state.onFileChange({target:{files:[{size:10,text:async()=>{throw new Error('view must not read file')}}],value:'file'}})
  assert.equal(view.state.editing.value,false)
  view.state.startEdit();assert.equal(view.state.allowImport.value,true);assert.equal(view.state.allowExport.value,true)
  view.state.pickFile();assert.equal(picks,1)
  view.state.updateText({target:{value:view.props.content+'data: {key: value}\n'}});assert.equal(view.state.dirty.value,true)
  await view.state.cancelEdit();assert.equal(view.state.dirty.value,false);assert.equal(view.state.allowImport.value,false)
 }finally{view.destroy()}
})

test('new resource imports only and permanently read-only existing resource exports only',async()=>{
 const create=fixture({creating:true,mode:'edit',title:'新建 ConfigMap'}),readonly=fixture({readonly:true})
 try{
  assert.equal(create.state.allowImport.value,true);assert.equal(create.state.allowExport.value,false)
  await create.state.onFileChange({target:{files:[{size:80,text:async()=>'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: imported\n'}],value:'file'}})
  assert.match(create.state.text.value,/name: imported/)
  readonly.state.startEdit();assert.equal(readonly.state.editing.value,false)
  assert.equal(readonly.state.allowImport.value,false);assert.equal(readonly.state.allowExport.value,true)
  readonly.props.readonly=false;await nextTick();readonly.state.startEdit();assert.equal(readonly.state.allowImport.value,true)
 }finally{create.destroy();readonly.destroy()}
})

test('rendered YAML toolbar follows view, create and existing edit modes',async()=>{
 for(const [options,imports,exports] of [[{mode:'view'},false,true],[{mode:'view',readonly:true},false,true],[{mode:'edit',creating:true},true,false],[{mode:'edit'},true,true]]){
  const view=fixture(options);try{
   const html=await view.html();assert.equal(html.includes('导入 YAML'),imports);assert.equal(html.includes('导出 YAML'),exports)
  }finally{view.destroy()}
 }
})
