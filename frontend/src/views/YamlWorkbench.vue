<template>
 <div>
  <div class="kp-toolbar"><strong>YAML 工作台</strong><span class="kp-muted">目标集群：{{clusterLabel}} · 默认命名空间：{{defaultNamespace || '逐项指定'}}</span><span class="spacer"/><el-checkbox v-if="can('apply:force')" v-model="force">强制接管字段</el-checkbox><el-button :disabled="!text || !writable" :loading="working" @click="preflight">服务端预检与差异</el-button><el-button type="primary" :loading="working" :disabled="!writable || !approved" @click="submit">提交 Apply</el-button></div>
  <el-alert v-if="error" type="error" :title="error" :closable="false" style="margin-bottom:12px"/>
  <el-alert v-if="!writable" type="info" title="Apply 需要同时具备创建与编辑权限。" :closable="false" style="margin-bottom:12px"/>
  <el-row :gutter="16"><el-col :xs="24" :lg="14"><label for="workbench-yaml">资源 YAML（支持多文档）</label><textarea id="workbench-yaml" v-model="text" class="kp-yaml" style="min-height:560px;margin-top:8px" spellcheck="false" placeholder="粘贴待提交资源，先运行服务端预检。不会自动填入演示资源。" :readonly="!writable"/></el-col><el-col :xs="24" :lg="10"><div class="kp-card"><h3>预检 / 执行结果</h3><p v-if="!results.length" class="kp-muted">提交前显示每个资源的目标和结果。预检不会修改资源。</p><div v-for="(r,i) in results" :key="i" style="margin:12px 0"><el-tag disable-transitions :type="r.ok ? 'success':'danger'">{{r.ok ? '通过':'失败'}}</el-tag> <strong>{{r.name}}</strong><p>{{r.message || r.operation}}</p></div></div></el-col></el-row>
  <el-collapse v-if="diffs.length" style="margin-top:16px"><el-collapse-item v-for="d in diffs" :key="d.target" :title="d.target"><div class="diff-grid"><div><h4>当前资源</h4><pre>{{d.before}}</pre></div><div><h4>待提交 YAML</h4><pre>{{d.after}}</pre></div></div></el-collapse-item></el-collapse>
 </div>
</template>
<script setup>
import {ref,computed,watch,onMounted,onUnmounted} from 'vue'
import {registerUnsavedGuard} from '../utils/navigation'
import {ElMessage,ElMessageBox} from 'element-plus'
import * as yaml from 'js-yaml'
import api from '../api'
import {store} from '../store'
import {can} from '../utils/perm'
import {assertApplySuccess,createRequestGate} from '../utils/resource'
const writable=computed(()=>can('cluster:create') && can('cluster:update'))
const clusterLabel=computed(()=>store.currentCluster?.name || store.currentClusterId)
const defaultNamespace=computed(()=>store.namespace!=='all' ? store.namespace : '')
const text=ref(''),force=ref(false),working=ref(false),results=ref([]),diffs=ref([]),error=ref(''),approvedText=ref(null),savedText=ref(''),gate=createRequestGate()
const signature=computed(()=>JSON.stringify([text.value,store.currentClusterId,store.namespace,force.value]))
const approved=computed(()=>approvedText.value===signature.value)
watch(signature,()=>{approvedText.value=null;gate.invalidate();working.value=false;results.value=[];diffs.value=[]})
function parse(){const docs=yaml.loadAll(text.value).filter(Boolean);if(!docs.length)throw new Error('请输入 YAML');for(const d of docs)if(!d.apiVersion || !d.kind || !d.metadata?.name)throw new Error('每个资源需要 apiVersion、kind、metadata.name');return docs}
async function preflight(){const id=gate.next(),snapshot=signature.value;working.value=true;error.value='';results.value=[];diffs.value=[];try{const docs=parse();const preview=[];for(const doc of docs){const [group,version]=doc.apiVersion.includes('/') ? doc.apiVersion.split('/') : ['',doc.apiVersion];const meta=store.discovery.find(r=>r.group===group && r.version===version && r.kind===doc.kind && !r.plural.includes('/'));if(!meta)throw new Error(`无法从当前集群发现 ${doc.apiVersion}/${doc.kind}`);const ns=meta.namespaced ? doc.metadata.namespace || defaultNamespace.value : '_all';if(meta.namespaced && !ns)throw new Error(`${doc.kind}/${doc.metadata.name} 必须指定命名空间`);let current;try{current=await api.get(group,version,meta.plural,ns,doc.metadata.name)}catch(e){if(e.status!==404)throw e}preview.push({target:`${clusterLabel.value} · ${ns} · ${doc.kind}/${doc.metadata.name}`,before:current ? yaml.dump(current,{noRefs:true}) : '资源不存在，将创建',after:yaml.dump(doc,{noRefs:true})})}const data=await api.apply(text.value,{dryRun:true,force:force.value,defaultNamespace:defaultNamespace.value || undefined});if(!gate.current(id))return;diffs.value=preview;results.value=data.results || [];assertApplySuccess(data);approvedText.value=snapshot;ElMessage.success('服务端预检通过，请展开核对差异后提交')}catch(e){if(gate.current(id))error.value=e.message || '预检失败'}finally{if(gate.current(id))working.value=false}}
async function submit(){if(!approved.value || !writable.value)return;const snapshot=signature.value;try{await ElMessageBox.confirm(`集群 ${clusterLabel.value} · 默认命名空间 ${defaultNamespace.value || '逐项指定'}\n将提交 ${results.value.length} 个资源${force.value ? '，并强制接管字段' : ''}，确认继续？`,'提交 Apply',{type:'warning'})}catch{return}if(snapshot!==signature.value)return;working.value=true;error.value='';try{const data=await api.apply(text.value,{dryRun:false,force:force.value,defaultNamespace:defaultNamespace.value || undefined});results.value=data.results || [];assertApplySuccess(data);savedText.value=text.value;ElMessage.success(`已完成 ${results.value.length} 个资源`)}catch(e){error.value=e.status===409 ? '资源冲突，当前编辑内容已保留。重新读取并预检后提交。' : e.message || '提交失败'}finally{approvedText.value=null;working.value=false}}
const removeGuard=registerUnsavedGuard(async()=>{if(working.value)return false;if(text.value===savedText.value)return true;try{await ElMessageBox.confirm('YAML 尚未提交，确定离开并丢弃编辑？','未保存的修改',{type:'warning'});text.value='';savedText.value='';return true}catch{return false}})
function beforeUnload(e){if(text.value!==savedText.value){e.preventDefault();e.returnValue=''}}
onMounted(()=>window.addEventListener('beforeunload',beforeUnload));onUnmounted(()=>{removeGuard();gate.invalidate();window.removeEventListener('beforeunload',beforeUnload)})
</script>
<style scoped>.diff-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.diff-grid pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:500px;overflow:auto;padding:12px;background:#f1f5f9}@media(max-width:800px){.diff-grid{grid-template-columns:1fr}}</style>
