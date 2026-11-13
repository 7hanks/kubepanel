<template>
  <div class="service-form">
    <template v-if="section==='config'">
      <div v-if="serviceType!=='ExternalName'" class="service-field selector-field">
        <label class="service-field-label">选择器</label>
        <div class="service-field-content">
          <div class="selector-tools">
            <section class="selector-tool manual-tool"><strong>手工添加</strong><div><el-button :icon="Plus" :disabled="disabled" @click="selectorEditor?.add()">添加标签</el-button><span>逐行填写 Pod 的标签</span></div></section>
            <section class="selector-tool import-tool"><strong>从 Pod 导入</strong><div class="pod-import-controls">
              <el-select v-model="selectedPod" filterable clearable placeholder="选择一个 Pod" aria-label="导入选择器的 Pod" :disabled="disabled||!canReadPods" :loading="podsLoading" @visible-change="open=>{if(open&&!pods.length&&!podsLoading)loadPods()}"><el-option v-for="pod in pods" :key="pod.metadata.uid" :label="pod.metadata.name" :value="pod.metadata.uid"/></el-select>
              <el-button :disabled="disabled||!canReadPods||!selectedPod||podsLoading" @click="importPodLabels">导入</el-button>
              <el-button text :icon="Refresh" aria-label="刷新可导入 Pod" :disabled="disabled||!canReadPods" :loading="podsLoading" @click="loadPods()"/>
            </div><p v-if="!canReadPods">当前账号没有读取此命名空间 Pod 的权限</p><p v-else>用所选 Pod 的标签替换选择器</p></section>
          </div>
          <p v-if="podsError" class="service-inline-error" role="alert">{{podsError}}</p>
          <el-button v-if="podCursor" link :disabled="disabled||podsLoading" @click="loadPods(true)">继续加载 Pod</el-button>
          <KeyValueFields :key="selectorVersion" ref="selectorEditor" v-model="spec.selector" class="service-selector-fields" label="选择器" add-label="添加选择器" :disabled="disabled" @change="emit('change')" @validity="value=>emit('validity',value)"/>
        </div>
      </div>
      <div class="service-field"><label class="service-field-label required">服务类型</label><div class="service-field-content"><el-select :model-value="serviceType" :disabled="disabled" aria-label="服务类型" @update:model-value="value=>spec.type=value"><el-option v-for="item in serviceTypes" :key="item.value" :label="item.value" :value="item.value"><span>{{item.value}}</span><small class="type-option-description">{{item.label}}</small></el-option></el-select></div></div>
      <div v-if="serviceType==='ExternalName'" class="service-field"><label class="service-field-label required">外部域名</label><div class="service-field-content"><el-input v-model="spec.externalName" :disabled="disabled" aria-label="外部域名" placeholder="例如 api.example.com"/></div></div>
      <div v-else class="service-field"><label class="service-field-label">集群 IP</label><div class="service-field-content address-line"><span>{{spec.clusterIP||'自动分配'}}</span><el-tag v-for="family in spec.ipFamilies||[]" :key="family" type="info" effect="plain" size="small">{{family}}</el-tag><el-tag v-if="spec.clusterIP==='None'" size="small" effect="plain">Headless</el-tag></div></div>
      <div class="service-field ports-field"><label class="service-field-label">端口</label><div class="service-field-content port-table-scroll">
        <table class="service-port-table" aria-label="服务端口配置">
          <thead><tr><th>名称</th><th>协议</th><th>端口</th><th>目标端口</th><th v-if="nodePortType">节点端口</th><th>应用协议</th><th class="port-action"><el-button :icon="Plus" :disabled="disabled" aria-label="添加服务端口" @click="addPort"/></th></tr></thead>
          <tbody><tr v-for="(port,index) in ports" :key="index">
            <td><el-input v-model="port.name" :disabled="disabled" :aria-label="`服务端口名称 ${index+1}`" placeholder="例如 http"/></td>
            <td><el-select :model-value="port.protocol||'TCP'" :disabled="disabled" :aria-label="`服务端口协议 ${index+1}`" @update:model-value="value=>port.protocol=value"><el-option v-for="value in ['TCP','UDP','SCTP']" :key="value" :label="value" :value="value"/></el-select></td>
            <td><el-input-number v-model="port.port" :min="1" :max="65535" controls-position="right" :disabled="disabled" :aria-label="`服务端口号 ${index+1}`"/></td>
            <td><el-input :model-value="port.targetPort??''" :disabled="disabled" :aria-label="`服务目标端口 ${index+1}`" placeholder="端口号 / 名称" @update:model-value="value=>setTargetPort(port,value)"/></td>
            <td v-if="nodePortType"><el-input :model-value="port.nodePort??''" :disabled="disabled" :aria-label="`服务节点端口 ${index+1}`" placeholder="自动分配" @update:model-value="value=>setNodePort(port,value)"/></td>
            <td><el-select :model-value="port.appProtocol||''" filterable allow-create clearable default-first-option :disabled="disabled" :aria-label="`服务应用协议 ${index+1}`" placeholder="请选择" @update:model-value="value=>setAppProtocol(port,value)"><el-option v-for="value in appProtocols" :key="value" :label="value" :value="value"/></el-select></td>
            <td class="port-action"><el-button text type="danger" :icon="Delete" :disabled="disabled" :aria-label="`删除服务端口 ${index+1}`" @click="removePort(index)"/></td>
          </tr><tr v-if="!ports.length"><td :colspan="nodePortType?7:6" class="empty-ports">暂无端口 <el-button link type="primary" :disabled="disabled" @click="addPort">添加端口</el-button></td></tr></tbody>
        </table>
      </div></div>
    </template>
    <template v-else>
      <h2 class="service-settings-heading">流量与会话</h2>
      <el-form label-width="130px" :disabled="disabled" class="service-advanced-form">
        <el-form-item label="会话保持"><el-select :model-value="spec.sessionAffinity||'None'" aria-label="会话保持" @update:model-value="value=>spec.sessionAffinity=value"><el-option label="不保持（None）" value="None"/><el-option label="客户端 IP（ClientIP）" value="ClientIP"/></el-select></el-form-item>
        <el-form-item v-if="spec.sessionAffinity==='ClientIP'" label="保持时长（秒）"><el-input-number :model-value="spec.sessionAffinityConfig?.clientIP?.timeoutSeconds??10800" :min="1" :max="86400" aria-label="会话保持时长" @update:model-value="setAffinityTimeout"/></el-form-item>
        <el-form-item v-if="serviceType!=='ExternalName'" label="集群内流量"><el-select :model-value="spec.internalTrafficPolicy||'Cluster'" aria-label="集群内流量" @update:model-value="value=>spec.internalTrafficPolicy=value"><el-option label="全部节点（Cluster）" value="Cluster"/><el-option label="本地节点（Local）" value="Local"/></el-select></el-form-item>
        <el-form-item v-if="serviceType!=='ExternalName'&&(nodePortType||spec.externalIPs?.length)" label="外部流量"><el-select :model-value="spec.externalTrafficPolicy||'Cluster'" aria-label="外部流量" @update:model-value="value=>spec.externalTrafficPolicy=value"><el-option label="全部节点（Cluster）" value="Cluster"/><el-option label="本地节点（Local）" value="Local"/></el-select></el-form-item>
        <el-form-item label="发布未就绪地址"><el-switch :model-value="!!spec.publishNotReadyAddresses" aria-label="发布未就绪地址" @update:model-value="value=>spec.publishNotReadyAddresses=value"/></el-form-item>
        <el-form-item v-if="serviceType!=='ExternalName'" label="外部 IP"><el-select :model-value="spec.externalIPs||[]" multiple filterable allow-create default-first-option aria-label="外部 IP" placeholder="输入 IP 后按回车添加" @update:model-value="value=>setOptionalList('externalIPs',value)"/></el-form-item>
        <el-form-item v-if="serviceType==='LoadBalancer'" label="允许访问的网段"><el-select :model-value="spec.loadBalancerSourceRanges||[]" multiple filterable allow-create default-first-option aria-label="负载均衡来源网段" placeholder="例如 10.0.0.0/8" @update:model-value="value=>setOptionalList('loadBalancerSourceRanges',value)"/></el-form-item>
      </el-form>
      <details class="service-additional"><summary>其他服务设置</summary><StructuredFields :model-value="additionalFields" :reserved-keys="managedFields" :disabled="disabled" path="service" @update:model-value="setAdditionalFields"/></details>
    </template>
  </div>
</template>

<script setup>
import {computed,ref,watch,onUnmounted} from 'vue'
import {Plus,Delete,Refresh} from '@element-plus/icons-vue'
import api from '../api'
import {canResource} from '../utils/perm'
import {mergeFormFields} from '../utils/resource-form'
import KeyValueFields from './KeyValueFields.vue'
import StructuredFields from './StructuredFields.vue'

const props=defineProps({modelValue:Object,section:{type:String,default:'config'},namespace:String,clusterId:String,disabled:Boolean,creating:Boolean})
const emit=defineEmits(['change','validity'])
const spec=computed(()=>props.modelValue.spec),ports=computed(()=>spec.value.ports||[]),serviceType=computed(()=>spec.value.type||'ClusterIP')
const nodePortType=computed(()=>['NodePort','LoadBalancer'].includes(serviceType.value))
const serviceTypes=[{value:'ClusterIP',label:'仅集群内部访问'},{value:'NodePort',label:'通过节点端口访问'},{value:'LoadBalancer',label:'外部负载均衡'},{value:'ExternalName',label:'映射外部域名'}]
const appProtocols=['http','https','kubernetes.io/h2c','kubernetes.io/ws','kubernetes.io/wss']
const managedFields=['type','selector','ports','clusterIP','clusterIPs','ipFamilies','sessionAffinity','sessionAffinityConfig','internalTrafficPolicy','externalTrafficPolicy','publishNotReadyAddresses','externalIPs','loadBalancerSourceRanges','externalName']
const additionalFields=computed(()=>Object.fromEntries(Object.entries(spec.value).filter(([key])=>!managedFields.includes(key))))
const selectorEditor=ref(null),selectorVersion=ref(0),pods=ref([]),selectedPod=ref(''),podsLoading=ref(false),podsError=ref(''),podCursor=ref('')
const canReadPods=computed(()=>!!props.namespace&&!!props.clusterId&&canResource({group:'',version:'v1',plural:'pods',namespaced:true},'list',props.namespace,props.clusterId))
let generation=0,controller

async function loadPods(append=false){
 if(props.disabled||!canReadPods.value||podsLoading.value)return
 const epoch=++generation,namespace=props.namespace,clusterId=props.clusterId
 controller?.abort();controller=new AbortController();podsLoading.value=true;podsError.value=''
 if(!append){pods.value=[];selectedPod.value='';podCursor.value=''}
 try{
  const data=await api.list('','v1','pods',{namespace,clusterId,limit:200,...(append&&podCursor.value?{continue:podCursor.value}:{})},{signal:controller.signal,silent:true})
  if(epoch!==generation||namespace!==props.namespace||clusterId!==props.clusterId||!canReadPods.value)return
  const found=(data.items||[]).filter(pod=>pod.metadata?.uid&&pod.metadata.namespace===namespace&&Object.keys(pod.metadata.labels||{}).length)
  pods.value=Array.from(new Map([...(append?pods.value:[]),...found].map(pod=>[pod.metadata.uid,pod])).values())
  podCursor.value=data.metadata?.continue||''
 }catch(e){if(epoch===generation&&!e.cancelled)podsError.value=e.message||'读取 Pod 失败，请重试'}finally{if(epoch===generation)podsLoading.value=false}
}
function importPodLabels(){
 if(props.disabled||podsLoading.value||!canReadPods.value)return
 const pod=pods.value.find(item=>item.metadata.uid===selectedPod.value&&item.metadata.namespace===props.namespace)
 if(!pod)return
 spec.value.selector=Object.fromEntries(Object.entries(pod.metadata.labels||{}));selectorVersion.value++;emit('change')
}
function addPort(){spec.value.ports||=[];let n=ports.value.length+1;while(ports.value.some(port=>port.name===`port-${n}`))n++;spec.value.ports.push({name:`port-${n}`,port:80,targetPort:80,protocol:'TCP'})}
function removePort(index){spec.value.ports.splice(index,1)}
function setTargetPort(port,value){if(value==='')delete port.targetPort;else port.targetPort=/^\d+$/.test(value)?Number(value):value}
function setNodePort(port,value){if(value==='')delete port.nodePort;else port.nodePort=/^\d+$/.test(value)?Number(value):value}
function setAppProtocol(port,value){if(!value)delete port.appProtocol;else port.appProtocol=value}
function setAffinityTimeout(value){spec.value.sessionAffinityConfig||={};spec.value.sessionAffinityConfig.clientIP||={};spec.value.sessionAffinityConfig.clientIP.timeoutSeconds=value}
function setOptionalList(key,value){if(value.length)spec.value[key]=value;else delete spec.value[key]}
function setAdditionalFields(value){props.modelValue.spec=mergeFormFields(spec.value,managedFields,value)}
watch(()=>[props.namespace,props.clusterId],()=>{generation++;controller?.abort();pods.value=[];selectedPod.value='';podCursor.value='';podsError.value='';podsLoading.value=false})
onUnmounted(()=>{generation++;controller?.abort()})
</script>

<style scoped>
.service-form{min-width:0}.service-field{display:grid;grid-template-columns:105px minmax(0,1fr);gap:20px;margin-bottom:22px;align-items:center}.service-field-label{font-size:13px;color:var(--kp-muted);text-align:right;line-height:1.6}.service-field-label.required:before{content:'*';color:var(--el-color-danger);margin-right:5px}.service-field-content{min-width:0}.selector-field,.ports-field{align-items:start}.selector-field>.service-field-label,.ports-field>.service-field-label{padding-top:7px}.selector-tools{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px}.selector-tool{border-radius:7px;padding:12px 14px;border:1px solid #bdcde4;background:#eaf0f6;min-width:250px}.selector-tool>strong{font-size:12px;color:#426597;display:block;margin-bottom:10px}.selector-tool>div{display:flex;align-items:center;gap:9px}.selector-tool>div>span,.selector-tool>p{font-size:12px;color:#6b7b91;margin:5px 0 0}.import-tool{background:#fff2e0;border-color:#ffd3a0;flex-basis:340px}.import-tool>strong{color:#b97931}.import-tool :deep(.el-select){width:180px;flex:1;min-width:100px}.pod-import-controls>.el-button+.el-button{margin:0}.service-selector-fields{max-width:780px}.service-selector-fields :deep(.kv-add){display:none}.service-selector-fields :deep(.kv-field-row){background:transparent;border:0;border-radius:0;padding:0;margin-bottom:9px;grid-template-columns:minmax(140px,1fr) 20px minmax(180px,1fr) 28px;gap:10px}.service-selector-fields :deep(.el-input__wrapper){box-shadow:0 0 0 1px var(--kp-border) inset!important}.service-selector-fields :deep(.kv-equals){background:transparent;color:var(--kp-muted)}.service-inline-error{font-size:13px;color:var(--el-color-danger);margin:10px 0}.type-option-description{float:right;color:var(--kp-muted);margin-left:18px}.address-line{display:flex;align-items:center;gap:10px;color:var(--kp-text);font-size:13px}.address-line>span{font-variant-numeric:tabular-nums}.port-table-scroll{overflow:auto}.service-port-table{width:100%;min-width:770px;border-collapse:collapse;font-size:13px}.service-port-table th{background:var(--kp-surface-2);text-align:left;color:var(--kp-text-2);font-weight:500;padding:8px 7px;white-space:nowrap}.service-port-table th:first-child{width:27%;border-radius:6px 0 0 0}.service-port-table td{padding:7px;border-bottom:1px solid var(--kp-border);vertical-align:middle}.service-port-table th:nth-child(2){width:108px}.service-port-table th:nth-child(3){width:120px}.service-port-table th:nth-child(4){width:145px}.service-port-table :deep(.el-input-number){width:100%}.service-port-table :deep(.el-select){min-width:95px;width:100%}.service-port-table .port-action{width:38px;text-align:center}.service-port-table .port-action .el-button{padding:5px;min-width:28px}.empty-ports{text-align:center;color:var(--kp-muted);height:65px}.service-settings-heading{font-size:15px;font-weight:600;color:var(--kp-text);margin:0 0 24px}.service-advanced-form{max-width:900px}.service-additional{border-top:1px solid var(--kp-border);padding-top:18px;margin-top:22px}.service-additional>summary{font-size:13px;color:var(--kp-text-2);cursor:pointer;margin-bottom:16px}
@media(max-width:900px){.service-field{grid-template-columns:85px minmax(0,1fr);gap:14px}.selector-tool{min-width:0;flex:1 1 250px}}
@media(max-width:600px){.service-field{grid-template-columns:minmax(0,1fr);gap:8px}.service-field-label{text-align:left;padding-top:0!important}.service-port-table{min-width:730px}.service-selector-fields :deep(.kv-field-row){grid-template-columns:minmax(0,1fr) 28px}.selector-tool{padding:12px}.service-advanced-form :deep(.el-form-item){display:block}.service-advanced-form :deep(.el-form-item__label){float:none;width:auto!important;text-align:left;justify-content:flex-start}.service-advanced-form :deep(.el-form-item__content){margin-left:0!important}}
</style>
