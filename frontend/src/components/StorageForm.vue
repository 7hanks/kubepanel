<template>
  <section class="storage-form" :aria-label="heading">
    <h2>{{heading}}</h2>
    <p v-if="!creating&&isClaim" class="storage-note">{{canResize?'已绑定的存储申请仅支持增加容量；扩容需存储类和驱动支持。':'未绑定的存储申请配置只读。绑定后可申请扩容。'}}</p>
    <p v-else-if="!creating&&isClass" class="storage-note">供给器、参数、回收策略和绑定模式创建后不可修改。</p>
    <p v-else-if="!creating" class="storage-note">存储源和卷模式创建后不可修改。修改 PV 容量仅更新容量记录，不会扩容实际存储。</p>
    <el-form label-width="132px" class="storage-controls" :disabled="disabled">
      <template v-if="!isClass">
        <el-form-item :label="isClaim?'申请容量':'存储容量'" required :error="capacityError">
          <div class="storage-input-with-note"><el-input :model-value="capacity" :disabled="disabled||!canResize" :aria-label="isClaim?'存储申请容量':'持久卷容量'" placeholder="例如 10Gi 或 500Mi" @update:model-value="setCapacity"/><span class="storage-hint">支持 Gi、Mi、Ti 等 Kubernetes 容量单位</span></div>
        </el-form-item>
        <el-form-item label="访问模式" required><div class="storage-access-modes"><el-checkbox-group :model-value="spec.accessModes||[]" :disabled="disabled||!creating" aria-label="存储访问模式" @update:model-value="setAccessModes"><el-checkbox v-for="mode in accessModeOptions" :key="mode.value" :value="mode.value">{{mode.label}} <span class="storage-mode-code">{{mode.code}}</span></el-checkbox></el-checkbox-group></div></el-form-item>
        <el-form-item label="存储类">
          <div class="storage-class-controls">
            <template v-if="isClaim"><el-select :model-value="classMode" :disabled="disabled||!creating" aria-label="存储类选择方式" @update:model-value="setClassMode"><el-option label="使用集群默认存储类" value="default"/><el-option label="不使用存储类" value="none"/><el-option label="指定存储类" value="named"/></el-select><el-input v-if="classMode==='named'" :model-value="spec.storageClassName??''" :disabled="disabled||!creating" aria-label="存储类名称" placeholder="例如 standard" @update:model-value="setStorageClass"/><span class="storage-hint">{{classMode==='none'?'显式设置为空，仅匹配无存储类的 PV':classMode==='default'?'不指定 storageClassName，由集群默认存储类处理':''}}</span></template>
            <template v-else><el-input :model-value="spec.storageClassName??''" :disabled="disabled||!creating" aria-label="持久卷存储类" placeholder="留空表示无存储类" @update:model-value="value=>setField('storageClassName',value,true)"/></template>
          </div>
        </el-form-item>
        <el-form-item label="卷模式"><el-select :model-value="spec.volumeMode??'Filesystem'" :disabled="disabled||!creating" aria-label="存储卷模式" @update:model-value="value=>setField('volumeMode',value)"><el-option label="文件系统（Filesystem）" value="Filesystem"/><el-option label="裸块设备（Block）" value="Block"/></el-select></el-form-item>
        <el-form-item v-if="isClaim" label="预绑定持久卷"><div class="storage-input-with-note"><el-input :model-value="spec.volumeName??''" :disabled="disabled||!creating" aria-label="预绑定持久卷名称" placeholder="可选，填写已有 PV 名称" @update:model-value="value=>setField('volumeName',value,true)"/><span class="storage-hint">填写后仅尝试绑定此 PV；留空由 Kubernetes 匹配</span></div></el-form-item>
        <el-form-item v-else label="回收策略"><el-select :model-value="spec.persistentVolumeReclaimPolicy??'Retain'" :disabled="disabled" aria-label="持久卷回收策略" @update:model-value="value=>setField('persistentVolumeReclaimPolicy',value)"><el-option label="保留（Retain）" value="Retain"/><el-option label="删除（Delete）" value="Delete"/><el-option v-if="spec.persistentVolumeReclaimPolicy==='Recycle'" label="回收（Recycle，已弃用）" value="Recycle"/></el-select></el-form-item>
      </template>
      <template v-else>
        <el-form-item label="存储供给器" required><div class="storage-input-with-note"><el-input :model-value="modelValue.provisioner??''" :disabled="disabled||!creating" aria-label="存储供给器" placeholder="例如 nfs.csi.k8s.io" @update:model-value="value=>setField('provisioner',value)"/><span class="storage-hint">填写集群已安装的存储驱动名称</span></div></el-form-item>
        <el-form-item label="供给器参数"><KeyValueFields :model-value="modelValue.parameters" label="供给器参数" add-label="添加参数" :disabled="disabled||!creating" @update:model-value="setParameters" @validity="value=>setChildValidity('parameters',value)"/></el-form-item>
        <el-form-item label="回收策略"><el-select :model-value="modelValue.reclaimPolicy??'Delete'" :disabled="disabled||!creating" aria-label="存储类回收策略" @update:model-value="value=>setField('reclaimPolicy',value)"><el-option label="保留（Retain）" value="Retain"/><el-option label="删除（Delete）" value="Delete"/></el-select></el-form-item>
        <el-form-item label="卷绑定模式"><el-select :model-value="modelValue.volumeBindingMode??'Immediate'" :disabled="disabled||!creating" aria-label="卷绑定模式" @update:model-value="value=>setField('volumeBindingMode',value)"><el-option label="立即绑定（Immediate）" value="Immediate"/><el-option label="等待首次使用（WaitForFirstConsumer）" value="WaitForFirstConsumer"/></el-select></el-form-item>
        <el-form-item label="允许扩容"><el-select :model-value="modelValue.allowVolumeExpansion??'default'" :disabled="disabled" aria-label="允许存储卷扩容" @update:model-value="setExpansion"><el-option label="未设置（默认不允许）" value="default"/><el-option label="允许" :value="true"/><el-option label="不允许" :value="false"/></el-select></el-form-item>
        <el-form-item label="挂载选项"><div class="storage-input-with-note"><el-select :model-value="modelValue.mountOptions||[]" multiple filterable allow-create default-first-option :disabled="disabled" aria-label="存储类挂载选项" placeholder="输入选项后按回车添加" @update:model-value="setMountOptions"/><span class="storage-hint">选项需由存储驱动支持，例如 discard、nfsvers=4.1</span></div></el-form-item>
      </template>
    </el-form>

    <template v-if="isVolume">
      <h3>存储源</h3>
      <el-form label-width="132px" class="storage-controls" :disabled="disabled||!creating">
        <el-form-item label="存储源类型" required><el-select :model-value="sourceType" :disabled="disabled||!creating" aria-label="持久卷存储源类型" placeholder="选择存储源" @update:model-value="setSourceType"><el-option label="NFS 共享存储" value="nfs"/><el-option label="宿主机目录（hostPath）" value="hostPath"/><el-option label="CSI 存储驱动" value="csi"/><el-option label="其他存储源" value="other"/></el-select></el-form-item>
        <template v-if="sourceType==='nfs'">
          <el-form-item label="NFS 服务器" required><el-input :model-value="source.server??''" :disabled="disabled||!creating" aria-label="NFS 服务器" placeholder="例如 nfs.internal 或 10.0.0.10" @update:model-value="value=>setSourceField('server',value)"/></el-form-item>
          <el-form-item label="共享路径" required><el-input :model-value="source.path??''" :disabled="disabled||!creating" aria-label="NFS 共享路径" placeholder="例如 /exports/data" @update:model-value="value=>setSourceField('path',value)"/></el-form-item>
          <el-form-item label="只读挂载"><el-switch :model-value="source.readOnly??false" :disabled="disabled||!creating" aria-label="NFS 只读挂载" @update:model-value="value=>setSourceField('readOnly',value)"/></el-form-item>
        </template>
        <template v-else-if="sourceType==='hostPath'">
          <el-form-item label="宿主机路径" required><div class="storage-input-with-note"><el-input :model-value="source.path??''" :disabled="disabled||!creating" aria-label="宿主机存储路径" placeholder="例如 /var/data" @update:model-value="value=>setSourceField('path',value)"/><span class="storage-hint">hostPath 适用于单节点测试，多节点存储请使用 CSI 或其他共享存储</span></div></el-form-item>
          <el-form-item label="路径检查类型"><el-select :model-value="source.type??''" :disabled="disabled||!creating" aria-label="宿主机路径类型" @update:model-value="value=>setSourceField('type',value,true)"><el-option label="不检查" value=""/><el-option v-for="type in hostPathTypes" :key="type" :label="type" :value="type"/></el-select></el-form-item>
        </template>
        <template v-else-if="sourceType==='csi'">
          <el-form-item label="CSI 驱动" required><el-input :model-value="source.driver??''" :disabled="disabled||!creating" aria-label="CSI 驱动" placeholder="例如 nfs.csi.k8s.io" @update:model-value="value=>setSourceField('driver',value)"/></el-form-item>
          <el-form-item label="卷标识" required><el-input :model-value="source.volumeHandle??''" :disabled="disabled||!creating" aria-label="CSI 卷标识" placeholder="填写存储系统中的唯一卷标识" @update:model-value="value=>setSourceField('volumeHandle',value)"/></el-form-item>
          <el-form-item label="文件系统类型"><el-input :model-value="source.fsType??''" :disabled="disabled||!creating" aria-label="CSI 文件系统类型" placeholder="可选，例如 ext4" @update:model-value="value=>setSourceField('fsType',value,true)"/></el-form-item>
          <el-form-item label="只读挂载"><el-switch :model-value="source.readOnly??false" :disabled="disabled||!creating" aria-label="CSI 只读挂载" @update:model-value="value=>setSourceField('readOnly',value)"/></el-form-item>
          <el-form-item label="卷属性"><KeyValueFields :model-value="source.volumeAttributes" label="CSI 卷属性" add-label="添加卷属性" :disabled="disabled||!creating" @update:model-value="value=>setSourceField('volumeAttributes',value)" @validity="value=>setChildValidity('attributes',value)"/></el-form-item>
        </template>
      </el-form>
      <details v-if="sourceType==='other'" class="storage-additional" open><summary>其他存储源配置</summary><p class="storage-hint">以存储源字段名添加对象，例如 local；每个 PV 只能配置一个存储源。</p><StructuredFields :model-value="otherSources" :reserved-keys="nonSourceFields" :disabled="disabled||!creating" path="pv-source" @update:model-value="setOtherSources"/></details>
      <details v-else-if="sourceType" class="storage-additional"><summary>存储源高级设置</summary><StructuredFields :model-value="sourceAdditionalFields" :reserved-keys="sourceManagedFields" :disabled="disabled||!creating" :path="`pv.${sourceType}`" @update:model-value="setSourceAdditionalFields"/></details>
    </template>
    <details class="storage-additional"><summary>{{creating?'高级存储设置':'其他存储配置（只读）'}}</summary><StructuredFields :model-value="additionalFields" :reserved-keys="managedFields" :disabled="disabled||!creating" :path="isClass?'storageclass':'storage'" @update:model-value="setAdditionalFields"/></details>
    <p v-if="validationError&&!capacityError" class="storage-error" role="alert">{{validationError}}</p>
  </section>
</template>

<script setup>
import {computed,ref,watch} from 'vue'
import {mergeFormFields} from '../utils/resource-form'
import {STORAGE_ACCESS_MODES,PV_SOURCE_FIELDS,validateStorageResource} from '../utils/storage-form'
import KeyValueFields from './KeyValueFields.vue'
import StructuredFields from './StructuredFields.vue'

const props=defineProps({modelValue:{type:Object,required:true},original:Object,creating:Boolean,disabled:Boolean})
const emit=defineEmits(['change','validity'])
const fallbackOriginal=JSON.parse(JSON.stringify(props.modelValue)),namedClassMode=ref(false),otherSourceMode=ref(false),capacityTouched=ref(false),childErrors=ref({})
const spec=computed(()=>props.modelValue.spec||{}),isClass=computed(()=>props.modelValue.kind==='StorageClass'),isClaim=computed(()=>props.modelValue.kind==='PersistentVolumeClaim'),isVolume=computed(()=>props.modelValue.kind==='PersistentVolume')
const heading=computed(()=>isClass.value?'存储类配置':isClaim.value?'存储申请配置':'持久卷配置')
const original=computed(()=>props.original||fallbackOriginal)
const canResize=computed(()=>props.creating||isVolume.value||original.value.status?.phase==='Bound')
const capacity=computed(()=>isClaim.value?spec.value.resources?.requests?.storage??'':spec.value.capacity?.storage??'')
const classMode=computed(()=>namedClassMode.value?'named':spec.value.storageClassName===undefined?'default':spec.value.storageClassName===''?'none':'named')
const accessModeOptions=STORAGE_ACCESS_MODES.map((value,index)=>({value,label:['单节点读写','多节点只读','多节点读写','单 Pod 读写'][index],code:['RWO','ROX','RWX','RWOP'][index]}))
const hostPathTypes=['DirectoryOrCreate','Directory','FileOrCreate','File','Socket','CharDevice','BlockDevice']
const nonSourceFields=['capacity','accessModes','persistentVolumeReclaimPolicy','storageClassName','volumeMode','claimRef','mountOptions','nodeAffinity','volumeAttributesClassName']
const claimManagedFields=['accessModes','resources','storageClassName','volumeMode','volumeName']
const classManagedFields=['apiVersion','kind','metadata','status','provisioner','parameters','reclaimPolicy','volumeBindingMode','allowVolumeExpansion','mountOptions']
const managedFields=computed(()=>isClass.value?classManagedFields:isClaim.value?claimManagedFields:[...nonSourceFields.filter(key=>!['nodeAffinity','claimRef','mountOptions','volumeAttributesClassName'].includes(key)),...PV_SOURCE_FIELDS])
const additionalFields=computed(()=>Object.fromEntries(Object.entries(isClass.value?props.modelValue:spec.value).filter(([key])=>!managedFields.value.includes(key))))
const sourceType=computed(()=>otherSourceMode.value?'other':['nfs','hostPath','csi'].find(key=>spec.value[key]!==undefined)|| (PV_SOURCE_FIELDS.some(key=>spec.value[key]!==undefined)?'other':''))
const source=computed(()=>spec.value[sourceType.value]||{})
const sourceManagedFields=computed(()=>({nfs:['server','path','readOnly'],hostPath:['path','type'],csi:['driver','volumeHandle','fsType','readOnly','volumeAttributes']})[sourceType.value]||[])
const sourceAdditionalFields=computed(()=>Object.fromEntries(Object.entries(source.value).filter(([key])=>!sourceManagedFields.value.includes(key))))
const otherSources=computed(()=>Object.fromEntries(PV_SOURCE_FIELDS.filter(key=>!['nfs','hostPath','csi'].includes(key)&&Object.hasOwn(spec.value,key)).map(key=>[key,spec.value[key]])))
const validationError=computed(()=>{
 const child=Object.values(childErrors.value).find(Boolean);if(child)return child
 if(isClaim.value&&classMode.value==='named'&&!spec.value.storageClassName?.trim())return '请输入存储类名称'
 try{validateStorageResource(props.modelValue,{creating:props.creating,original:original.value});return ''}catch(error){return error.message}
})
const capacityError=computed(()=>validationError.value.includes('容量')?validationError.value:'')
// Required fields are checked during preflight; an unopened form must not trap
// the user on the basic-information tab. Only incomplete local edits block tabs.
const fieldValidity=computed(()=>Object.values(childErrors.value).find(Boolean)||(namedClassMode.value&&!spec.value.storageClassName?.trim()?'请输入存储类名称':'')||(capacityTouched.value?capacityError.value:''))
watch(fieldValidity,value=>emit('validity',value),{immediate:true})

function changed(){emit('change')}
function ensureSpec(){return props.modelValue.spec||=( {})}
function setField(key,value,optional=false){
 if(props.disabled)return
 if(isClass.value){if(!classManagedFields.includes(key)||['apiVersion','kind','metadata','status','parameters'].includes(key)||!props.creating&&!['allowVolumeExpansion','mountOptions'].includes(key))return}
 else if(!props.creating&&!(isVolume.value&&key==='persistentVolumeReclaimPolicy'))return
 else if(!managedFields.value.includes(key)||PV_SOURCE_FIELDS.includes(key)||['resources','capacity','accessModes'].includes(key))return
 const target=isClass.value?props.modelValue:ensureSpec();if(optional&&value==='')delete target[key];else target[key]=value;changed()
}
function setCapacity(value){
 if(props.disabled||!canResize.value)return
 capacityTouched.value=true
 const target=ensureSpec();if(isClaim.value){target.resources||={};target.resources.requests||={};target.resources.requests.storage=value}else{target.capacity||={};target.capacity.storage=value}changed()
}
function setAccessModes(value){if(props.disabled||!props.creating)return;ensureSpec().accessModes=[...value];changed()}
function setClassMode(value){
 if(props.disabled||!props.creating)return
 namedClassMode.value=value==='named'
 if(value==='default')delete ensureSpec().storageClassName
 if(value==='none')ensureSpec().storageClassName=''
 changed()
}
function setStorageClass(value){if(props.disabled||!props.creating)return;ensureSpec().storageClassName=value;changed()}
function setParameters(value){if(props.disabled||!props.creating||!isClass.value)return;props.modelValue.parameters=value;changed()}
function setExpansion(value){if(props.disabled||!isClass.value)return;if(value==='default')delete props.modelValue.allowVolumeExpansion;else if(typeof value==='boolean')props.modelValue.allowVolumeExpansion=value;changed()}
function setMountOptions(value){if(props.disabled||!isClass.value)return;if(value.length)props.modelValue.mountOptions=[...value];else delete props.modelValue.mountOptions;changed()}
function setChildValidity(key,value){childErrors.value={...childErrors.value,[key]:value}}
function setSourceType(value){
 if(props.disabled||!props.creating||!isVolume.value||!['nfs','hostPath','csi','other'].includes(value))return
 if(value===sourceType.value)return
 const target=ensureSpec();otherSourceMode.value=value==='other'
 for(const key of PV_SOURCE_FIELDS)if(key!==value)delete target[key]
 if(value!=='other')target[value]||={}
 childErrors.value={};changed()
}
function setSourceField(key,value,optional=false){
 if(props.disabled||!props.creating||!isVolume.value||!sourceManagedFields.value.includes(key))return
 const target=ensureSpec()[sourceType.value]||=( {});if(optional&&value==='')delete target[key];else target[key]=value;changed()
}
function setSourceAdditionalFields(value){
 if(props.disabled||!props.creating||!isVolume.value||!['nfs','hostPath','csi'].includes(sourceType.value))return
 ensureSpec()[sourceType.value]=mergeFormFields(source.value,sourceManagedFields.value,value);changed()
}
function setOtherSources(value){
 if(props.disabled||!props.creating||!isVolume.value||sourceType.value!=='other')return
 const target=ensureSpec();for(const key of PV_SOURCE_FIELDS)if(!['nfs','hostPath','csi'].includes(key))delete target[key]
 for(const [key,item] of Object.entries(value))if(PV_SOURCE_FIELDS.includes(key)&&!['nfs','hostPath','csi'].includes(key))target[key]=item
 changed()
}
function setAdditionalFields(value){
 if(props.disabled||!props.creating)return
 if(isClass.value){const next=mergeFormFields(props.modelValue,managedFields.value,value);for(const key of Object.keys(props.modelValue))if(!Object.hasOwn(next,key))delete props.modelValue[key];Object.assign(props.modelValue,next)}
 else props.modelValue.spec=mergeFormFields(spec.value,managedFields.value,value)
 changed()
}
</script>

<style scoped>
.storage-form{min-width:0;max-width:1040px;color:var(--kp-text);font-size:14px}.storage-form h2{font-size:16px;font-weight:600;margin:0 0 24px}.storage-form h3{font-size:14px;font-weight:600;border-top:1px solid var(--kp-border);padding-top:22px;margin:26px 0 20px}.storage-note{font-size:13px;line-height:1.7;color:var(--kp-muted);margin:-12px 0 22px}.storage-controls{max-width:900px}.storage-controls :deep(.el-form-item){margin-bottom:24px}.storage-controls :deep(.el-form-item__label){font-size:14px;color:var(--kp-text-2)}.storage-controls :deep(.el-form-item__content){min-width:0}.storage-controls :deep(.el-select){width:100%}.storage-input-with-note,.storage-class-controls{width:100%;min-width:0;display:flex;flex-direction:column;gap:8px}.storage-hint{display:block;color:var(--kp-muted);font-size:12px;line-height:1.6}.storage-access-modes :deep(.el-checkbox-group){display:flex;gap:4px 24px;flex-wrap:wrap}.storage-access-modes :deep(.el-checkbox){margin-right:0}.storage-mode-code{color:var(--kp-muted);font-size:12px;margin-left:4px}.storage-additional{border-top:1px solid var(--kp-border);padding-top:18px;margin-top:24px}.storage-additional>summary{cursor:pointer;color:var(--kp-text-2);font-size:14px;margin-bottom:16px}.storage-error{color:var(--el-color-danger);font-size:13px;margin:18px 0 0}.storage-controls :deep(.kv-field-row){background:transparent;border:0;border-radius:0;padding:0;margin-bottom:10px}.storage-controls :deep(.kv-field-row .el-input__wrapper){box-shadow:0 0 0 1px var(--kp-border) inset}.storage-controls :deep(.kv-equals){background:transparent;color:var(--kp-muted)}.storage-controls :deep(.kv-add){border-radius:6px;background:transparent}.storage-controls :deep(.el-form-item__error){position:static;line-height:1.6;padding-top:6px}
@media(max-width:650px){.storage-controls :deep(.el-form-item){display:block}.storage-controls :deep(.el-form-item__label){float:none;width:auto!important;justify-content:flex-start;text-align:left}.storage-controls :deep(.el-form-item__content){margin-left:0!important}.storage-access-modes :deep(.el-checkbox-group){gap:4px 16px}.storage-form h2{margin-bottom:20px}}
</style>
