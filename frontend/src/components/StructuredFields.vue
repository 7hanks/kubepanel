<template>
  <div class="structured-fields" :class="{'structured-nested':depth>0}">
    <template v-if="isObject||isArray">
      <div v-for="(value,key) in modelValue" :key="key" class="structured-field">
        <details v-if="value!==null&&typeof value==='object'" :open="depth<1"><summary><span>{{fieldLabel(key)}}</span><code>{{isArray?'':key}}</code><el-button :disabled="disabled" type="danger" text size="small" :aria-label="`删除字段 ${path}.${key}`" @click.prevent="remove(key)">移除</el-button></summary><StructuredFields :model-value="value" :path="`${path}.${key}`" :depth="depth+1" :disabled="disabled" @update:model-value="next=>set(key,next)"/></details>
        <div v-else class="structured-scalar"><label>{{fieldLabel(key)}}<code v-if="!isArray">{{key}}</code></label><el-switch v-if="typeof value==='boolean'" :model-value="value" :disabled="disabled" :aria-label="`${path}.${key}`" @update:model-value="next=>set(key,next)"/><el-input-number v-else-if="typeof value==='number'" :model-value="value" :disabled="disabled" :aria-label="`${path}.${key}`" @update:model-value="next=>set(key,next??0)"/><el-input v-else :model-value="value===null?'':String(value)" :disabled="disabled" :aria-label="`${path}.${key}`" :type="String(value||'').includes('\n')?'textarea':'text'" :autosize="{minRows:2,maxRows:8}" @update:model-value="next=>set(key,next)"/><el-button :disabled="disabled" type="danger" text :aria-label="`删除字段 ${path}.${key}`" @click="remove(key)">移除</el-button></div>
      </div>
      <div class="structured-add"><el-input v-if="!isArray" v-model="newKey" :disabled="disabled" placeholder="字段名称，如 nodeSelector" :aria-label="`新字段 ${path}`"/><el-select v-model="newType" :disabled="disabled" :aria-label="`字段类型 ${path}`"><el-option v-for="item in types" :key="item.value" :label="item.label" :value="item.value"/></el-select><el-button :disabled="disabled" :icon="Plus" @click="add">{{isArray?'添加项目':'添加字段'}}</el-button></div>
      <p v-if="error" class="structured-error" role="alert">{{error}}</p>
    </template>
    <el-input v-else :model-value="String(modelValue??'')" :disabled="disabled" :aria-label="path" @update:model-value="value=>emit('update:modelValue',value)"/>
  </div>
</template>
<script setup>
import {ref,computed} from 'vue'
import {Plus} from '@element-plus/icons-vue'
defineOptions({name:'StructuredFields'})
const props=defineProps({modelValue:{},path:{type:String,default:'spec'},depth:{type:Number,default:0},disabled:Boolean,reservedKeys:{type:Array,default:()=>[]}})
const emit=defineEmits(['update:modelValue'])
const newKey=ref(''),newType=ref('string'),error=ref('')
const isArray=computed(()=>Array.isArray(props.modelValue)),isObject=computed(()=>props.modelValue!==null&&typeof props.modelValue==='object'&&!isArray.value)
const types=[{label:'文本',value:'string'},{label:'数值',value:'number'},{label:'开关',value:'boolean'},{label:'对象',value:'object'},{label:'数组',value:'array'}]
const labels={replicas:'副本数',schedule:'调度表达式',concurrencyPolicy:'并发策略',suspend:'暂停',serviceName:'服务名称',type:'类型',selector:'选择器',matchLabels:'匹配标签',restartPolicy:'重启策略',nodeName:'节点名称',nodeSelector:'节点选择器',serviceAccountName:'服务账号',hostNetwork:'宿主机网络',dnsPolicy:'DNS 策略',imagePullSecrets:'镜像仓库密文',affinity:'亲和性',tolerations:'容忍度',volumes:'数据卷',volumeMounts:'挂载目录',mountPath:'挂载路径',name:'名称',persistentVolumeClaim:'PVC',claimName:'PVC 名称',configMap:'ConfigMap',secret:'Secret',emptyDir:'临时目录',hostPath:'宿主机目录',path:'路径',ports:'端口',port:'服务端口',targetPort:'目标端口',protocol:'协议',accessModes:'访问模式',storageClassName:'存储类',resources:'资源',requests:'请求',limits:'限制',storage:'存储空间',rules:'规则',subjects:'授权主体',roleRef:'绑定角色',binaryData:'二进制数据（Base64）',data:'数据',stringData:'文本数据',immutable:'不可变',ingressClassName:'Ingress 类',provisioner:'供给器',parameters:'参数'}
function fieldLabel(key){return isArray.value?`项目 ${Number(key)+1}`:labels[key]||key}
function set(key,value){const next=isArray.value?[...props.modelValue]:{...props.modelValue};Object.defineProperty(next,key,{value,writable:true,enumerable:true,configurable:true});emit('update:modelValue',next)}
function remove(key){const next=isArray.value?[...props.modelValue]:{...props.modelValue};if(isArray.value)next.splice(Number(key),1);else delete next[key];emit('update:modelValue',next)}
function add(){const key=newKey.value.trim();if(!isArray.value&&props.reservedKeys.includes(key)){error.value='此字段由专用表单管理，请在对应设置中修改';return}if(!isArray.value&&(!key||['__proto__','constructor','prototype'].includes(key)||Object.hasOwn(props.modelValue,key))){error.value='字段名称不能为空、重复或使用保留名称';return}const value={string:'',number:0,boolean:false,object:{},array:[]}[newType.value];if(isArray.value)emit('update:modelValue',[...props.modelValue,value]);else set(key,value);newKey.value='';error.value=''}
</script>
<style scoped>
.structured-fields{min-width:0}.structured-field{margin-bottom:12px}.structured-nested{border-left:2px solid var(--kp-border);margin:8px 0 6px 10px;padding:8px 0 0 16px}.structured-field details{border:1px solid var(--kp-border);border-radius:8px;padding:8px 12px}.structured-field summary{cursor:pointer;color:var(--kp-text);font-weight:600;min-height:32px;line-height:32px}.structured-field code{font-weight:400;color:var(--kp-muted);font-size:12px;margin-left:10px;overflow-wrap:anywhere}.structured-field summary>.el-button{float:right}.structured-scalar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.structured-scalar>label{width:190px;font-size:13px;overflow-wrap:anywhere}.structured-scalar>label>code{display:block;margin:3px 0 0}.structured-scalar>.el-input,.structured-scalar>.el-textarea{flex:1;min-width:150px}.structured-add{display:flex;gap:10px;flex-wrap:wrap;padding:6px 0}.structured-add>.el-input{flex:1;min-width:150px}.structured-add>.el-select{width:100px}.structured-error{color:var(--el-color-danger);font-size:13px}
@media(max-width:700px){.structured-scalar>label{width:100%}.structured-nested{margin-left:0;padding-left:10px}}
</style>
