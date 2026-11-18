<template>
  <div class="rbac-form">
    <template v-if="isRole">
      <div class="rbac-heading"><h2>权限规则</h2><el-button :icon="Plus" :disabled="disabled" @click="addRule">添加规则</el-button></div>
      <p class="rbac-hint">每条规则分别指定 API 组、资源和允许执行的动作；核心 API 组使用「核心 API（空字符串）」。</p>
      <p v-if="!isClusterRole" class="rbac-hint">Role 定义命名空间「{{ bindingNamespace }}」内的权限，通过 RoleBinding 授权给主体。</p>
      <p v-else class="rbac-hint">ClusterRole 可定义命名空间内或集群级资源的权限，实际授权范围由绑定方式决定。</p>
      <p v-if="modelValue.aggregationRule" class="rbac-hint aggregation-hint">此 ClusterRole 使用 aggregationRule 聚合权限；现有聚合设置会保留，规则可能被聚合控制器更新。</p>
      <div v-for="(rule,index) in rules" :key="index" class="rbac-rule">
        <div class="rbac-row-heading"><strong>规则 {{ index + 1 }}</strong><el-button text type="danger" :icon="Delete" :disabled="disabled" :aria-label="`删除权限规则 ${index + 1}`" @click="removeRule(index)"/></div>
        <el-form label-width="105px" :disabled="disabled" class="rbac-controls">
          <el-form-item v-if="isClusterRole" label="规则类型"><el-radio-group :model-value="ruleType(rule)" :aria-label="`规则 ${index + 1} 类型`" @update:model-value="value=>setRuleType(index,value)"><el-radio-button value="resource">资源</el-radio-button><el-radio-button value="url">非资源 URL</el-radio-button></el-radio-group></el-form-item>
          <template v-if="ruleType(rule)==='resource'">
            <el-form-item label="API 组" required><el-select :model-value="rule.apiGroups||[]" multiple filterable allow-create default-first-option :aria-label="`规则 ${index + 1} API 组`" placeholder="选择 API 组或输入后回车" @update:model-value="value=>setRuleList(index,'apiGroups',value)"><el-option v-for="option in apiGroupOptions" :key="option.value" :label="option.label" :value="option.value"/></el-select></el-form-item>
            <el-form-item label="资源" required><el-select :model-value="rule.resources||[]" multiple filterable allow-create default-first-option :aria-label="`规则 ${index + 1} 资源`" placeholder="输入复数资源名或子资源后回车" @update:model-value="value=>setRuleList(index,'resources',value)"><el-option v-for="value in resourceOptions" :key="value" :label="value" :value="value"/></el-select><span class="rbac-field-hint">使用资源复数名；子资源写为 pods/log、deployments/scale。</span></el-form-item>
            <el-form-item label="资源名称"><el-select :model-value="rule.resourceNames||[]" multiple filterable allow-create default-first-option :aria-label="`规则 ${index + 1} 资源名称`" placeholder="可选，留空表示不按名称限制" @update:model-value="value=>setRuleList(index,'resourceNames',value)"/></el-form-item>
          </template>
          <el-form-item v-else label="非资源 URL" required><el-select :model-value="rule.nonResourceURLs||[]" multiple filterable allow-create default-first-option :aria-label="`规则 ${index + 1} 非资源 URL`" placeholder="输入以 / 开头的路径后回车" @update:model-value="value=>setRuleList(index,'nonResourceURLs',value)"/><span class="rbac-field-hint">可使用末尾通配符，例如 /healthz/*。</span></el-form-item>
          <el-form-item label="动作" required><el-select :model-value="rule.verbs||[]" multiple filterable allow-create default-first-option :aria-label="`规则 ${index + 1} 动作`" placeholder="选择动作或输入后回车" @update:model-value="value=>setRuleList(index,'verbs',value)"><el-option v-for="value in verbOptions" :key="value" :label="value" :value="value"/></el-select></el-form-item>
        </el-form>
      </div>
      <div v-if="!rules.length" class="rbac-empty">暂未配置权限规则。<el-button link type="primary" :disabled="disabled" @click="addRule">添加规则</el-button></div>
    </template>
    <template v-else>
      <h2>角色引用</h2>
      <p v-if="modelValue.kind==='RoleBinding'" class="rbac-hint">授权范围：命名空间「{{ bindingNamespace }}」。即使引用 ClusterRole，也只授予该命名空间内的权限。</p>
      <p v-else class="rbac-hint">授权范围：整个集群。所引用 ClusterRole 中的命名空间内权限会在所有命名空间生效。</p>
      <p v-if="!creating" class="rbac-hint">角色引用在创建后不可修改；如需更换角色，请新建绑定。</p>
      <el-form label-width="105px" class="rbac-controls reference-controls" :disabled="disabled||!creating">
        <el-form-item label="角色类型" required><el-select :model-value="modelValue.roleRef?.kind||''" aria-label="引用角色类型" @update:model-value="value=>setRoleRef('kind',value)"><el-option v-for="value in referenceKinds" :key="value" :label="value" :value="value"/></el-select></el-form-item>
        <el-form-item label="角色名称" required><el-input :model-value="modelValue.roleRef?.name||''" aria-label="引用角色名称" placeholder="直接填写已存在的角色名称" @update:model-value="value=>setRoleRef('name',value)"/><span class="rbac-field-hint">{{ modelValue.roleRef?.kind==='Role' ? `引用命名空间「${bindingNamespace}」中的 Role。` : '引用集群范围的 ClusterRole。' }}只填写名称，无需填写路径或命名空间前缀。</span></el-form-item>
        <el-form-item label="API 组"><code class="reference-group">{{ modelValue.roleRef?.apiGroup||RBAC_API_GROUP }}</code></el-form-item>
      </el-form>
      <div class="rbac-heading subject-heading"><h2>绑定主体</h2><el-button :icon="Plus" :disabled="disabled" @click="addSubject">添加主体</el-button></div>
      <p class="rbac-hint">为服务账号、用户或用户组绑定上述角色；主体名称需与集群中的身份一致。</p>
      <div v-for="(subject,index) in subjects" :key="index" class="rbac-subject">
        <div class="rbac-row-heading"><strong>主体 {{ index + 1 }}</strong><el-button text type="danger" :icon="Delete" :disabled="disabled" :aria-label="`删除绑定主体 ${index + 1}`" @click="removeSubject(index)"/></div>
        <el-form label-width="105px" :disabled="disabled" class="rbac-controls">
          <el-form-item label="主体类型" required><el-select :model-value="subject.kind" :aria-label="`主体 ${index + 1} 类型`" @update:model-value="value=>setSubjectKind(index,value)"><el-option v-for="value in subjectKinds" :key="value" :label="value" :value="value"/></el-select></el-form-item>
          <el-form-item label="名称" required><el-input :model-value="subject.name||''" :aria-label="`主体 ${index + 1} 名称`" :placeholder="subject.kind==='ServiceAccount'?'直接填写 ServiceAccount 名称':'填写认证系统中的用户或用户组名称'" @update:model-value="value=>setSubjectField(index,'name',value)"/><span v-if="subject.kind==='ServiceAccount'" class="rbac-field-hint">只填写服务账号名称，命名空间在下方单独指定。</span></el-form-item>
          <el-form-item v-if="subject.kind==='ServiceAccount'" label="命名空间" required><el-input :model-value="subjectNamespace(subject)" :aria-label="`主体 ${index + 1} 命名空间`" placeholder="服务账号所在命名空间" @update:model-value="value=>setSubjectField(index,'namespace',value)"/><span class="rbac-field-hint">此处标识服务账号所在位置；权限作用范围由绑定决定。</span></el-form-item>
          <el-form-item label="API 组"><code class="reference-group">{{ subject.kind==='ServiceAccount'?'核心 API（空字符串）':subject.apiGroup||RBAC_API_GROUP }}</code></el-form-item>
        </el-form>
      </div>
      <div v-if="!subjects.length" class="rbac-empty">暂未添加绑定主体。<el-button link type="primary" :disabled="disabled" @click="addSubject">添加主体</el-button></div>
    </template>
    <p v-if="touched&&validationError" class="rbac-error" role="alert">{{ validationError }}</p>
  </div>
</template>

<script setup>
import {computed,ref,watch} from 'vue'
import {Plus,Delete} from '@element-plus/icons-vue'
import {RBAC_API_GROUP,rbacDraftFields,validateRbacResource} from '../utils/rbac-form'

const props=defineProps({modelValue:{type:Object,required:true},creating:Boolean,disabled:Boolean})
const emit=defineEmits(['change','validity'])
const original=ref(JSON.parse(JSON.stringify(props.modelValue))),touched=ref(false)
const isRole=computed(()=>['Role','ClusterRole'].includes(props.modelValue.kind))
const isClusterRole=computed(()=>props.modelValue.kind==='ClusterRole')
const bindingNamespace=computed(()=>props.modelValue.metadata?.namespace||'尚未填写')
const rules=computed(()=>Array.isArray(props.modelValue.rules)?props.modelValue.rules:[])
const subjects=computed(()=>Array.isArray(props.modelValue.subjects)?props.modelValue.subjects:[])
const referenceKinds=computed(()=>props.modelValue.kind==='RoleBinding'?['Role','ClusterRole']:['ClusterRole'])
const subjectKinds=['ServiceAccount','User','Group']
const apiGroupOptions=[{value:'',label:'核心 API（空字符串）'},...['apps','batch','networking.k8s.io','rbac.authorization.k8s.io','*'].map(value=>({value,label:value}))]
const resourceOptions=['pods','pods/log','pods/exec','services','configmaps','secrets','deployments','deployments/scale','statefulsets','daemonsets','jobs','cronjobs','ingresses','roles','rolebindings','*']
const verbOptions=['get','list','watch','create','update','patch','delete','deletecollection','bind','escalate','impersonate','*']
const validationError=computed(()=>{try{validateRbacResource(props.modelValue,{creating:props.creating,original:original.value});return ''}catch(error){return error.message}})
const fieldValidity=computed(()=>touched.value?validationError.value:'')
watch(fieldValidity,value=>emit('validity',value),{immediate:true})
watch(()=>props.modelValue,value=>{original.value=JSON.parse(JSON.stringify(value));touched.value=false})

function changed(){touched.value=true;emit('change')}
function ruleType(rule){return rule.nonResourceURLs?.length||Object.hasOwn(rule,'nonResourceURLs')&&!rule.resources?.length&&!rule.apiGroups?.length?'url':'resource'}
function addRule(){if(props.disabled||!isRole.value)return;if(!Array.isArray(props.modelValue.rules))props.modelValue.rules=[];props.modelValue.rules.push(rbacDraftFields(props.modelValue.kind).rules[0]);changed()}
function removeRule(index){if(props.disabled||!isRole.value||!rules.value[index])return;props.modelValue.rules.splice(index,1);changed()}
function setRuleType(index,value){
 if(props.disabled||!isClusterRole.value||!['resource','url'].includes(value)||!rules.value[index])return
 const rule=rules.value[index];if(ruleType(rule)===value)return
 if(value==='url'){for(const key of ['apiGroups','resources','resourceNames'])delete rule[key];rule.nonResourceURLs=[]}
 else{delete rule.nonResourceURLs;rule.apiGroups=[''];rule.resources=[]}
 changed()
}
function setRuleList(index,key,value){
 if(props.disabled||!isRole.value||!rules.value[index]||!Array.isArray(value)||!['apiGroups','resources','resourceNames','verbs','nonResourceURLs'].includes(key))return
 const rule=rules.value[index],type=ruleType(rule)
 if(key==='nonResourceURLs'&&type!=='url'||['apiGroups','resources','resourceNames'].includes(key)&&type!=='resource')return
 if(key==='resourceNames'&&!value.length)delete rule[key];else rule[key]=[...value]
 changed()
}
function setRoleRef(key,value){
 if(props.disabled||!props.creating||isRole.value||!['kind','name'].includes(key)||key==='kind'&&!referenceKinds.value.includes(value))return
 if(!props.modelValue.roleRef)props.modelValue.roleRef=rbacDraftFields(props.modelValue.kind).roleRef
 props.modelValue.roleRef[key]=value;changed()
}
function subjectNamespace(subject){return subject.namespace??(props.modelValue.kind==='RoleBinding'?props.modelValue.metadata?.namespace:'')}
function addSubject(){if(props.disabled||isRole.value)return;if(!Array.isArray(props.modelValue.subjects))props.modelValue.subjects=[];props.modelValue.subjects.push(rbacDraftFields(props.modelValue.kind).subjects[0]);changed()}
function removeSubject(index){if(props.disabled||isRole.value||!subjects.value[index])return;props.modelValue.subjects.splice(index,1);changed()}
function setSubjectKind(index,value){
 if(props.disabled||isRole.value||!subjects.value[index]||!subjectKinds.includes(value))return
 const subject=subjects.value[index],previousKind=subject.kind;subject.kind=value;subject.apiGroup=value==='ServiceAccount'?'':RBAC_API_GROUP
 if(value==='ServiceAccount'&&previousKind!=='ServiceAccount'){if(props.modelValue.kind==='RoleBinding')delete subject.namespace;else subject.namespace=''}
 else if(value!=='ServiceAccount')delete subject.namespace
 changed()
}
function setSubjectField(index,key,value){
 if(props.disabled||isRole.value||!subjects.value[index]||!['name','namespace'].includes(key)||key==='namespace'&&subjects.value[index].kind!=='ServiceAccount')return
 subjects.value[index][key]=value;changed()
}
</script>

<style scoped>
.rbac-form{max-width:1040px;min-width:0;color:var(--kp-text);font-size:14px}.rbac-form h2{font-size:16px;font-weight:600;margin:0 0 22px}.rbac-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}.rbac-heading h2{margin:0}.rbac-hint{font-size:13px;line-height:1.7;color:var(--kp-muted);margin:0 0 20px}.aggregation-hint{padding:10px 14px;background:var(--kp-surface-2);border-radius:6px}.rbac-rule,.rbac-subject{border:1px solid var(--kp-border);border-radius:8px;margin-bottom:18px;padding:16px 20px 4px}.rbac-row-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.rbac-row-heading strong{font-weight:600;font-size:13px}.rbac-row-heading .el-button{padding:5px;min-height:26px}.rbac-controls{max-width:900px}.rbac-controls :deep(.el-form-item){margin-bottom:20px}.rbac-controls :deep(.el-form-item__label){font-size:13px;color:var(--kp-text-2)}.rbac-controls :deep(.el-form-item__content){min-width:0}.rbac-controls :deep(.el-select){width:100%}.rbac-field-hint{width:100%;color:var(--kp-muted);font-size:12px;line-height:1.6;margin-top:6px}.reference-controls{max-width:900px}.reference-group{font-size:12px;color:var(--kp-muted);overflow-wrap:anywhere}.subject-heading{border-top:1px solid var(--kp-border);padding-top:22px;margin-top:26px}.rbac-empty{padding:24px;text-align:center;color:var(--kp-muted);border:1px dashed var(--kp-border);border-radius:8px}.rbac-error{color:var(--el-color-danger);font-size:13px;line-height:1.7;margin:18px 0 0}
@media(max-width:650px){.rbac-rule,.rbac-subject{padding:14px 12px 0}.rbac-controls :deep(.el-form-item){display:block}.rbac-controls :deep(.el-form-item__label){float:none;width:auto!important;justify-content:flex-start;text-align:left}.rbac-controls :deep(.el-form-item__content){margin-left:0!important}.rbac-hint{font-size:12px}.rbac-heading{gap:10px}}
</style>
