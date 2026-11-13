<template>
 <div class="storage-details">
  <section class="kp-card storage-detail-card"><h2>基本信息</h2><dl class="storage-facts"><template v-for="(value,key) in identity" :key="key"><dt>{{key}}</dt><dd>{{value}}</dd></template></dl>
   <div v-if="Object.keys(resource.metadata?.labels||{}).length" class="storage-labels"><span>标签</span><el-tag v-for="(value,key) in resource.metadata.labels" :key="key" effect="plain">{{key}} = {{value}}</el-tag></div>
   <details class="storage-more"><summary>更多细节</summary><dl class="storage-facts"><dt>UID</dt><dd>{{resource.metadata?.uid||'—'}}</dd><dt>资源版本</dt><dd>{{resource.metadata?.resourceVersion||'—'}}</dd><dt>保护标记</dt><dd>{{(resource.metadata?.finalizers||[]).join('、')||'无'}}</dd></dl><h3>注解</h3><dl class="storage-annotations"><template v-for="(value,key) in resource.metadata?.annotations||{}" :key="key"><dt>{{key}}</dt><dd>{{value}}</dd></template></dl><p v-if="!Object.keys(resource.metadata?.annotations||{}).length" class="kp-muted">无注解</p></details>
  </section>
  <section class="kp-card storage-detail-card"><h2>{{resourceTitle(resource)}}配置</h2><dl class="storage-facts"><template v-for="[key,value] in facts" :key="key"><dt>{{key}}</dt><dd><RouterLink v-if="key==='绑定持久卷'&&relation" :to="relationPath">{{value}}</RouterLink><RouterLink v-else-if="key==='存储类'&&resource.spec?.storageClassName" :to="classPath">{{value}}</RouterLink><span v-else>{{value}}</span></dd></template></dl>
   <template v-if="resource.kind==='StorageClass'"><h3>供给器参数</h3><dl class="storage-facts"><template v-for="(value,key) in resource.parameters||{}" :key="key"><dt>{{key}}</dt><dd>{{value}}</dd></template></dl><p v-if="!Object.keys(resource.parameters||{}).length" class="kp-muted">无参数</p></template>
   <el-table v-if="resource.status?.conditions?.length" :data="resource.status.conditions" size="small"><el-table-column prop="type" label="条件"/><el-table-column prop="status" label="状态"/><el-table-column prop="reason" label="原因"/><el-table-column prop="message" label="说明" min-width="240"/></el-table>
  </section>
  <section v-if="resource.kind==='PersistentVolume'" class="kp-card storage-detail-card"><h2>卷源类型</h2><dl class="storage-facts"><template v-for="[key,value] in volumeSourceRows(resource)" :key="key"><dt>{{key}}</dt><dd>{{value}}</dd></template></dl></section>
  <section v-if="resource.kind!=='StorageClass'" class="kp-card storage-detail-card" v-loading="relatedLoading"><div class="storage-section-head"><h2>{{resource.kind==='PersistentVolumeClaim'?'关联持久卷':'绑定的持久卷声明'}}</h2><el-button v-if="relation" link type="primary" @click="loadRelated">刷新关联资源</el-button></div>
   <p v-if="!relation" class="kp-muted">{{resource.kind==='PersistentVolumeClaim'?'尚未绑定持久卷':'尚未绑定存储声明'}}</p>
   <template v-else><RouterLink :to="relationPath">{{relation.namespace==='_all'?'':relation.namespace+' / '}}{{relation.name}}</RouterLink><el-alert v-if="relatedError" :title="relatedError" type="warning" :closable="false"/>
    <template v-else-if="related"><dl class="storage-facts"><template v-for="[key,value] in storageFacts(related)" :key="key"><dt>{{key}}</dt><dd>{{value}}</dd></template></dl><template v-if="related.kind==='PersistentVolume'"><h3>卷源类型</h3><dl class="storage-facts"><template v-for="[key,value] in volumeSourceRows(related)" :key="key"><dt>{{key}}</dt><dd>{{value}}</dd></template></dl></template></template>
   </template>
  </section>
  <section class="kp-card storage-detail-card"><h2>关联事件</h2><el-alert v-if="eventsError" :title="eventsError" type="warning" :closable="false"/><el-table v-else :data="events" size="small" v-loading="eventsLoading"><el-table-column prop="reason" label="原因" min-width="130"/><el-table-column label="时间" min-width="160"><template #default="{row}">{{fmtTime(row.lastTimestamp||row.eventTime)}}</template></el-table-column><el-table-column prop="count" label="次数" width="70"/><el-table-column prop="message" label="消息" min-width="240"/><template #empty>暂无关联事件</template></el-table></section>
 </div>
</template>
<script setup>
import {ref,computed,watch,onUnmounted} from 'vue'
import api from '../api'
import {canResource} from '../utils/perm'
import {cpath} from '../utils/path'
import {fmtTime} from '../config/columns'
import {resourceTitle} from '../utils/resource-ui'
import {storageFacts,volumeSourceRows,storageRelation} from '../utils/storage-detail'
const props=defineProps({resource:{type:Object,required:true},clusterId:String,clusterName:String,events:{type:Array,default:()=>[]},eventsLoading:Boolean,eventsError:String})
const related=ref(null),relatedLoading=ref(false),relatedError=ref('')
const relation=computed(()=>storageRelation(props.resource)),facts=computed(()=>storageFacts(props.resource))
const identity=computed(()=>({'集群':props.clusterName||'当前集群','名称':props.resource.metadata?.name||'—',...(props.resource.metadata?.namespace?{'命名空间':props.resource.metadata.namespace}:{}),'创建时间':fmtTime(props.resource.metadata?.creationTimestamp),'资源类型':resourceTitle(props.resource)}))
const relationPath=computed(()=>relation.value?cpath(`/r/_core/v1/${relation.value.plural}/${encodeURIComponent(relation.value.namespace)}/${encodeURIComponent(relation.value.name)}`,props.clusterId):'')
const classPath=computed(()=>cpath('/r/storage.k8s.io/v1/storageclasses/_all/'+encodeURIComponent(props.resource.spec?.storageClassName||''),props.clusterId))
let epoch=0
async function loadRelated(){
 const request=++epoch,target=relation.value;related.value=null;relatedError.value='';relatedLoading.value=false
 if(!target)return
 if(!canResource({group:'',plural:target.plural,kind:target.kind,namespaced:target.kind==='PersistentVolumeClaim'},'detail',target.namespace==='_all'?undefined:target.namespace,props.clusterId)){relatedError.value='当前账号无权查看关联资源';return}
 relatedLoading.value=true
 try{const value=await api.get('','v1',target.plural,target.namespace,target.name,{params:{clusterId:props.clusterId},silent:true});if(request!==epoch)return
  if(target.uid&&value.metadata?.uid!==target.uid)throw new Error('绑定引用与当前资源身份不一致，请刷新后核对')
  const claim=value.spec?.claimRef
  if(props.resource.kind==='PersistentVolumeClaim'&&claim?.uid&&claim.uid!==props.resource.metadata?.uid)throw new Error('该持久卷已指向其他存储声明，请核对绑定状态')
  related.value=value
 }catch(e){if(request===epoch)relatedError.value=e.status===404?'关联资源不存在或已删除':e.status===403?'当前账号无权查看关联资源':e.message||'关联资源加载失败'}finally{if(request===epoch)relatedLoading.value=false}
}
watch(()=>[props.clusterId,props.resource.metadata?.uid,props.resource.metadata?.resourceVersion,JSON.stringify(relation.value)],loadRelated,{immediate:true})
onUnmounted(()=>epoch++)
</script>
<style scoped>
.storage-details{display:grid;gap:18px}.storage-detail-card{min-width:0;padding:22px}.storage-detail-card h2{font-size:16px;color:var(--kp-text);margin:0 0 20px;font-weight:600}.storage-detail-card h3{font-size:14px;margin:22px 0 14px}.storage-facts{display:grid;grid-template-columns:140px minmax(0,1fr) 140px minmax(0,1fr);margin:16px 0 0;border-top:1px solid var(--kp-border)}.storage-facts dt,.storage-facts dd{padding:12px 14px;border-bottom:1px solid var(--kp-border);margin:0;font-size:14px;overflow-wrap:anywhere;line-height:1.65}.storage-facts dt{background:#f7f9fc;color:var(--kp-muted)}.storage-facts dd{color:var(--kp-text)}.storage-more{margin-top:20px}.storage-more summary{cursor:pointer;color:var(--kp-brand);font-size:14px}.storage-annotations{display:grid;grid-template-columns:minmax(160px,1fr) minmax(0,3fr);font-size:13px}.storage-annotations dt,.storage-annotations dd{margin:0;padding:10px;border-bottom:1px solid var(--kp-border);overflow-wrap:anywhere;white-space:pre-wrap}.storage-labels{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:18px}.storage-section-head{display:flex;justify-content:space-between;gap:12px}.storage-details a{color:var(--kp-brand);text-decoration:none}.storage-details a:hover{text-decoration:underline}.storage-details :deep(.el-alert){margin-top:14px}
@media(max-width:1100px){.storage-facts{grid-template-columns:130px minmax(0,1fr)}}@media(max-width:600px){.storage-detail-card{padding:16px}.storage-facts{grid-template-columns:100px minmax(0,1fr)}.storage-facts dt,.storage-facts dd{padding:10px;font-size:13px}.storage-annotations{grid-template-columns:1fr}.storage-section-head{flex-wrap:wrap}}
</style>
