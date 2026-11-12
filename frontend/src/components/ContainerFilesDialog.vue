<template>
 <el-dialog :model-value="modelValue" class="container-files-dialog" title="文件浏览器" width="min(1540px,96vw)" top="3vh" :before-close="beforeClose" @update:model-value="value=>{if(!busy)emit('update:modelValue',value)}">
  <div class="files-context"><div class="files-target"><el-tag effect="plain">{{target?.clusterId}}</el-tag><span>/</span><el-tag effect="plain">{{target?.namespace}}</el-tag><span>/</span><el-tag effect="plain">{{target?.pod}}</el-tag><span>/</span><el-tag effect="plain">{{target?.container}}</el-tag></div><span class="kp-muted">文本编码：UTF-8</span></div>
  <div class="files-workspace">
   <aside class="files-tree-panel" aria-label="容器目录导航"><div class="files-panel-title"><el-icon><FolderOpened /></el-icon>目录</div><el-tree :data="directoryTree" node-key="path" :current-node-key="directory" :props="{label:'name',children:'children'}" highlight-current default-expand-all :expand-on-click-node="false" empty-text="暂无目录" @node-click="node=>browse(node.path)"><template #default="{data}"><span class="files-tree-node" :title="data.path"><el-icon><component :is="data.path==='/'?HomeFilled:Folder" /></el-icon><span>{{data.name}}</span></span></template></el-tree></aside>
   <section class="files-list-panel" aria-label="容器文件列表">
    <div class="files-pathbar"><el-button :icon="HomeFilled" :disabled="busy" aria-label="根目录" title="根目录" @click="browse('/')"/><el-button :icon="Back" :disabled="busy||directory==='/'" @click="up">上级</el-button><el-input v-model="pathInput" aria-label="容器路径" @keyup.enter="browse(pathInput)"/><el-button :loading="busy" @click="browse(pathInput)">打开</el-button><el-button :icon="Refresh" :disabled="busy" aria-label="刷新目录" title="刷新目录" @click="browse(directory)"/></div>
    <nav class="files-breadcrumbs" aria-label="当前目录"><el-button link :disabled="busy" @click="browse('/')">根目录</el-button><template v-for="item in breadcrumbs" :key="item.path"><span>/</span><el-button link :disabled="busy" @click="browse(item.path)">{{item.name}}</el-button></template></nav>
    <div class="files-tools"><el-input v-model="filterText" :prefix-icon="Search" placeholder="当前文件夹内按名称过滤" aria-label="按文件名过滤" clearable/><el-checkbox v-model="showHidden">显示隐藏文件</el-checkbox><span class="files-tools-spacer"/><div v-if="writable" class="files-create-actions"><el-button :icon="DocumentAdd" :disabled="busy" @click="createFile">创建文件</el-button><el-button :icon="FolderAdd" :disabled="busy" @click="mkdir">创建文件夹</el-button><el-button type="primary" :icon="Upload" :disabled="busy" @click="uploadInput.click()">上传文件</el-button></div><input ref="uploadInput" type="file" hidden @change="upload"/></div>
    <div v-if="uploadState" class="transfer-progress" role="status" aria-label="文件上传进度"><div><span>{{uploadLabel}} · {{formatTransferBytes(uploadLoaded)}} / {{formatTransferBytes(uploadTotal)}}</span><el-button v-if="uploadState==='uploading'" link type="danger" @click="cancelUpload">取消上传</el-button></div><el-progress :percentage="uploadPercent" :status="uploadState==='done'?'success':uploadState==='error'?'exception':undefined"/></div>
    <el-alert v-if="downloadNotice" :title="downloadNotice" type="info" :closable="false"/>
    <el-alert v-if="error" :title="error" type="error" :closable="false"/>
    <el-alert v-if="truncated" title="当前目录仅返回前 200 项，名称过滤仅覆盖已加载项目；可输入完整路径访问其他目录。" type="warning" :closable="false"/>
    <el-table :data="pagedEntries" v-loading="busy" height="min(54vh,600px)" @row-dblclick="row=>row.type==='directory'&&browse(row.path)" empty-text="没有匹配的文件">
     <el-table-column label="文件名" min-width="210" show-overflow-tooltip><template #default="{row}"><div class="files-name"><el-icon :class="{'files-folder':row.type==='directory'}"><component :is="row.type==='directory'?Folder:row.type==='link'?Link:Document"/></el-icon><el-button v-if="row.type==='directory'" link :disabled="busy" @click="browse(row.path)">{{row.name}}</el-button><span v-else>{{row.name}}</span><el-tag v-if="row.type==='link'" size="small" type="info">链接</el-tag></div></template></el-table-column>
     <el-table-column label="属性" width="120"><template #default="{row}"><span class="files-mono">{{row.permissions||'—'}}</span></template></el-table-column>
     <el-table-column label="Owner" width="85" show-overflow-tooltip><template #default="{row}">{{row.owner||'—'}}</template></el-table-column>
     <el-table-column label="Group" width="85" show-overflow-tooltip><template #default="{row}">{{row.group||'—'}}</template></el-table-column>
     <el-table-column label="文件大小" width="100" align="right"><template #default="{row}">{{row.size==null?'—':formatTransferBytes(row.size)}}</template></el-table-column>
     <el-table-column label="更新时间" width="170"><template #default="{row}">{{formatModified(row.modifiedAt)}}</template></el-table-column>
     <el-table-column label="操作" width="175" fixed="right" align="right"><template #default="{row}"><el-button v-if="row.type==='directory'" link type="primary" :disabled="busy" @click="browse(row.path)">进入</el-button><el-button v-if="row.type==='file'&&writable" link type="primary" :disabled="busy" @click="read(row,true)">编辑</el-button><el-button v-if="row.type==='file'" link type="primary" :disabled="busy" @click="read(row,false)">下载</el-button><el-button v-if="writable" type="danger" link :disabled="busy" @click="remove(row)">删除</el-button></template></el-table-column>
    </el-table>
    <div class="files-pagination"><span class="kp-muted">{{filteredEntries.length}} 项<span v-if="filterText"> / 共 {{entries.length}} 项</span></span><el-pagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[20,50,100]" :total="filteredEntries.length" layout="sizes, prev, pager, next" small/></div>
   </section>
  </div>
  <template #footer><div class="files-footer"><span class="kp-muted transfer-limits">上传、下载单个文件最大 5 GiB；在线编辑最大 1 MiB。</span><el-button :disabled="busy" @click="close">关闭</el-button></div></template>
  <el-dialog v-model="editorOpen" title="编辑文件" width="min(900px,94vw)" append-to-body :before-close="closeEditor"><p class="kp-mono">{{editingPath}}</p><p class="kp-muted transfer-limits">在线编辑最大 1 MiB；较大文件请下载后修改，再上传。</p><el-alert v-if="error" :title="error" type="error" :closable="false"/><el-input v-model="fileText" type="textarea" :rows="16" aria-label="文件内容" :disabled="busy"/><template #footer><el-button :disabled="busy" @click="closeEditor(()=>editorOpen=false)">取消</el-button><el-button type="primary" :loading="busy" @click="saveFile">保存文件</el-button></template></el-dialog>
 </el-dialog>
</template>
<script setup>
import {ref,computed,watch,onUnmounted} from 'vue'
import {ElMessage,ElMessageBox} from 'element-plus'
import {FolderOpened,Folder,HomeFilled,Back,Refresh,Search,DocumentAdd,FolderAdd,Upload,Link,Document} from '@element-plus/icons-vue'
import api from '../api'
import {can} from '../utils/perm'
import {registerUnsavedGuard} from '../utils/navigation'
import {validateUpload,startNativeDownload,formatTransferBytes,MAX_EDIT_BYTES,MAX_TRANSFER_BYTES} from '../utils/container-transfer'
const props=defineProps({modelValue:Boolean,target:Object}),emit=defineEmits(['update:modelValue'])
const writable=can('pod:files:write'),pathInput=ref('/'),directory=ref('/'),entries=ref([]),truncated=ref(false),error=ref(''),busy=ref(false),uploadInput=ref(null),editorOpen=ref(false),editingPath=ref(''),fileText=ref(''),originalText=ref('')
const filterText=ref(''),showHidden=ref(false),page=ref(1),pageSize=ref(20),directoryCache=ref({})
const filteredEntries=computed(()=>entries.value.filter(row=>(showHidden.value||!row.name.startsWith('.'))&&row.name.toLowerCase().includes(filterText.value.trim().toLowerCase())).sort((a,b)=>Number(b.type==='directory')-Number(a.type==='directory')||a.name.localeCompare(b.name)))
const pagedEntries=computed(()=>filteredEntries.value.slice((page.value-1)*pageSize.value,page.value*pageSize.value))
const breadcrumbs=computed(()=>{let path='';return directory.value.split('/').filter(Boolean).map(name=>({name,path:path+='/'+name}))})
const directoryTree=computed(()=>{
 const nodes=new Map([['/',{name:'/',path:'/',children:[]}]])
 const ensure=path=>{if(nodes.has(path))return nodes.get(path);const parent=path.slice(0,path.lastIndexOf('/'))||'/';const node={name:path.slice(path.lastIndexOf('/')+1),path,children:[]};nodes.set(path,node);ensure(parent).children.push(node);return node}
 for(const path of Object.keys(directoryCache.value)){ensure(path);for(const row of directoryCache.value[path])if(row.type==='directory'&&(showHidden.value||!row.name.startsWith('.')))ensure(row.path)}
 ensure(directory.value)
 return [nodes.get('/')]
})
watch([filterText,showHidden,pageSize],()=>{page.value=1})
function formatModified(value){const d=new Date(value);return value&&!Number.isNaN(d.getTime())?d.toLocaleString('zh-CN',{hour12:false}):'—'}
async function createFile(){
 const id=epoch;let name;try{name=(await ElMessageBox.prompt('文件名称','创建文件',{inputValidator:value=>!!value&&!/[\/\\\x00-\x1f]/.test(value)&&!['.','..'].includes(value)||'请输入单个文件名称'})).value}catch{return}
 if(id!==epoch||!props.modelValue||busy.value)return
 const path=(directory.value==='/'?'':directory.value)+'/'+name
 const ok=await work(()=>request({action:'write',path,base64:'',overwrite:false,confirmed:true}));if(ok&&id===epoch)browse(directory.value)
}
const uploadState=ref(''),uploadLoaded=ref(0),uploadTotal=ref(0),downloadNotice=ref('')
const uploadPercent=computed(()=>uploadTotal.value ? Math.min(100,Math.floor(uploadLoaded.value/uploadTotal.value*100)) : uploadState.value==='done' ? 100 : 0)
const uploadLabel=computed(()=>uploadState.value==='done'?'上传完成':uploadState.value==='cancelled'?'上传已取消':uploadState.value==='error'?'上传失败':uploadLoaded.value>=uploadTotal.value?'已发送全部数据，等待服务器确认':'正在上传')
let epoch=0,controller
const removeGuard=registerUnsavedGuard(async()=>!props.modelValue || (!busy.value&&await discard()))
onUnmounted(()=>{epoch++;controller?.abort();removeGuard()})
async function discard(){if(!editorOpen.value||fileText.value===originalText.value)return true;try{await ElMessageBox.confirm('文件尚未保存，确定放弃修改？','未保存的修改');return true}catch{return false}}
async function beforeClose(done){if(!busy.value&&await discard())done()}
async function close(){if(!busy.value&&await discard())emit('update:modelValue',false)}
async function closeEditor(done){if(!busy.value&&await discard())done()}
watch(()=>props.modelValue,open=>{epoch++;controller?.abort();busy.value=false;entries.value=[];directoryCache.value={};filterText.value='';showHidden.value=false;page.value=1;error.value='';editorOpen.value=false;uploadState.value='';downloadNotice.value='';if(open){directory.value='/';pathInput.value='/';browse('/')}})
async function request(body){controller?.abort();controller=new AbortController();return api.containerFile({...props.target,...body},{signal:controller.signal,params:{clusterId:props.target.clusterId}})}
async function work(fn){if(busy.value)return;const id=epoch;busy.value=true;error.value='';try{await fn();return id===epoch}catch(e){if(id===epoch&&!e.cancelled)error.value=e.message||'文件操作失败';return false}finally{if(id===epoch)busy.value=false}}
function browse(path){return work(async()=>{const id=epoch,result=await request({action:'list',path});if(id!==epoch)return;directory.value=result.path;pathInput.value=result.path;entries.value=result.entries||[];directoryCache.value={...directoryCache.value,[result.path]:entries.value};filterText.value='';page.value=1;truncated.value=!!result.truncated})}
function up(){const path=directory.value.replace(/\/[^/]+\/?$/,'')||'/';browse(path)}
function decode(base64){return Uint8Array.from(atob(base64),c=>c.charCodeAt(0))}
function base64(bytes){let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value)}
function read(row,edit){return work(async()=>{
 const id=epoch
 if(!edit){
  controller?.abort();controller=new AbortController();downloadNotice.value=''
  const result=await api.containerDownloadTicket({...props.target,path:row.path},{signal:controller.signal,params:{clusterId:props.target.clusterId}})
  if(id!==epoch||!props.modelValue)return
  if(!Number.isSafeInteger(result.bytes)||result.bytes<0||result.bytes>MAX_TRANSFER_BYTES)throw new Error('下载文件不能超过 5 GiB')
  startNativeDownload(result.url,row.name)
  downloadNotice.value='已交给浏览器下载，请在浏览器下载管理器查看进度或取消。'
  return
 }
 const data=await request({action:'read',path:row.path});if(id!==epoch)return
 const bytes=decode(data.base64);if(bytes.length>MAX_EDIT_BYTES)throw new Error('在线编辑仅支持 1 MiB 以内的文件，请使用下载或上传。')
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(text.includes('\0'))throw new Error()}catch{throw new Error('该文件不是 UTF-8 文本，请下载后处理')}
 editingPath.value=row.path;fileText.value=text;originalText.value=text;editorOpen.value=true
})}
async function confirm(message){try{await ElMessageBox.confirm(message,'确认文件变更',{type:'warning',confirmButtonText:'确认执行'});return true}catch{return false}}
async function saveFile(){const bytes=new TextEncoder().encode(fileText.value),id=epoch;if(bytes.length>MAX_EDIT_BYTES){error.value='在线编辑仅支持 1 MiB 以内的文件，请使用下载或上传。';return}if(!await confirm(`保存 ${editingPath.value}，将替换容器内文件内容。`))return;if(id!==epoch||!props.modelValue)return;await work(async()=>{await request({action:'write',path:editingPath.value,base64:base64(bytes),overwrite:true,confirmed:true});if(id!==epoch)return;originalText.value=fileText.value;editorOpen.value=false;ElMessage.success('文件已保存')});if(id===epoch&&!editorOpen.value)browse(directory.value)}
async function mkdir(){const id=epoch;let name;try{name=(await ElMessageBox.prompt('目录名称','新建目录',{inputValidator:value=>!!value&&!/[\/\\\x00-\x1f]/.test(value)&&!['.','..'].includes(value)||'请输入单个目录名称'})).value}catch{return}if(id!==epoch||!props.modelValue)return;const ok=await work(()=>request({action:'mkdir',path:(directory.value==='/'?'':directory.value)+'/'+name,confirmed:true}));if(ok)browse(directory.value)}
async function remove(row){const id=epoch;if(!await confirm(`删除 ${row.path}？目录只允许删除空目录。`))return;if(id!==epoch||!props.modelValue)return;const ok=await work(()=>request({action:'delete',path:row.path,confirmed:true}));if(ok)browse(directory.value)}
function cancelUpload(){if(uploadState.value==='uploading')controller?.abort()}
async function upload(event){
 const file=event.target.files?.[0];event.target.value='';if(!file||busy.value)return
 try{validateUpload(file)}catch(e){error.value=e.message;return}
 const id=epoch,target={...props.target},folder=directory.value,path=(folder==='/'?'':folder)+'/'+file.name
 const overwrite=entries.value.some(entry=>entry.name===file.name)
 if(!await confirm(`上传到 ${path}${overwrite?'，将覆盖同名文件':''}？`))return
 if(id!==epoch||!props.modelValue)return
 const ok=await work(async()=>{
  controller?.abort();controller=new AbortController();uploadLoaded.value=0;uploadTotal.value=file.size;uploadState.value='uploading'
  try{
   const result=await api.containerUpload({...target,path,overwrite,confirmed:true},file,{signal:controller.signal,onProgress:progress=>{if(id===epoch)uploadLoaded.value=progress.loaded}})
   if(id!==epoch)return
   if(result.ok!==true||result.bytes!==file.size)throw new Error('服务器未确认完整文件，请刷新后重试')
   uploadLoaded.value=file.size;uploadState.value='done';ElMessage.success('文件上传完成')
  }catch(e){if(id===epoch)uploadState.value=e.cancelled?'cancelled':'error';throw e}
 })
 if(ok)browse(folder)
}
</script>
<style scoped>
.files-context,.files-target{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.files-context{justify-content:space-between;margin:2px 0 20px}.files-target{min-width:0;gap:8px}.files-target .el-tag{max-width:380px;height:auto;min-height:26px;white-space:normal;overflow-wrap:anywhere}.files-workspace{display:grid;grid-template-columns:230px minmax(0,1fr);gap:16px}.files-tree-panel,.files-list-panel{border:1px solid var(--kp-border);border-radius:12px;background:var(--kp-surface);min-width:0}.files-tree-panel{padding:14px 8px;max-height:74vh;overflow:auto}.files-panel-title{display:flex;align-items:center;gap:8px;font-weight:600;padding:0 10px 14px}.files-tree-node{display:flex;align-items:center;gap:8px;min-width:0;font-size:13px}.files-tree-node>span{overflow:hidden;text-overflow:ellipsis}.files-tree-panel :deep(.el-tree-node__content){height:32px}.files-list-panel{padding:16px}.files-pathbar{display:flex;align-items:center;gap:8px}.files-pathbar>.el-input{flex:1;min-width:80px}.files-pathbar .el-button+.el-button{margin-left:0}.files-breadcrumbs{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:38px;margin-bottom:8px;overflow-wrap:anywhere}.files-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}.files-tools>.el-input{width:260px}.files-tools-spacer{flex:1}.files-create-actions{display:flex;gap:8px}.files-create-actions .el-button+.el-button{margin:0}.files-name{display:flex;align-items:center;gap:8px;min-width:0}.files-name>.el-icon{flex:none;color:var(--kp-muted);font-size:17px}.files-name>.files-folder{color:var(--kp-brand)}.files-name>.el-button{overflow:hidden;min-width:0;max-width:100%;height:auto;line-height:1.5}.files-name>.el-button :deep(span){overflow:hidden;text-overflow:ellipsis}.files-name>span{overflow:hidden;text-overflow:ellipsis}.files-mono{font-family:var(--kp-font-mono,monospace);font-size:12px}.files-pagination{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:16px;flex-wrap:wrap}.files-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left}.transfer-limits{font-size:12px;margin:0}.transfer-progress{margin:12px 0 16px}.transfer-progress>div:first-child{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;overflow-wrap:anywhere}
@media(max-width:1000px){.files-workspace{grid-template-columns:180px minmax(0,1fr)}.files-list-panel{padding:12px}.files-tools-spacer{display:none}}
@media(max-width:700px){.files-workspace{grid-template-columns:minmax(0,1fr)}.files-tree-panel{display:none}.files-context{gap:8px;margin-bottom:12px}.files-target .el-tag{max-width:210px}.files-pathbar{flex-wrap:wrap}.files-pathbar>.el-input{order:1;flex-basis:100%}.files-tools>.el-input{width:100%}.files-create-actions{flex-wrap:wrap}.files-list-panel{padding:10px}.files-footer{align-items:flex-start}.files-pagination :deep(.el-pagination__sizes){display:none}}
</style>
