import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript} from '@vue/compiler-sfc'
import {ref,shallowRef,computed,reactive,watch,effectScope} from 'vue'
import * as yaml from 'js-yaml'
import * as resource from '../src/utils/resource.js'
import * as filters from '../src/utils/resource-filters.js'
import * as columns from '../src/config/columns.js'
import {MAX_BULK_POD_RESTART} from '../src/utils/bulk-pod-restart.js'

function fixture(confirm=async()=>{}) {
 const scope=effectScope(),calls=[],cleanups=[],warnings=[]
 const store=reactive({currentClusterId:'a',namespace:'team'}),route=reactive({path:'/c/a/r/_core/v1/pods',params:{},query:{}})
 const {descriptor}=parse(fs.readFileSync(new URL('../src/views/ResourceList.vue',import.meta.url),'utf8'))
 const source=compileScript(descriptor,{id:'pod-actions'}).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const bindings={ref,shallowRef,computed,reactive,watch,onMounted(){},onUnmounted:fn=>cleanups.push(fn),useRoute:()=>route,useRouter:()=>({replace(){},push(){}}),store,yaml,
  ElMessage:{warning:m=>warnings.push(m),error:m=>warnings.push(m),success(){}},ElMessageBox:{confirm},api:{restartPod:async(...args)=>{calls.push(args);return {ok:true}},list:async()=>({items:[]})},registerUnsavedGuard:()=>()=>{},
  metaFromRoute:()=>({kind:'Pod',group:'',version:'v1',plural:'pods',namespaced:true}),statusTag:()=>'',cpath:path=>path,nsPath:ns=>ns,
  can:()=>true,canResource:()=>true,canCreate:()=>true,canUpdate:()=>true,canDelete:()=>true,...resource,...filters,...columns,MAX_BULK_POD_RESTART,
  Search:{},Filter:{},Plus:{},Refresh:{},MoreFilled:{},YamlDialog:{},ScaleDialog:{},ResourceActionButton:{},ContainerFilePicker:{},BulkPodRestartDialog:{},window:{removeEventListener(){}}}
 const definition=Function(...Object.keys(bindings),source)(...Object.values(bindings))
 const state=scope.run(()=>definition.setup({}, {expose(){}}))
 return {state,store,calls,warnings,destroy(){cleanups.forEach(fn=>fn());scope.stop()}}
}
const pod=()=>({name:'web',namespace:'team',_raw:{metadata:{name:'web',namespace:'team',uid:'original-uid'}}})

test('single-row restart passes original UID and cluster snapshot through confirmation',async()=>{
 let confirmed;const view=fixture(()=>new Promise(resolve=>{confirmed=resolve}))
 try{
  const row=pod(),operation=view.state.onCommand('restartPod',row)
  row._raw.metadata.uid='replacement-uid';confirmed();await operation
  assert.equal(view.calls.length,1)
  assert.deepEqual(view.calls[0],['team','web',{uid:'original-uid',clusterId:'a'}])
 }finally{view.destroy()}
})
test('single-row restart cannot act after confirmation changes cluster or without raw UID',async()=>{
 let confirmed;const view=fixture(()=>new Promise(resolve=>{confirmed=resolve}))
 try{
  const operation=view.state.onCommand('restartPod',pod());view.store.currentClusterId='b';confirmed();await operation
  assert.equal(view.calls.length,0);assert.ok(view.warnings.length)
  const noUid=pod();delete noUid._raw.metadata.uid;noUid.uid='fallback-id';await view.state.onCommand('restartPod',noUid)
  assert.equal(view.calls.length,0)
 }finally{view.destroy()}
})

test('bulk snapshot includes only checked rows and refuses more than the bounded selection',()=>{
 const view=fixture();try{
  view.state.items.value=[pod()._raw,{metadata:{name:'unselected',namespace:'team',uid:'other'}}]
  view.state.selected.value=[pod()];view.state.openBulkRestart()
  assert.equal(view.state.bulkRestartTargets.value.length,1);assert.equal(view.state.bulkRestartTargets.value[0].name,'web')
  view.state.bulkRestartVisible.value=false;view.state.selected.value=Array.from({length:101},()=>pod());view.state.openBulkRestart()
  assert.equal(view.state.bulkRestartVisible.value,false)
 }finally{view.destroy()}
})
