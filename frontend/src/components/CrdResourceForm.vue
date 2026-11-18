<template>
 <div class="crd-resource-form">
  <el-form label-position="top" :disabled="disabled" class="crd-basic-fields">
   <el-form-item label="API 组"><el-input :model-value="spec.group||''" :disabled="!creating" aria-label="CRD API 组" placeholder="例如 example.com" @update:model-value="setGroup"/></el-form-item>
   <el-form-item label="资源复数名称"><el-input :model-value="spec.names?.plural||''" :disabled="!creating" aria-label="CRD 复数名称" placeholder="例如 widgets" @update:model-value="value=>setName('plural',value)"/></el-form-item>
   <el-form-item label="资源单数名称"><el-input :model-value="spec.names?.singular||''" aria-label="CRD 单数名称" placeholder="例如 widget；留空由服务端推导" @update:model-value="value=>setName('singular',value)"/></el-form-item>
   <el-form-item label="资源类型 Kind"><el-input :model-value="spec.names?.kind||''" :disabled="!creating" aria-label="CRD 资源类型" placeholder="例如 Widget" @update:model-value="value=>setName('kind',value)"/></el-form-item>
   <el-form-item label="作用范围"><el-select :model-value="spec.scope||''" :disabled="!creating" aria-label="CRD 作用范围" @update:model-value="value=>setField('scope',value)"><el-option label="命名空间（Namespaced）" value="Namespaced"/><el-option label="集群（Cluster）" value="Cluster"/></el-select></el-form-item>
  </el-form>
  <p class="crd-hint">资源名称必须为 <code>{{derivedName||'复数名称.API组'}}</code>。新建时会同步空名称或先前自动生成的名称，手工填写的名称保持不变。</p>
  <p v-if="!creating" class="crd-hint">API 组、复数名称、资源类型和作用范围创建后不可修改。</p>
  <details><summary>其他资源名称设置</summary><StructuredFields :model-value="nameAdditionalFields" :reserved-keys="nameFields" :disabled="disabled" path="spec.names" @update:model-value="setNameAdditionalFields"/></details>
  <h3>API 版本</h3><p class="crd-hint">至少启用一个 served 版本，且只能有一个 storage 版本。OpenAPI schema 根类型必须是 object；定义允许保存的字段，完整规则由服务端预检。</p>
  <section v-for="(version,index) in spec.versions||[]" :key="index" class="crd-version">
   <div class="crd-version-heading"><strong>版本 {{index+1}}</strong><el-button text type="danger" :disabled="disabled" @click="removeVersion(index)">删除版本</el-button></div>
   <div class="crd-version-settings"><el-input v-model="version.name" :disabled="disabled" :aria-label="`CRD 版本名称 ${index+1}`" placeholder="例如 v1 / v2beta1" @update:model-value="changed"/><el-checkbox v-model="version.served" :disabled="disabled" :aria-label="`对外服务版本 ${index+1}`" @change="changed">served（提供 API）</el-checkbox><el-radio :model-value="version.storage===true?'storage':''" value="storage" :disabled="disabled" :aria-label="`存储版本 ${index+1}`" @change="setStorageVersion(index)">storage（存储版本）</el-radio></div>
   <details open><summary>OpenAPI v3 schema</summary><StructuredFields :model-value="version.schema?.openAPIV3Schema||{}" :disabled="disabled" :path="`versions.${index}.schema.openAPIV3Schema`" @update:model-value="value=>setVersionSchema(version,value)"/></details>
   <details><summary>版本高级设置</summary><StructuredFields :model-value="extra(version,['name','served','storage','schema'])" :reserved-keys="['name','served','storage','schema']" :disabled="disabled" :path="`versions.${index}`" @update:model-value="value=>replaceExtra(version,['name','served','storage','schema'],value)"/><StructuredFields :model-value="extra(version.schema||{},['openAPIV3Schema'])" :reserved-keys="['openAPIV3Schema']" :disabled="disabled" :path="`versions.${index}.schema`" @update:model-value="value=>setSchemaAdditionalFields(version,value)"/></details>
  </section>
  <el-button :disabled="disabled" @click="addVersion">添加 API 版本</el-button>
  <details class="crd-additional"><summary>其他 CRD 设置</summary><StructuredFields :model-value="additionalFields" :reserved-keys="managedFields" :disabled="disabled" path="spec" @update:model-value="setAdditionalFields"/></details>
 </div>
</template>
<script setup>
import {computed,ref,watch} from 'vue'
import {validateCrdResource} from '../utils/crd-resource-form'
import StructuredFields from './StructuredFields.vue'
const props=defineProps({modelValue:{type:Object,required:true},original:Object,creating:Boolean,disabled:Boolean})
const emit=defineEmits(['change','validity'])
const fallbackOriginal=JSON.parse(JSON.stringify(props.modelValue)),touched=ref(false)
const spec=computed(()=>props.modelValue.spec||{}),derivedName=computed(()=>spec.value.names?.plural&&spec.value.group?`${spec.value.names.plural}.${spec.value.group}`:'')
const managedFields=['group','names','scope','versions'],nameFields=['plural','singular','kind']
const additionalFields=computed(()=>extra(spec.value,managedFields)),nameAdditionalFields=computed(()=>extra(spec.value.names||{},nameFields))
const validity=computed(()=>{if(!touched.value)return '';try{validateCrdResource(props.modelValue,{creating:props.creating,original:props.creating?undefined:props.original||fallbackOriginal});return ''}catch(error){return error.message}})
watch(validity,value=>emit('validity',value),{immediate:true})
function changed(){if(!props.disabled){touched.value=true;emit('change')}}
function ensureSpec(){return props.modelValue.spec||={}}
function extra(target,keys){return Object.fromEntries(Object.entries(target||{}).filter(([key])=>!keys.includes(key)))}
function replaceExtra(target,keys,value){if(props.disabled)return;for(const key of Object.keys(target))if(!keys.includes(key))delete target[key];for(const [key,item] of Object.entries(value||{}))if(!keys.includes(key)&&!['__proto__','constructor','prototype'].includes(key))target[key]=item;changed()}
function syncName(previous){if(!props.creating)return;props.modelValue.metadata||={};if(!props.modelValue.metadata.name||props.modelValue.metadata.name===previous)props.modelValue.metadata.name=derivedName.value}
function setGroup(value){if(props.disabled||!props.creating)return;const previous=derivedName.value;ensureSpec().group=value;syncName(previous);changed()}
function setName(key,value){if(props.disabled||!nameFields.includes(key)||!props.creating&&key!=='singular')return;const previous=derivedName.value;ensureSpec().names||={};ensureSpec().names[key]=value;syncName(previous);changed()}
function setField(key,value){if(props.disabled||!props.creating||key!=='scope')return;ensureSpec()[key]=value;changed()}
function setNameAdditionalFields(value){if(props.disabled)return;ensureSpec().names||={};replaceExtra(ensureSpec().names,nameFields,value)}
function setAdditionalFields(value){if(props.disabled)return;replaceExtra(ensureSpec(),managedFields,value)}
function setVersionSchema(version,value){if(props.disabled)return;version.schema||={};version.schema.openAPIV3Schema=value;changed()}
function setSchemaAdditionalFields(version,value){if(props.disabled)return;version.schema||={};replaceExtra(version.schema,['openAPIV3Schema'],value)}
function setStorageVersion(index){if(props.disabled)return;for(const [position,version] of (spec.value.versions||[]).entries())version.storage=position===index;changed()}
function addVersion(){if(props.disabled)return;const versions=ensureSpec().versions||=[];let number=1;while(versions.some(version=>version.name===`v${number}`))number++;versions.push({name:`v${number}`,served:true,storage:versions.length===0,schema:{openAPIV3Schema:{type:'object',properties:{}}}});changed()}
function removeVersion(index){if(props.disabled)return;ensureSpec().versions.splice(index,1);changed()}
</script>
<style scoped>
.crd-resource-form{min-width:0}.crd-basic-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 20px}.crd-basic-fields .el-select{width:100%}.crd-hint{font-size:13px;line-height:1.65;color:var(--kp-muted);overflow-wrap:anywhere}.crd-resource-form h3{font-size:15px;margin:24px 0 10px}.crd-version{border:1px solid var(--kp-border);border-radius:8px;padding:16px;margin:14px 0}.crd-version-heading,.crd-version-settings{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:12px}.crd-version-heading{justify-content:space-between}.crd-version-settings>.el-input{width:190px}.crd-version-settings>.el-checkbox{margin-right:0}.crd-resource-form details{margin:15px 0}.crd-resource-form summary{font-size:13px;cursor:pointer;color:var(--kp-text-2);margin-bottom:12px}.crd-additional{border-top:1px solid var(--kp-border);padding-top:16px;margin-top:22px!important}
@media(max-width:650px){.crd-basic-fields{grid-template-columns:1fr}.crd-version{padding:12px}.crd-version-settings>.el-input{width:100%}}
</style>
