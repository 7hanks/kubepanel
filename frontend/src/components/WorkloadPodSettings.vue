<template>
  <div class="workload-pod-settings">
    <p v-if="podLocked" class="pod-settings-note">已有 Pod 的运行设置不可修改。</p>
    <section class="pod-settings-section" aria-labelledby="pod-runtime-heading">
      <h3 id="pod-runtime-heading">运行配置</h3>
      <div class="pod-settings-fields">
        <div class="pod-setting-row"><label>重启策略</label><div class="pod-setting-content"><el-select :model-value="pod.restartPolicy||''" :disabled="locked" aria-label="重启策略" placeholder="使用默认策略" @update:model-value="value=>setOptional('restartPolicy',value)"><el-option v-for="value in restartPolicies" :key="value" :label="restartLabels[value]" :value="value"/></el-select></div></div>
        <div class="pod-setting-row"><label>服务账号</label><div class="pod-setting-content"><el-input :model-value="pod.serviceAccountName||''" :disabled="locked" aria-label="服务账号" placeholder="使用命名空间默认账号" @update:model-value="value=>setOptional('serviceAccountName',value)"/></div></div>
        <div class="pod-setting-row"><label>镜像仓库密文</label><div class="pod-setting-content"><el-select :model-value="imagePullSecretNames" :disabled="locked" multiple filterable allow-create default-first-option aria-label="镜像仓库密文" placeholder="输入密文名称后按回车添加" @update:model-value="setImagePullSecrets"><el-option v-for="name in imagePullSecretNames" :key="name" :label="name" :value="name"/></el-select></div></div>
        <div class="pod-setting-row"><label>优雅终止时长（秒）</label><div class="pod-setting-content"><el-input-number :model-value="pod.terminationGracePeriodSeconds" :disabled="locked" :min="0" :precision="0" controls-position="right" aria-label="优雅终止时长（秒）" placeholder="使用集群默认值" @update:model-value="value=>setOptional('terminationGracePeriodSeconds',value)"/><p class="pod-field-hint">停止容器前等待进程正常退出的时间。</p></div></div>
      </div>
    </section>
    <section class="pod-settings-section" aria-labelledby="pod-network-heading">
      <h3 id="pod-network-heading">网络与调度</h3>
      <div class="pod-settings-fields">
        <div class="pod-setting-row"><label>DNS 策略</label><div class="pod-setting-content"><el-select :model-value="pod.dnsPolicy||''" :disabled="locked" clearable aria-label="DNS 策略" placeholder="使用集群默认策略" @update:model-value="value=>setOptional('dnsPolicy',value)"><el-option v-for="item in dnsPolicies" :key="item.value" :label="item.label" :value="item.value"/></el-select></div></div>
        <div class="pod-setting-row"><label>调度器</label><div class="pod-setting-content"><el-select :model-value="pod.schedulerName||''" :disabled="locked" filterable allow-create clearable default-first-option aria-label="调度器" placeholder="使用默认调度器" @update:model-value="value=>setOptional('schedulerName',value)"><el-option v-for="name in schedulerNames" :key="name" :label="name" :value="name"/></el-select></div></div>
        <div class="pod-setting-row"><label>宿主机网络</label><div class="pod-setting-content optional-boolean"><el-select :model-value="pod.hostNetwork??''" :disabled="locked" aria-label="宿主机网络" @update:model-value="value=>setOptional('hostNetwork',value)"><el-option label="使用默认设置" value=""/><el-option label="启用" :value="true"/><el-option label="不启用" :value="false"/></el-select><p class="pod-field-hint">启用后与所在节点共享网络。</p></div></div>
        <div class="pod-setting-row pod-map-row"><label>节点选择器</label><div class="pod-setting-content"><KeyValueFields :model-value="pod.nodeSelector" label="节点选择器" add-label="添加节点标签" :disabled="locked" @update:model-value="value=>setOptional('nodeSelector',value)" @change="emit('change')" @validity="value=>emit('validity',value)"/></div></div>
      </div>
    </section>
    <section class="pod-settings-section" aria-labelledby="pod-security-heading">
      <h3 id="pod-security-heading">安全设置</h3>
      <div class="pod-settings-fields">
        <div v-for="field in securityFields" :key="field.key" class="pod-setting-row"><label>{{field.label}}</label><div class="pod-setting-content pod-security-control">
          <el-switch :model-value="hasSecurityField(field.key)" :disabled="locked" :aria-label="`自定义${field.label}`" active-text="自定义" @update:model-value="value=>toggleSecurityField(field,value)"/>
          <el-switch v-if="field.key==='runAsNonRoot'" :model-value="pod.securityContext?.runAsNonRoot??false" :disabled="locked||!hasSecurityField(field.key)" aria-label="非 Root 用户运行" active-text="启用" inactive-text="不启用" @update:model-value="value=>setSecurityField(field.key,value)"/>
          <el-input-number v-else :key="String(locked||!hasSecurityField(field.key))" :model-value="pod.securityContext?.[field.key]" :disabled="locked||!hasSecurityField(field.key)" :min="0" :precision="0" controls-position="right" :aria-label="field.label" placeholder="用户或组 ID" @update:model-value="value=>setSecurityField(field.key,value)"/>
        </div></div>
      </div>
    </section>
    <details class="pod-settings-additional"><summary>更多容器组设置</summary><div class="pod-settings-advanced"><StructuredFields :model-value="additionalFields" :reserved-keys="managedFields" :disabled="locked" path="podSpec" @update:model-value="setAdditionalFields"/><details class="pod-security-additional"><summary>其他安全上下文</summary><StructuredFields :model-value="securityAdditionalFields" :reserved-keys="securityKeys" :disabled="locked" path="securityContext" @update:model-value="setSecurityAdditionalFields"/></details></div></details>
  </div>
</template>

<script setup>
import {computed} from 'vue'
import {podSpec,mergeFormFields} from '../utils/resource-form'
import KeyValueFields from './KeyValueFields.vue'
import StructuredFields from './StructuredFields.vue'

const props=defineProps({modelValue:Object,creating:Boolean,disabled:Boolean})
const emit=defineEmits(['change','validity'])
const pod=computed(()=>podSpec(props.modelValue)||{})
const podLocked=computed(()=>props.modelValue.kind==='Pod'&&!props.creating)
const locked=computed(()=>props.disabled||podLocked.value)
const restartPolicies=computed(()=>['Job','CronJob'].includes(props.modelValue.kind)?['OnFailure','Never']:props.modelValue.kind==='Pod'?['Always','OnFailure','Never']:['Always'])
const restartLabels={Always:'始终重启（Always）',OnFailure:'失败时重启（OnFailure）',Never:'从不重启（Never）'}
const dnsPolicies=[{value:'ClusterFirst',label:'优先集群 DNS（ClusterFirst）'},{value:'ClusterFirstWithHostNet',label:'宿主机网络使用集群 DNS（ClusterFirstWithHostNet）'},{value:'Default',label:'继承节点 DNS（Default）'},{value:'None',label:'自定义 DNS（None）'}]
const schedulerNames=computed(()=>Array.from(new Set(['default-scheduler',...(pod.value.schedulerName?[pod.value.schedulerName]:[])])))
const imagePullSecretNames=computed(()=>(pod.value.imagePullSecrets||[]).map(item=>item.name).filter(Boolean))
const securityFields=[{key:'runAsNonRoot',label:'非 Root 用户运行',initial:true},{key:'runAsUser',label:'运行用户 ID',initial:1000},{key:'runAsGroup',label:'运行组 ID',initial:1000},{key:'fsGroup',label:'文件系统组 ID',initial:1000}]
const securityKeys=securityFields.map(field=>field.key)
const managedFields=['containers','initContainers','ephemeralContainers','volumes','restartPolicy','serviceAccountName','imagePullSecrets','terminationGracePeriodSeconds','dnsPolicy','schedulerName','hostNetwork','nodeSelector','securityContext']
const additionalFields=computed(()=>Object.fromEntries(Object.entries(pod.value).filter(([key])=>!managedFields.includes(key))))
const securityAdditionalFields=computed(()=>Object.fromEntries(Object.entries(pod.value.securityContext||{}).filter(([key])=>!securityKeys.includes(key))))
function hasSecurityField(key){return key in (pod.value.securityContext||{})}
function setOptional(key,value){
 if(locked.value)return
 if(value===''||value==null||Array.isArray(value)&&!value.length||typeof value==='object'&&!Array.isArray(value)&&!Object.keys(value).length)delete pod.value[key]
 else pod.value[key]=value
 emit('change')
}
function setImagePullSecrets(names){
 const existing=pod.value.imagePullSecrets||[]
 setOptional('imagePullSecrets',names.map(name=>existing.find(item=>item.name===name)||{name}))
}
function setSecurityField(key,value){
 if(locked.value)return
 const next={...pod.value.securityContext}
 if(value==null)delete next[key];else next[key]=value
 setOptional('securityContext',next)
}
function toggleSecurityField(field,enabled){setSecurityField(field.key,enabled?pod.value.securityContext?.[field.key]??field.initial:undefined)}
function setAdditionalFields(value){
 if(locked.value)return
 const next=mergeFormFields(pod.value,managedFields,value)
 for(const key of Object.keys(pod.value))if(!Object.hasOwn(next,key))delete pod.value[key]
 Object.assign(pod.value,next);emit('change')
}
function setSecurityAdditionalFields(value){setOptional('securityContext',mergeFormFields(pod.value.securityContext||{},securityKeys,value))}
</script>

<style scoped>
.workload-pod-settings{font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:14px;color:var(--kp-text);min-width:0}.pod-settings-section{margin-bottom:28px}.pod-settings-section>h3{margin:0 0 20px;border-left:3px solid #426597;background:#f2f5f9;color:#344964;font-size:14px;font-weight:600;line-height:22px;padding:10px 14px}.pod-settings-fields{padding:0 16px}.pod-setting-row{display:grid;grid-template-columns:156px minmax(0,1fr);align-items:center;gap:20px;margin-bottom:20px}.pod-setting-row>label{font-size:14px;line-height:1.6;text-align:right;color:var(--kp-text-2)}.pod-setting-content{min-width:0;max-width:780px}.pod-setting-content>.el-select,.pod-setting-content>.el-input{width:100%;max-width:580px}.pod-setting-content>.el-input-number{width:220px}.pod-field-hint{font-size:14px;line-height:1.65;color:var(--kp-muted);margin:7px 0 0}.pod-map-row{align-items:start}.pod-map-row>label{padding-top:7px}.pod-security-control{display:flex;align-items:center;gap:28px;min-height:32px;flex-wrap:wrap}.pod-security-control>.el-input-number{width:220px}.pod-settings-note{padding:12px 16px;background:var(--kp-surface-2);color:var(--kp-muted);margin:0 0 20px;line-height:1.7}.pod-settings-additional{border-top:1px solid var(--kp-border);padding-top:18px}.pod-settings-additional>summary,.pod-security-additional>summary{font-size:14px;font-weight:500;line-height:24px;color:#426597;cursor:pointer}.pod-settings-advanced{padding:20px 16px 0}.pod-security-additional{margin-top:20px}.pod-security-additional>summary{margin-bottom:16px}.workload-pod-settings :deep(.el-input__inner),.workload-pod-settings :deep(.el-select__placeholder),.workload-pod-settings :deep(.el-switch__label){font-family:inherit;font-size:14px}.pod-map-row :deep(.kv-field-row){border-radius:4px;margin-bottom:10px;padding:8px 10px;grid-template-columns:minmax(100px,1fr) 20px minmax(100px,1fr) 28px}.pod-map-row :deep(.kv-add){border-radius:4px;font-size:14px}.pod-settings-advanced :deep(.structured-scalar>label),.pod-settings-advanced :deep(.structured-field code){font-family:inherit;font-size:14px}
@media(max-width:800px){.pod-settings-fields{padding:0 6px}.pod-setting-row{grid-template-columns:140px minmax(0,1fr);gap:16px}.pod-security-control{gap:16px}.pod-settings-advanced{padding:18px 4px 0}}
@media(max-width:600px){.pod-setting-row{grid-template-columns:minmax(0,1fr);gap:8px}.pod-setting-row>label{text-align:left;padding:0}.pod-setting-content>.el-select,.pod-setting-content>.el-input{max-width:none}.pod-security-control{gap:12px}.pod-map-row :deep(.kv-field-row){grid-template-columns:minmax(0,1fr) 28px}}
</style>
