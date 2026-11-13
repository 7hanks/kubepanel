<template>
  <div v-if="pod" class="workload-form">
    <template v-if="section==='containers'">
      <div v-if="podLocked" class="workload-note">已有 Pod 可在此修改容器镜像；容器结构与运行参数受 Kubernetes 不可变字段限制。</div>
      <div class="container-workspace">
        <aside class="container-selector"><div class="container-add"><el-button :disabled="disabled||podLocked" @click="addContainer(true)">添加初始化容器</el-button><el-button :disabled="disabled||podLocked" type="primary" @click="addContainer(false)">添加工作容器</el-button></div>
          <div v-for="item in containers" :key="item.key" class="container-choice" :class="{active:selected===item.key}"><button type="button" :disabled="disabled" @click="selected=item.key"><span class="container-kind">{{item.init?'初始化容器':'工作容器'}}</span><strong>{{item.container.name||'未命名容器'}}</strong></button><el-button :disabled="disabled||podLocked" text type="danger" :icon="Delete" :aria-label="`删除容器 ${item.container.name}`" @click="removeContainer(item)"/></div>
        </aside>
        <section v-if="current" class="container-settings" :aria-label="`容器配置 ${current.name}`">
          <div class="form-section-title">{{currentInit?'初始化容器':'工作容器'}}</div>
          <el-form-item label="名称" required><el-input v-model="current.name" :disabled="disabled||podLocked" aria-label="容器名称"/></el-form-item>
          <el-form-item label="容器镜像" required><el-input v-model="current.image" :disabled="disabled" aria-label="容器镜像" placeholder="例如 nginx:1.25-alpine"/></el-form-item>
          <el-form-item label="拉取策略"><el-radio-group :model-value="current.imagePullPolicy||''" :disabled="disabled||podLocked" @update:model-value="value=>{if(value)current.imagePullPolicy=value;else delete current.imagePullPolicy}"><el-radio value="">使用默认</el-radio><el-radio value="Always">Always</el-radio><el-radio value="IfNotPresent">IfNotPresent</el-radio><el-radio value="Never">Never</el-radio></el-radio-group></el-form-item>
          <el-collapse>
            <el-collapse-item title="命令 / 参数 / 工作目录" name="command"><div class="container-grid"><el-form-item label="命令"><el-input :model-value="(current.command||[]).join('\n')" :disabled="disabled||podLocked" type="textarea" :rows="3" aria-label="容器命令" placeholder="每行一个命令项" @update:model-value="value=>setLines('command',value)"/></el-form-item><el-form-item label="参数"><el-input :model-value="(current.args||[]).join('\n')" :disabled="disabled||podLocked" type="textarea" :rows="3" aria-label="容器参数" placeholder="每行一个参数" @update:model-value="value=>setLines('args',value)"/></el-form-item></div><el-form-item label="工作目录"><el-input v-model="current.workingDir" :disabled="disabled||podLocked" aria-label="工作目录"/></el-form-item></el-collapse-item>
            <el-collapse-item title="环境变量" name="env">
              <div v-for="(env,index) in current.env||[]" :key="index" class="env-entry"><div class="env-row"><el-input v-model="env.name" :disabled="disabled||podLocked" :aria-label="`环境变量名称 ${index+1}`" placeholder="变量名"/><el-select :model-value="envMode(env)" :disabled="disabled||podLocked" :aria-label="`环境变量来源 ${index+1}`" @update:model-value="value=>setEnvMode(env,value)"><el-option label="文本" value="value"/><el-option label="ConfigMap" value="configMapKeyRef"/><el-option label="Secret" value="secretKeyRef"/><el-option label="Pod 字段" value="fieldRef"/><el-option v-if="envMode(env)==='advanced'" label="其他引用" value="advanced"/></el-select><el-input v-if="envMode(env)==='value'" v-model="env.value" :disabled="disabled||podLocked" :aria-label="`环境变量值 ${index+1}`" placeholder="变量值"/><el-button :disabled="disabled||podLocked" type="danger" text :icon="Delete" :aria-label="`删除环境变量 ${index+1}`" @click="current.env.splice(index,1)"/></div><StructuredFields v-if="env.valueFrom" v-model="env.valueFrom" :disabled="disabled||podLocked" :path="`env.${env.name}.valueFrom`"/></div>
              <el-button :disabled="disabled||podLocked" :icon="Plus" @click="addEnv">添加环境变量</el-button>
            </el-collapse-item>
            <el-collapse-item title="资源请求与限制" name="resources"><div class="container-grid"><el-form-item v-for="item in resourceFields" :key="item.type+item.key" :label="item.label"><el-input :model-value="current.resources?.[item.type]?.[item.key]||''" :disabled="disabled||podLocked" :aria-label="item.label" :placeholder="item.key==='cpu'?'例如 100m / 1':'例如 128Mi / 1Gi'" @update:model-value="value=>setResource(item.type,item.key,value)"/></el-form-item></div></el-collapse-item>
            <el-collapse-item title="容器端口" name="ports"><div v-for="(port,index) in current.ports||[]" :key="index" class="port-row"><el-select v-model="port.protocol" :disabled="disabled||podLocked" :aria-label="`端口协议 ${index+1}`"><el-option v-for="protocol in ['TCP','UDP','SCTP']" :key="protocol" :label="protocol" :value="protocol"/></el-select><el-input v-model="port.name" :disabled="disabled||podLocked" :aria-label="`端口名称 ${index+1}`" placeholder="端口名称"/><el-input-number v-model="port.containerPort" :disabled="disabled||podLocked" :min="1" :max="65535" :aria-label="`容器端口 ${index+1}`"/><el-button :disabled="disabled||podLocked" type="danger" text :icon="Delete" :aria-label="`删除端口 ${index+1}`" @click="current.ports.splice(index,1)"/></div><el-button :disabled="disabled||podLocked" :icon="Plus" @click="addPort">添加端口</el-button></el-collapse-item>
            <el-collapse-item title="数据卷挂载" name="mounts"><StructuredFields :model-value="current.volumeMounts||[]" :disabled="disabled||podLocked" path="volumeMounts" @update:model-value="value=>current.volumeMounts=value"/><el-button :disabled="disabled||podLocked" :icon="Plus" @click="addMount">添加挂载</el-button></el-collapse-item>
            <el-collapse-item title="探针、安全上下文和其他容器设置" name="advanced"><StructuredFields :model-value="containerExtra" :reserved-keys="containerKeys" :disabled="disabled||podLocked" path="container" @update:model-value="setContainerExtra"/></el-collapse-item>
          </el-collapse>
        </section><el-empty v-else description="请添加一个工作容器"/>
      </div>
    </template>
    <template v-else-if="section==='volumes'"><div class="form-section-title">数据卷</div><div class="volume-add"><el-select v-model="volumeType" :disabled="disabled||podLocked" aria-label="数据卷类型"><el-option label="临时目录 emptyDir" value="emptyDir"/><el-option label="ConfigMap" value="configMap"/><el-option label="Secret" value="secret"/><el-option label="持久卷 PVC" value="persistentVolumeClaim"/><el-option label="宿主机目录 hostPath" value="hostPath"/></el-select><el-button :disabled="disabled||podLocked" :icon="Plus" @click="addVolume">添加数据卷</el-button></div><StructuredFields :model-value="pod.volumes||[]" :disabled="disabled||podLocked" path="volumes" @update:model-value="value=>pod.volumes=value"/></template>
    <WorkloadPodSettings v-else-if="section==='pod'" :model-value="modelValue" :creating="creating" :disabled="disabled" @change="emit('change')" @validity="value=>emit('validity',value)"/>
    <WorkloadStrategyForm v-else-if="section==='strategy'" :model-value="modelValue" :creating="creating" :disabled="disabled" @change="emit('change')" @validity="value=>emit('validity',value)"/>
  </div>
  <el-alert v-else type="warning" :closable="false" title="当前资源缺少容器模板，请在 YAML 中检查配置。"/>
</template>
<script setup>
import {ref,computed,watch} from 'vue'
import {Plus,Delete} from '@element-plus/icons-vue'
import {podSpec,mergeFormFields} from '../utils/resource-form'
import StructuredFields from './StructuredFields.vue'
import WorkloadStrategyForm from './WorkloadStrategyForm.vue'
import WorkloadPodSettings from './WorkloadPodSettings.vue'
const props=defineProps({modelValue:Object,section:{type:String,default:'containers'},creating:Boolean,disabled:Boolean})
const emit=defineEmits(['change','validity'])
const pod=computed(()=>podSpec(props.modelValue)),podLocked=computed(()=>props.modelValue.kind==='Pod'&&!props.creating)
const selected=ref('containers:0'),volumeType=ref('emptyDir')
const containers=computed(()=>['containers','initContainers'].flatMap(type=>(pod.value?.[type]||[]).map((container,index)=>({container,type,index,key:`${type}:${index}`,init:type==='initContainers'}))))
const choice=computed(()=>containers.value.find(item=>item.key===selected.value)||containers.value[0]),current=computed(()=>choice.value?.container),currentInit=computed(()=>choice.value?.init)
watch(()=>props.modelValue,()=>{selected.value='containers:0'})
const resourceFields=[{type:'requests',key:'cpu',label:'CPU 请求'},{type:'limits',key:'cpu',label:'CPU 限制'},{type:'requests',key:'memory',label:'内存请求'},{type:'limits',key:'memory',label:'内存限制'}]
const restartPolicies=computed(()=>['Job','CronJob'].includes(props.modelValue.kind)?['OnFailure','Never']:['Always','OnFailure','Never'])
const containerKeys=['name','image','imagePullPolicy','command','args','workingDir','env','resources','ports','volumeMounts']
const podKeys=['containers','initContainers','volumes','restartPolicy','serviceAccountName','imagePullSecrets']
const omit=(object,keys)=>Object.fromEntries(Object.entries(object||{}).filter(([key])=>!keys.includes(key)))
const containerExtra=computed(()=>omit(current.value,containerKeys)),podExtra=computed(()=>omit(pod.value,podKeys)),strategy=computed(()=>omit(props.modelValue.spec,['template','jobTemplate']))
function replaceSubset(object,keys,next){const merged=mergeFormFields(object,keys,next);for(const key of Object.keys(object))if(!keys.includes(key))delete object[key];for(const [key,value] of Object.entries(merged))object[key]=value}
function setContainerExtra(value){replaceSubset(current.value,containerKeys,value)}
function setPodExtra(value){replaceSubset(pod.value,podKeys,value)}
function setStrategy(value){replaceSubset(props.modelValue.spec,['template','jobTemplate'],value)}
function addContainer(init){const type=init?'initContainers':'containers';pod.value[type]||=[];let n=1;while(containers.value.some(item=>item.container.name===`${init?'init':'app'}-${n}`))n++;pod.value[type].push({name:`${init?'init':'app'}-${n}`,image:''});selected.value=`${type}:${pod.value[type].length-1}`}
function removeContainer(item){pod.value[item.type].splice(item.index,1);selected.value=containers.value[0]?.key||'containers:0'}
function setLines(key,value){if(value==='')delete current.value[key];else current.value[key]=value.split('\n')}
function addEnv(){current.value.env||=[];current.value.env.push({name:'',value:''})}
function envMode(env){return env.valueFrom?['secretKeyRef','configMapKeyRef','fieldRef'].find(key=>env.valueFrom[key])||'advanced':'value'}
function setEnvMode(env,mode){delete env.value;delete env.valueFrom;if(mode==='value')env.value='';else env.valueFrom={[mode]:mode==='fieldRef'?{fieldPath:'metadata.name'}:{name:'',key:''}}}
function setResource(type,key,value){current.value.resources||={};current.value.resources[type]||={};if(value)current.value.resources[type][key]=value;else delete current.value.resources[type][key]}
function addPort(){current.value.ports||=[];current.value.ports.push({containerPort:80,protocol:'TCP'})}
function addMount(){current.value.volumeMounts||=[];current.value.volumeMounts.push({name:'',mountPath:''})}
function addVolume(){pod.value.volumes||=[];const source={emptyDir:{},configMap:{name:''},secret:{secretName:''},persistentVolumeClaim:{claimName:''},hostPath:{path:'',type:'DirectoryOrCreate'}}[volumeType.value];pod.value.volumes.push({name:`volume-${pod.value.volumes.length+1}`,[volumeType.value]:source})}
</script>
<style scoped>
.workload-form{min-width:0}.container-workspace{display:grid;grid-template-columns:240px minmax(0,1fr);gap:24px}.container-selector{min-width:0}.container-add{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}.container-add>.el-button+.el-button{margin-left:0}.container-choice{position:relative;border:1px solid var(--kp-border);border-radius:9px;margin-bottom:10px;background:var(--kp-surface-2);overflow:hidden}.container-choice.active{background:var(--kp-side-active);border-color:var(--kp-brand)}.container-choice>button:not(.el-button){width:100%;padding:14px 42px 14px 14px;background:transparent;border:0;text-align:left;cursor:pointer;color:var(--kp-text);font:inherit}.container-choice.active>button{color:var(--kp-brand)}.container-choice>.el-button{position:absolute;right:6px;top:9px}.container-kind{display:block;font-size:12px;margin-bottom:8px;color:var(--kp-muted)}.container-choice strong{display:block;overflow-wrap:anywhere}.container-settings{min-width:0;border:1px solid var(--kp-border);border-radius:10px;padding:22px}.form-section-title{font-size:15px;font-weight:650;margin-bottom:22px}.container-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 20px}.env-entry{padding:12px 0;border-bottom:1px solid var(--kp-border);margin-bottom:12px}.env-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.env-row>.el-input{flex:1;min-width:120px}.env-row>.el-select{width:135px}.port-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.port-row>.el-select{width:95px}.port-row>.el-input{flex:1;min-width:120px}.volume-add{display:flex;gap:10px;margin-bottom:18px}.volume-add>.el-select{width:240px}.workload-note{font-size:13px;color:var(--kp-muted);background:var(--kp-surface-2);border:1px solid var(--kp-border);padding:12px;border-radius:8px;margin-bottom:18px}
@media(max-width:1100px){.container-workspace{grid-template-columns:190px minmax(0,1fr);gap:16px}.container-settings{padding:16px}.container-grid{grid-template-columns:1fr}}
@media(max-width:750px){.container-workspace{grid-template-columns:minmax(0,1fr)}.container-selector{display:flex;gap:10px;flex-wrap:wrap}.container-add{width:100%}.container-choice{min-width:150px;flex:1}.container-settings{padding:12px}.volume-add{flex-wrap:wrap}}
</style>
