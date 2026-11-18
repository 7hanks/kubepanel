<template>
 <div class="generator-grid">
  <section class="generator-input" aria-label="生成配置">
   <div class="generator-panel-title"><h2>资源配置</h2><el-button text :icon="Refresh" @click="resetCurrent">重置</el-button></div>
   <el-form label-position="top" class="generator-fields" @submit.prevent>
    <el-form-item label="资源类型"><el-select :model-value="selectedKind" aria-label="资源类型" @update:model-value="chooseKind"><el-option v-for="kind in GENERATOR_KINDS" :key="kind" :label="kind" :value="kind" /></el-select></el-form-item>
    <div class="generator-field-grid"><el-form-item label="资源名称" required><el-input v-model="draft.name" aria-label="资源名称" placeholder="填写资源名称" /></el-form-item><el-form-item v-if="selectedKind !== 'Namespace'" label="命名空间" required><el-input v-model="draft.namespace" aria-label="命名空间" /></el-form-item></div>
    <div v-if="['Deployment','StatefulSet'].includes(selectedKind)" class="generator-field-grid"><el-form-item label="副本数"><el-input-number v-model="draft.replicas" :min="0" :precision="0" controls-position="right" aria-label="副本数" /></el-form-item><el-form-item v-if="selectedKind === 'StatefulSet'" label="管理服务名称"><el-input v-model="draft.governingService" aria-label="管理服务名称" :placeholder="draft.name ? `${draft.name}-headless` : '自动生成 headless Service'" /></el-form-item></div>
    <el-form-item v-if="selectedKind === 'CronJob'" label="调度表达式" required><el-input v-model="draft.schedule" aria-label="调度表达式" placeholder="0 * * * *" /></el-form-item>

    <template v-if="isWorkload">
     <div class="generator-section-head"><h3>容器</h3><el-button link type="primary" :icon="Plus" @click="addContainer">添加容器</el-button></div>
     <article v-for="(container,index) in draft.containers" :key="container.id" class="generator-container">
      <div class="generator-container-title"><strong>{{ container.name || `容器 ${index + 1}` }}</strong><el-button text type="danger" :icon="Delete" :disabled="draft.containers.length === 1" :aria-label="`删除容器 ${index + 1}`" @click="removeContainer(index)" /></div>
      <el-form-item label="容器名称" required><el-input v-model="container.name" :aria-label="index === 0 ? '容器名称' : `容器名称 ${index + 1}`" /></el-form-item>
      <el-form-item label="容器镜像" required><el-input v-model="container.image" :aria-label="index === 0 ? '容器镜像' : `容器镜像 ${index + 1}`" placeholder="仓库 / 镜像:标签" /></el-form-item>
      <div class="generator-subhead"><span>容器端口</span><el-button link type="primary" :icon="Plus" :aria-label="index === 0 ? '添加容器端口' : `添加容器端口 ${index + 1}`" @click="addPort(container)">添加端口</el-button></div>
      <div v-for="(port,portIndex) in container.ports" :key="port.id" class="generator-port-row">
       <el-input v-model="port.name" aria-label="容器端口名称" placeholder="名称" /><el-input-number v-model="port.containerPort" :min="1" :max="65535" :precision="0" controls-position="right" aria-label="容器端口号" />
       <el-select v-model="port.protocol" aria-label="容器端口协议"><el-option v-for="value in protocols" :key="value" :label="value" :value="value" /></el-select>
       <el-button text type="danger" :icon="Delete" aria-label="删除容器端口" @click="removePort(container,portIndex)" />
       <el-input-number v-model="port.hostPort" :min="1" :max="65535" :precision="0" controls-position="right" aria-label="宿主机端口" placeholder="hostPort（可选）" class="generator-host-port" />
      </div>
      <details class="generator-details"><summary>环境变量与挂载</summary>
       <div class="generator-subhead"><span>环境变量</span><el-button link type="primary" :icon="Plus" @click="container.env.push({name:'',value:''})">添加变量</el-button></div>
       <div v-for="(env,envIndex) in container.env" :key="envIndex" class="generator-kv-row"><el-input v-model="env.name" aria-label="环境变量名称" placeholder="名称" /><el-input v-model="env.value" aria-label="环境变量值" placeholder="值" /><el-button text type="danger" :icon="Delete" aria-label="删除环境变量" @click="container.env.splice(envIndex,1)" /></div>
       <div class="generator-subhead"><span>存储卷挂载</span><el-button link type="primary" :icon="Plus" @click="container.mounts.push({name:'',mountPath:'',readOnly:false})">添加挂载</el-button></div>
       <div v-for="(mount,mountIndex) in container.mounts" :key="mountIndex" class="generator-mount-row"><el-select v-model="mount.name" aria-label="挂载存储卷" placeholder="选择下方配置的存储卷"><el-option v-for="volume in draft.volumes.filter(value => value.name)" :key="volume.name" :label="volume.name" :value="volume.name" /></el-select><el-input v-model="mount.mountPath" aria-label="挂载路径" placeholder="绝对路径" /><el-checkbox v-model="mount.readOnly">只读</el-checkbox><el-button text type="danger" :icon="Delete" aria-label="删除挂载" @click="container.mounts.splice(mountIndex,1)" /></div>
      </details>
     </article>
     <div class="generator-section-head"><h3>存储卷</h3><el-button link type="primary" :icon="Plus" @click="draft.volumes.push({name:'',type:'emptyDir',source:''})">添加存储卷</el-button></div>
     <div v-for="(volume,index) in draft.volumes" :key="index" class="generator-volume-row"><el-input v-model="volume.name" aria-label="存储卷名称" placeholder="名称" /><el-select v-model="volume.type" aria-label="存储卷类型"><el-option v-for="value in volumeTypes" :key="value.value" :label="value.label" :value="value.value" /></el-select><el-input v-if="volume.type !== 'emptyDir'" v-model="volume.source" aria-label="存储卷来源" :placeholder="volume.type === 'hostPath' ? '宿主机绝对路径' : '现有资源名称'" /><el-button text type="danger" :icon="Delete" aria-label="删除存储卷" @click="draft.volumes.splice(index,1)" /></div>
     <details class="generator-details"><summary>调度选项</summary><el-form-item label="指定节点（可选）"><el-input v-model="draft.nodeName" aria-label="指定节点" placeholder="nodeName，留空由集群调度" /></el-form-item><el-form-item v-if="selectedKind === 'Pod'" label="重启策略"><el-select v-model="draft.restartPolicy" aria-label="重启策略"><el-option v-for="value in ['Always','OnFailure','Never']" :key="value" :label="value" :value="value" /></el-select></el-form-item></details>
    </template>

    <template v-if="selectedKind === 'Service' || hasNetwork">
     <div class="generator-section-head"><h3>访问方式</h3></div>
     <div v-if="hasNetwork" class="generator-network-toggles"><el-checkbox :model-value="draft.service.enabled" @update:model-value="setServiceEnabled">生成 Service</el-checkbox><el-checkbox :model-value="draft.ingress.enabled" @update:model-value="setIngressEnabled">生成 Ingress</el-checkbox></div>
     <p v-if="selectedKind === 'StatefulSet'" class="generator-note">同时生成管理 StatefulSet 的 headless Service。</p>
     <template v-if="selectedKind === 'Service' || draft.service.enabled">
      <el-form-item label="Service 类型"><el-select v-model="draft.service.type" aria-label="Service 类型"><el-option v-for="value in ['ClusterIP','NodePort','LoadBalancer']" :key="value" :label="value" :value="value" /></el-select></el-form-item>
      <template v-if="selectedKind === 'Service'"><div class="generator-subhead"><span>Pod 选择器</span><el-button link type="primary" :icon="Plus" @click="draft.serviceSelector.push({key:'',value:''})">添加选择器</el-button></div><div v-for="(row,index) in draft.serviceSelector" :key="index" class="generator-kv-row"><el-input v-model="row.key" aria-label="选择器标签键" placeholder="标签键" /><el-input v-model="row.value" aria-label="选择器标签值" placeholder="标签值" /><el-button text type="danger" :icon="Delete" aria-label="删除选择器" @click="draft.serviceSelector.splice(index,1)" /></div></template>
      <div class="generator-subhead"><span>Service 端口</span><el-button link type="primary" :icon="Plus" @click="addServicePort">添加端口</el-button></div>
      <article v-for="(port,index) in draft.service.ports" :key="index" class="generator-service-port">
       <div class="generator-service-port-grid"><el-input v-model="port.name" aria-label="Service 端口名称" placeholder="名称" /><el-input-number v-model="port.port" :min="1" :max="65535" :precision="0" controls-position="right" aria-label="Service 端口号" /><el-button text type="danger" :icon="Delete" aria-label="删除 Service 端口" @click="draft.service.ports.splice(index,1)" /></div>
       <el-select v-if="hasNetwork" v-model="port.target" aria-label="Service 目标端口" placeholder="选择容器端口"><el-option v-for="value in availablePorts" :key="value.key" :label="value.label" :value="value.key" /></el-select>
       <div v-else class="generator-field-grid"><el-input v-model="port.targetPort" aria-label="Service 目标端口" placeholder="目标端口号 / 名称（默认同端口）" /><el-select v-model="port.protocol" aria-label="Service 端口协议"><el-option v-for="value in protocols" :key="value" :label="value" :value="value" /></el-select></div>
       <el-input-number v-if="draft.service.type === 'NodePort'" v-model="port.nodePort" :min="1" :max="65535" :precision="0" controls-position="right" aria-label="NodePort" placeholder="NodePort（留空自动分配）" />
      </article>
     </template>
     <template v-if="hasNetwork && draft.ingress.enabled">
      <el-form-item label="Ingress 域名" required><el-input v-model="draft.ingress.host" aria-label="Ingress 域名" placeholder="填写已配置解析的域名" /></el-form-item>
      <div class="generator-field-grid"><el-form-item label="路径"><el-input v-model="draft.ingress.path" aria-label="Ingress 路径" /></el-form-item><el-form-item label="Ingress Class（可选）"><el-input v-model="draft.ingress.className" aria-label="Ingress Class" /></el-form-item></div>
      <el-form-item label="TLS Secret（可选）"><el-input v-model="draft.ingress.tlsSecret" aria-label="TLS Secret" placeholder="现有 TLS Secret 名称" /></el-form-item>
     </template>
    </template>

    <template v-if="['ConfigMap','Secret'].includes(selectedKind)"><div class="generator-section-head"><h3>{{ selectedKind === 'Secret' ? 'Secret 数据' : '配置数据' }}</h3><el-button link type="primary" :icon="Plus" @click="draft.data.push({key:'',value:''})">添加条目</el-button></div><div v-for="(row,index) in draft.data" :key="index" class="generator-data-row"><el-input v-model="row.key" aria-label="数据键" placeholder="键" /><el-input v-model="row.value" type="textarea" :rows="3" aria-label="数据值" placeholder="文本内容" /><el-button text type="danger" :icon="Delete" aria-label="删除数据条目" @click="draft.data.splice(index,1)" /></div><p v-if="selectedKind === 'Secret'" class="generator-note">使用 stringData 生成 Opaque Secret；预览包含明文内容。</p></template>
   </el-form>
  </section>

  <section class="generator-preview" aria-label="YAML 预览">
   <div class="generator-panel-title"><div><h2>YAML 预览</h2><span class="generator-note">{{ resourceCount }} 个资源</span></div><el-tag size="small" type="info" effect="plain">本地生成</el-tag></div>
   <div class="generator-preview-actions"><el-button :icon="CopyDocument" :disabled="!!validationError" @click="copyYaml">复制 YAML</el-button><el-button :icon="Download" :disabled="!!validationError" @click="downloadYaml">下载 YAML</el-button><el-button type="primary" :icon="Right" :disabled="!!validationError || !canApply" @click="toPreflight">转到预检</el-button></div>
   <p v-if="validationError" class="generator-validation" role="status">{{ validationError }}</p><p v-else class="generator-ready" role="status">配置完整，可复制、下载或转入预检。</p>
   <textarea :value="preview" aria-label="生成的 YAML" class="generator-yaml" readonly spellcheck="false" />
  </section>
 </div>
</template>

<script setup>
import {ref,reactive,computed,watch} from 'vue'
import {Plus,Delete,CopyDocument,Download,Right,Refresh} from '@element-plus/icons-vue'
import {ElMessage,ElMessageBox} from 'element-plus'
import {GENERATOR_KINDS,GENERATOR_WORKLOADS,generatorHasNetwork,newGeneratorDraft,generatorContainerPorts,buildGeneratedResources,generateResourceYaml,downloadGeneratedYaml} from '../utils/yaml-generator'
import {copyText} from '../utils/clipboard'

const props=defineProps({namespace:{type:String,default:'default'},canApply:Boolean})
const emit=defineEmits(['preflight'])
const selectedKind=ref('Deployment'),drafts=reactive({Deployment:newGeneratorDraft('Deployment',props.namespace)}),baselines=reactive({Deployment:JSON.stringify(drafts.Deployment)})
const draft=computed(()=>drafts[selectedKind.value]),isWorkload=computed(()=>GENERATOR_WORKLOADS.includes(selectedKind.value)),hasNetwork=computed(()=>generatorHasNetwork(selectedKind.value)),availablePorts=computed(()=>generatorContainerPorts(draft.value))
const preview=computed(()=>{try{return generateResourceYaml(draft.value,{validate:false})}catch(error){return `# ${error.message}\n`}})
const resourceCount=computed(()=>{try{return buildGeneratedResources(draft.value,{validate:false}).length}catch{return 0}})
const validationError=computed(()=>{try{generateResourceYaml(draft.value);return ''}catch(error){return error.message}})
const dirty=computed(()=>Object.entries(drafts).some(([kind,value])=>JSON.stringify(value)!==baselines[kind]))
const protocols=['TCP','UDP','SCTP'],volumeTypes=[{value:'emptyDir',label:'临时目录 emptyDir'},{value:'configMap',label:'ConfigMap'},{value:'secret',label:'Secret'},{value:'persistentVolumeClaim',label:'PVC'},{value:'hostPath',label:'宿主机路径 hostPath'}]
let nextId=1
function chooseKind(kind){if(!GENERATOR_KINDS.includes(kind))return;if(!drafts[kind]){drafts[kind]=newGeneratorDraft(kind,props.namespace);baselines[kind]=JSON.stringify(drafts[kind])}selectedKind.value=kind}
function addContainer(){const id=++nextId;draft.value.containers.push({id:`container-${id}`,name:`app-${id}`,image:'',ports:[],env:[],mounts:[]})}
function removeContainer(index){if(draft.value.containers.length>1)draft.value.containers.splice(index,1)}
function addPort(container){container.ports.push({id:`port-${++nextId}`,name:'',containerPort:80,protocol:'TCP'})}
function removePort(container,index){container.ports.splice(index,1)}
function setServiceEnabled(value){draft.value.service.enabled=value;if(!value){draft.value.ingress.enabled=false;return}if(!availablePorts.value.length&&draft.value.containers?.[0])addPort(draft.value.containers[0]);for(const port of draft.value.service.ports)if(!port.target)port.target=availablePorts.value[0]?.key||''}
function setIngressEnabled(value){draft.value.ingress.enabled=value;if(value)setServiceEnabled(true)}
function addServicePort(){draft.value.service.ports.push({name:'',port:80,target:availablePorts.value[0]?.key||'',targetPort:'',protocol:'TCP',nodePort:''})}
function markExported(value){if(typeof value==='string'&&value!==generateResourceYaml(draft.value,{validate:false}))return;baselines[selectedKind.value]=JSON.stringify(draft.value)}
async function copyYaml(){if(validationError.value)return;const kind=selectedKind.value,snapshot=JSON.stringify(draft.value),text=generateResourceYaml(draft.value);try{await copyText(text);baselines[kind]=snapshot;ElMessage.success('YAML 已复制')}catch(error){ElMessage.error(error.message||'复制失败')}}
function downloadYaml(){if(validationError.value)return;try{downloadGeneratedYaml(generateResourceYaml(draft.value),`${selectedKind.value.toLowerCase()}-${draft.value.name}`);markExported();ElMessage.success('YAML 已下载')}catch(error){ElMessage.error(error.message||'下载失败')}}
function toPreflight(){if(validationError.value||!props.canApply)return;emit('preflight',generateResourceYaml(draft.value))}
async function resetCurrent(){const kind=selectedKind.value;if(JSON.stringify(draft.value)!==baselines[kind]){try{await ElMessageBox.confirm('确定清空当前资源类型的配置？','重置配置',{type:'warning',confirmButtonText:'重置',cancelButtonText:'保留'})}catch{return}}drafts[kind]=newGeneratorDraft(kind,props.namespace);baselines[kind]=JSON.stringify(drafts[kind])}
function discardDraft(){for(const key of Object.keys(drafts))delete drafts[key];for(const key of Object.keys(baselines))delete baselines[key];drafts.Deployment=newGeneratorDraft('Deployment',props.namespace);baselines.Deployment=JSON.stringify(drafts.Deployment);selectedKind.value='Deployment'}
watch(()=>props.namespace,(namespace,previous)=>{for(const [kind,value] of Object.entries(drafts)){if(JSON.stringify(value)===baselines[kind]&&value.namespace===previous){value.namespace=namespace;baselines[kind]=JSON.stringify(value)}}})
defineExpose({dirty,discardDraft,markExported})
</script>

<style scoped>
.generator-grid{display:grid;grid-template-columns:minmax(340px,.95fr) minmax(340px,1.05fr);gap:18px;align-items:start}.generator-input,.generator-preview{border:1px solid var(--kp-border);border-radius:10px;background:var(--kp-surface);min-width:0}.generator-input{padding:20px}.generator-panel-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}.generator-panel-title h2{font-size:15px;font-weight:600;margin:0}.generator-panel-title>div{display:flex;align-items:center;gap:12px}.generator-fields :deep(.el-form-item){margin-bottom:16px}.generator-fields :deep(.el-form-item__label){font-size:12px;color:var(--kp-text-2);line-height:1.5;margin-bottom:7px}.generator-fields :deep(.el-select),.generator-fields :deep(.el-input-number){width:100%;min-width:0}.generator-field-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.generator-section-head,.generator-subhead{display:flex;justify-content:space-between;align-items:center;gap:10px}.generator-section-head{margin:24px 0 12px;padding-top:18px;border-top:1px solid var(--kp-border)}.generator-section-head h3{font-size:13px;margin:0;font-weight:600}.generator-subhead{font-size:12px;color:var(--kp-muted);margin:12px 0 8px}.generator-container{border:1px solid var(--kp-border);border-radius:7px;padding:14px;margin-bottom:12px}.generator-container-title{display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:10px}.generator-port-row{display:grid;grid-template-columns:minmax(70px,1fr) minmax(100px,1fr) 85px 26px;gap:8px;margin-bottom:10px}.generator-port-row .generator-host-port{grid-column:2/4}.generator-kv-row,.generator-mount-row,.generator-volume-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 26px;gap:8px;align-items:center;margin-bottom:10px}.generator-mount-row{grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto 26px}.generator-volume-row{grid-template-columns:minmax(100px,1fr) minmax(110px,1fr) 26px}.generator-volume-row>.el-input:nth-last-child(2):not(:first-child){grid-column:1/3;grid-row:2}.generator-volume-row>.el-button{grid-column:3;grid-row:1}.generator-details{margin:16px 0 0;padding-top:12px;border-top:1px dashed var(--kp-border)}.generator-details summary{cursor:pointer;font-size:12px;color:var(--kp-text-2);padding:3px 0 10px}.generator-service-port{display:flex;flex-direction:column;gap:9px;padding:12px;border:1px solid var(--kp-border);border-radius:7px;margin-bottom:12px}.generator-service-port-grid{display:grid;grid-template-columns:minmax(80px,1fr) minmax(110px,1fr) 26px;gap:8px}.generator-data-row{display:grid;grid-template-columns:minmax(100px,.65fr) minmax(140px,1fr) 26px;gap:8px;align-items:start;margin-bottom:12px}.generator-network-toggles{display:flex;flex-wrap:wrap;gap:10px 18px;margin-bottom:12px}.generator-note{font-size:11.5px;line-height:1.6;color:var(--kp-muted);margin:7px 0}.generator-preview{position:sticky;top:16px;overflow:hidden}.generator-preview .generator-panel-title{padding:18px 18px 0;margin-bottom:14px}.generator-preview-actions{display:flex;flex-wrap:wrap;gap:8px;padding:0 18px}.generator-preview-actions .el-button+.el-button{margin-left:0}.generator-validation,.generator-ready{margin:12px 18px;font-size:12px;line-height:1.6}.generator-validation{color:var(--kp-muted)}.generator-ready{color:var(--el-color-success-dark-2)}.generator-yaml{display:block;box-sizing:border-box;width:100%;height:calc(100dvh - 310px);min-height:500px;resize:vertical;padding:18px;border:0;border-top:1px solid var(--kp-border);outline-offset:-3px;background:#f7f9fc;color:#26415d;font:12px/1.75 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:2;white-space:pre;overflow:auto}.generator-kv-row .el-button,.generator-port-row .el-button,.generator-mount-row .el-button,.generator-volume-row .el-button,.generator-data-row .el-button,.generator-service-port-grid .el-button{padding:4px;min-width:24px}
@media(max-width:1050px){.generator-grid{grid-template-columns:minmax(310px,1fr) minmax(310px,1fr)}.generator-input{padding:16px}.generator-port-row{grid-template-columns:minmax(65px,1fr) minmax(90px,1fr) 75px 24px;gap:5px}.generator-mount-row{grid-template-columns:minmax(0,1fr) minmax(0,1fr) 26px}.generator-mount-row>.el-checkbox{grid-row:2}.generator-mount-row>.el-button{grid-column:3;grid-row:1}}
@media(max-width:850px){.generator-grid{grid-template-columns:minmax(0,1fr)}.generator-preview{position:static}.generator-yaml{height:460px;min-height:320px}.generator-preview-actions{padding:0 14px}.generator-preview .generator-panel-title{padding:16px 14px 0}}
@media(max-width:480px){.generator-field-grid{grid-template-columns:minmax(0,1fr);gap:0}.generator-data-row{grid-template-columns:minmax(0,1fr) 26px}.generator-data-row>.el-textarea{grid-row:2;grid-column:1}.generator-data-row>.el-button{grid-column:2;grid-row:1}.generator-input{padding:14px}.generator-container{padding:10px}.generator-preview-actions .el-button{padding:8px 10px}}
</style>
