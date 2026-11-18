import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript} from '@vue/compiler-sfc'
import {ref,computed,effectScope} from 'vue'
function fixture(accept=true){
 const scope=effectScope(),guards=[],cleared=[],staged=[];let confirms=0,exported=0
 const {descriptor}=parse(fs.readFileSync(new URL('../src/views/YamlWorkbench.vue',import.meta.url),'utf8'))
 const source=compileScript(descriptor,{id:'generator-page'}).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const bindings={ref,computed,onMounted(){},onUnmounted(){},store:{namespace:'team'},can:()=>true,registerUnsavedGuard:fn=>{guards.push(fn);return()=>{}},ElMessageBox:{confirm:async()=>{confirms++;if(!accept)throw new Error('cancel')}},YamlGenerator:{},YamlApplyWorkbench:{},window:{addEventListener(){},removeEventListener(){}}}
 const component=Function(...Object.keys(bindings),source)(...Object.values(bindings))
 const state=scope.run(()=>component.setup({}, {expose(){}}))
 state.generator.value={dirty:true,discardDraft:()=>cleared.push('generator'),markExported:()=>exported++}
 state.applyWorkbench.value={dirty:true,working:false,discardDraft:()=>cleared.push('apply'),stageYaml:async text=>{staged.push(text);return accept}}
 return {state,guards,cleared,staged,confirms:()=>confirms,exported:()=>exported,destroy(){scope.stop()}}
}
test('one discard decision protects both generator and Apply drafts without clearing either on cancel',async()=>{
 const cancelled=fixture(false)
 try{assert.equal(await cancelled.guards[0](),false);assert.equal(cancelled.confirms(),1);assert.deepEqual(cancelled.cleared,[])}finally{cancelled.destroy()}
 const accepted=fixture()
 try{assert.equal(await accepted.guards[0](),true);assert.equal(accepted.confirms(),1);assert.deepEqual(accepted.cleared,['generator','apply'])}finally{accepted.destroy()}
})
test('transfer switches to preflight only after draft replacement succeeds and never submits',async()=>{
 const cancelled=fixture(false)
 try{await cancelled.state.stageGenerated('kind: Pod');assert.equal(cancelled.state.activeTab.value,'generator');assert.equal(cancelled.exported(),0)}finally{cancelled.destroy()}
 const accepted=fixture()
 try{await accepted.state.stageGenerated('kind: Pod');assert.equal(accepted.state.activeTab.value,'apply');assert.equal(accepted.exported(),1);assert.deepEqual(accepted.staged,['kind: Pod'])}finally{accepted.destroy()}
})
test('browser close protects local drafts and in-progress Apply blocks context changes',async()=>{
 const view=fixture();let prevented=false
 try{const event={preventDefault(){prevented=true}};view.state.beforeUnload(event);assert.equal(prevented,true);view.state.applyWorkbench.value.working=true;assert.equal(await view.guards[0](),false);assert.equal(view.confirms(),0)}finally{view.destroy()}
})
