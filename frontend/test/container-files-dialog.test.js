import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript} from '@vue/compiler-sfc'
import {ref,reactive,computed,watch,nextTick,effectScope} from 'vue'
import * as icons from '@element-plus/icons-vue'
import * as transfer from '../src/utils/container-transfer.js'

function fixture({upload,ticket,confirm=async()=>{}}={}) {
 const scope=effectScope(),unmounted=[],calls=[],downloads=[]
 const props=reactive({modelValue:true,target:{clusterId:'dev',namespace:'team',pod:'web',container:'app',uid:'pod1'}})
 const {descriptor}=parse(fs.readFileSync(new URL('../src/components/ContainerFilesDialog.vue',import.meta.url),'utf8'))
 const source=compileScript(descriptor,{id:'files-test'}).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'').replace('export default','return')
 const api={containerFile:async body=>{calls.push(body);return {path:'/',entries:[]}},containerUpload:upload||(async()=>({ok:true})),containerDownloadTicket:ticket||(async body=>{calls.push({ticket:body});return {url:'/api/v1/container/files/download?ticket=one',bytes:transfer.MAX_TRANSFER_BYTES}})}
 const bindings={...icons,ref,reactive,computed,watch,onUnmounted:fn=>unmounted.push(fn),api,can:()=>true,registerUnsavedGuard:()=>()=>{},ElMessage:{success(){}},ElMessageBox:{confirm},...transfer,startNativeDownload:(...args)=>downloads.push(args)}
 const definition=Function(...Object.keys(bindings),source)(...Object.values(bindings))
 const state=scope.run(()=>definition.setup(props,{expose(){},emit(){}}))
 return {state,props,calls,downloads,destroy(){unmounted.forEach(fn=>fn());scope.stop()}}
}

test('dialog streams a 5 GiB File with progress and cancels through the same request signal',async()=>{
 let request,reads=0
 const view=fixture({upload:(target,file,config)=>new Promise((resolve,reject)=>{request={target,file,config,resolve};config.signal.addEventListener('abort',()=>reject({cancelled:true}))})})
 try{
  const file={name:'large.bin',size:5*1024**3,arrayBuffer(){reads++;throw new Error('must not buffer')}}
  const operation=view.state.upload({target:{files:[file],value:'selected'}});await nextTick();await nextTick()
  assert.ok(request,'the transfer request should start after confirmation')
  assert.equal(request.file,file);assert.equal(request.target.clusterId,'dev');assert.equal(request.target.path,'/large.bin')
  request.config.onProgress({loaded:1024**3,total:file.size});assert.equal(view.state.uploadLoaded.value,1024**3)
  view.state.cancelUpload();await operation
  assert.equal(request.config.signal.aborted,true)
  assert.equal(view.state.uploadState.value,'cancelled');assert.equal(view.state.busy.value,false);assert.equal(reads,0)
 }finally{view.destroy()}
})

test('dialog downloads large files through a native ticket URL and keeps online editor capped at 1 MiB',async()=>{
 const view=fixture()
 try{
  await view.state.read({name:'large.bin',path:'/large.bin'},false)
  assert.deepEqual(view.downloads,[['/api/v1/container/files/download?ticket=one','large.bin']])
  assert.equal(view.calls.some(call=>call.action==='read'),false)
  assert.match(view.state.downloadNotice.value,/浏览器/)
  view.calls.length=0;view.state.editingPath.value='/file';view.state.editorOpen.value=true;view.state.fileText.value='x'.repeat(1024**2+1)
  await view.state.saveFile()
  assert.equal(view.calls.length,0)
  assert.match(view.state.error.value,/在线编辑.*1 MiB/)
 }finally{view.destroy()}
})

test('closing a dialog while upload confirmation is pending cannot start a stale transfer',async()=>{
 let confirm;const view=fixture({confirm:()=>new Promise(resolve=>{confirm=resolve}),upload:()=>{throw new Error('stale request must not start')}})
 try{
  const operation=view.state.upload({target:{files:[{name:'file',size:1}],value:'selected'}})
  await nextTick();view.props.modelValue=false;await nextTick();confirm();await operation
  assert.equal(view.state.busy.value,false)
  assert.notEqual(view.state.uploadState.value,'uploading')
 }finally{view.destroy()}
})

test('file filtering sorts directories first, respects hidden items and resets pagination',async()=>{
 const view=fixture()
 try{
  view.state.entries.value=[{name:'z.txt',type:'file',path:'/z.txt'},{name:'.env',type:'file',path:'/.env'},{name:'etc',type:'directory',path:'/etc'}]
  assert.deepEqual(view.state.filteredEntries.value.map(x=>x.name),['etc','z.txt'])
  view.state.page.value=3;view.state.filterText.value='Z';await nextTick()
  assert.equal(view.state.page.value,1)
  assert.deepEqual(view.state.pagedEntries.value.map(x=>x.name),['z.txt'])
  view.state.filterText.value='';view.state.showHidden.value=true;await nextTick()
  assert.equal(view.state.filteredEntries.value.length,3)
  view.state.directoryCache.value={'/':view.state.entries.value,'/etc':[{name:'nginx',type:'directory',path:'/etc/nginx'}]}
  assert.equal(view.state.directoryTree.value[0].children[0].children[0].path,'/etc/nginx')
 }finally{view.destroy()}
})
