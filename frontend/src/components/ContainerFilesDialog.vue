<template>
 <el-dialog :model-value="modelValue" title="文件浏览器" width="min(1100px,96vw)" top="4vh" :before-close="beforeClose" @update:model-value="value=>{if(!busy)emit('update:modelValue',value)}">
  <p class="kp-mono">{{target?.namespace}} / {{target?.pod}} · {{target?.container}}</p>
  <div class="kp-toolbar"><el-button :disabled="busy" @click="up">上级</el-button><el-input v-model="pathInput" aria-label="容器路径" style="flex:1;max-width:none" @keyup.enter="browse(pathInput)"/><el-button :loading="busy" @click="browse(pathInput)">打开</el-button><el-button v-if="writable" :disabled="busy" @click="mkdir">新建目录</el-button><el-button v-if="writable" :disabled="busy" @click="uploadInput.click()">上传文件</el-button><input ref="uploadInput" type="file" hidden @change="upload"/></div>
  <el-alert v-if="error" :title="error" type="error" :closable="false"/>
  <el-alert v-if="truncated" title="仅显示前 200 项" type="warning" :closable="false"/>
  <el-table :data="entries" v-loading="busy" height="45vh" @row-dblclick="row=>row.type==='directory'&&browse(row.path)"><el-table-column label="名称" min-width="230"><template #default="{row}"><el-button v-if="row.type==='directory'" link type="primary" @click="browse(row.path)">{{row.name}} /</el-button><span v-else>{{row.name}}</span></template></el-table-column><el-table-column prop="type" label="类型" width="110"/><el-table-column label="操作" width="240"><template #default="{row}"><el-button v-if="row.type==='file'" link :disabled="busy" @click="read(row,false)">下载</el-button><el-button v-if="row.type==='file'&&writable" link :disabled="busy" @click="read(row,true)">编辑</el-button><el-button v-if="writable" type="danger" link :disabled="busy" @click="remove(row)">删除</el-button></template></el-table-column></el-table>
  <template #footer><el-button :disabled="busy" @click="close">关闭</el-button></template>
  <el-dialog v-model="editorOpen" title="编辑文件" width="min(900px,94vw)" append-to-body :before-close="closeEditor"><p class="kp-mono">{{editingPath}}</p><el-input v-model="fileText" type="textarea" :rows="16" aria-label="文件内容" :disabled="busy"/><template #footer><el-button :disabled="busy" @click="closeEditor(()=>editorOpen=false)">取消</el-button><el-button type="primary" :loading="busy" @click="saveFile">保存文件</el-button></template></el-dialog>
 </el-dialog>
</template>
<script setup>
import {ref,watch,onUnmounted} from 'vue'
import {ElMessage,ElMessageBox} from 'element-plus'
import api from '../api'
import {can} from '../utils/perm'
import {registerUnsavedGuard} from '../utils/navigation'
const props=defineProps({modelValue:Boolean,target:Object}),emit=defineEmits(['update:modelValue'])
const writable=can('pod:files:write'),pathInput=ref('/'),directory=ref('/'),entries=ref([]),truncated=ref(false),error=ref(''),busy=ref(false),uploadInput=ref(null),editorOpen=ref(false),editingPath=ref(''),fileText=ref(''),originalText=ref('')
let epoch=0,controller
const removeGuard=registerUnsavedGuard(async()=>!props.modelValue || (!busy.value&&await discard()))
onUnmounted(()=>{epoch++;controller?.abort();removeGuard()})
async function discard(){if(!editorOpen.value||fileText.value===originalText.value)return true;try{await ElMessageBox.confirm('文件尚未保存，确定放弃修改？','未保存的修改');return true}catch{return false}}
async function beforeClose(done){if(!busy.value&&await discard())done()}
async function close(){if(!busy.value&&await discard())emit('update:modelValue',false)}
async function closeEditor(done){if(!busy.value&&await discard())done()}
watch(()=>props.modelValue,open=>{epoch++;controller?.abort();entries.value=[];error.value='';editorOpen.value=false;if(open){directory.value='/';pathInput.value='/';browse('/')}})
async function request(body){controller?.abort();controller=new AbortController();return api.containerFile({...props.target,...body},{signal:controller.signal,params:{clusterId:props.target.clusterId}})}
async function work(fn){if(busy.value)return;busy.value=true;error.value='';try{await fn();return true}catch(e){if(!e.cancelled)error.value=e.message||'文件操作失败';return false}finally{busy.value=false}}
function browse(path){return work(async()=>{const id=epoch,result=await request({action:'list',path});if(id!==epoch)return;directory.value=result.path;pathInput.value=result.path;entries.value=result.entries||[];truncated.value=!!result.truncated})}
function up(){const path=directory.value.replace(/\/[^/]+\/?$/,'')||'/';browse(path)}
function saveBlob(bytes,name){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([bytes]));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function decode(base64){return Uint8Array.from(atob(base64),c=>c.charCodeAt(0))}
function base64(bytes){let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value)}
function read(row,edit){return work(async()=>{const id=epoch,data=await request({action:'read',path:row.path});if(id!==epoch)return;const bytes=decode(data.base64);if(!edit){saveBlob(bytes,row.name);return}let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(text.includes('\0'))throw new Error()}catch{throw new Error('该文件不是 UTF-8 文本，请下载后处理')}editingPath.value=row.path;fileText.value=text;originalText.value=text;editorOpen.value=true})}
async function confirm(message){try{await ElMessageBox.confirm(message,'确认文件变更',{type:'warning',confirmButtonText:'确认执行'});return true}catch{return false}}
async function saveFile(){if(!await confirm(`保存 ${editingPath.value}，将替换容器内文件内容。`))return;await work(async()=>{await request({action:'write',path:editingPath.value,base64:base64(new TextEncoder().encode(fileText.value)),overwrite:true,confirmed:true});originalText.value=fileText.value;editorOpen.value=false;ElMessage.success('文件已保存')});if(!editorOpen.value)browse(directory.value)}
async function mkdir(){let name;try{name=(await ElMessageBox.prompt('目录名称','新建目录',{inputValidator:value=>!!value&&!/[\/\\\x00-\x1f]/.test(value)&&!['.','..'].includes(value)||'请输入单个目录名称'})).value}catch{return}const ok=await work(()=>request({action:'mkdir',path:(directory.value==='/'?'':directory.value)+'/'+name,confirmed:true}));if(ok)browse(directory.value)}
async function remove(row){if(!await confirm(`删除 ${row.path}？目录只允许删除空目录。`))return;const ok=await work(()=>request({action:'delete',path:row.path,confirmed:true}));if(ok)browse(directory.value)}
async function upload(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;if(file.size>1024*1024){error.value='文件不能超过 1 MiB';return}if(!file.name||/[\/\\\x00-\x1f]/.test(file.name)){error.value='文件名称无效';return}const path=(directory.value==='/'?'':directory.value)+'/'+file.name;const overwrite=entries.value.some(entry=>entry.name===file.name);if(!await confirm(`上传到 ${path}${overwrite?'，将覆盖同名文件':''}？`))return;const ok=await work(async()=>request({action:'write',path,base64:base64(new Uint8Array(await file.arrayBuffer())),overwrite,confirmed:true}));if(ok)browse(directory.value)}
</script>
