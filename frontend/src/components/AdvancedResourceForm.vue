<template>
  <section class="advanced-resource-form" :aria-label="heading">
    <h2>{{ heading }}</h2>
    <el-form label-width="128px" :disabled="disabled" @submit.prevent>
      <template v-if="kind === 'HorizontalPodAutoscaler'">
        <el-form-item label="目标类型" required><el-select :model-value="targetRef.kind || ''" filterable allow-create default-first-option aria-label="扩缩容目标类型" @update:model-value="setTargetKind"><el-option v-for="value in targetKinds" :key="value" :label="value" :value="value" /></el-select></el-form-item>
        <el-form-item label="目标 API 版本" required><el-input :model-value="targetRef.apiVersion || ''" aria-label="扩缩容目标 API 版本" placeholder="例如 apps/v1" @update:model-value="value => setTargetRef('apiVersion', value)" /></el-form-item>
        <el-form-item label="目标名称" required>
          <div class="target-picker">
            <el-select :model-value="targetValue" filterable :allow-create="manualTargetAllowed" clearable
              default-first-option :reserve-keyword="false" :loading="targetLoading"
              aria-label="扩缩容目标名称" :placeholder="manualTargetAllowed ? '选择工作负载，或输入名称后按 Enter' : '搜索命名空间或工作负载名称'"
              :no-data-text="targetEmptyText" @update:model-value="selectTarget">
              <el-option v-for="option in targetOptions" :key="option.value" :label="option.label" :value="option.value" />
            </el-select>
            <div v-if="allTargetNamespaces" class="target-picker-note">当前命名空间 {{ targetNamespace }}。选择工作负载后会带入它的命名空间。</div>
            <div v-if="targetMessage" class="target-picker-note">
              <span role="status">{{ targetMessage }}</span>
              <el-button v-if="targetFailed" link type="primary" @click="targetReload++">重试</el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="最小副本数" required>
          <el-input-number :model-value="spec.minReplicas ?? 1" :min="0" :precision="0" controls-position="right" aria-label="最小副本数" @update:model-value="value => setNumber(ensureSpec(), 'minReplicas', value)" />
        </el-form-item>
        <el-form-item label="最大副本数" required>
          <el-input-number :model-value="spec.maxReplicas" :min="1" :precision="0" controls-position="right" aria-label="最大副本数" @update:model-value="value => setNumber(ensureSpec(), 'maxReplicas', value)" />
        </el-form-item>
        <div class="advanced-section-head"><h3>扩缩容指标</h3><el-button :icon="Plus" :disabled="disabled" @click="addMetric('cpu')">CPU 指标</el-button><el-button :icon="Plus" :disabled="disabled" @click="addMetric('memory')">内存指标</el-button></div>
        <p class="advanced-note">利用率相对于工作负载的资源 requests；平均值可填写 200m、256Mi 等资源数量。</p>
        <article v-for="entry in resourceMetrics" :key="entry.index" class="advanced-item">
          <div class="advanced-item-head"><strong>资源指标 {{ entry.index + 1 }}</strong><el-button text type="danger" :icon="Delete" :disabled="disabled" :aria-label="`删除扩缩容指标 ${entry.index + 1}`" @click="removeMetric(entry.index)" /></div>
          <el-form-item label="资源"><el-select :model-value="entry.metric.resource.name" :aria-label="`指标资源 ${entry.index + 1}`" @update:model-value="value => setValue(entry.metric.resource, 'name', value)"><el-option label="CPU" value="cpu" /><el-option label="内存" value="memory" /></el-select></el-form-item>
          <el-form-item label="目标类型"><el-select :model-value="entry.metric.resource.target?.type || 'Utilization'" :aria-label="`指标目标类型 ${entry.index + 1}`" @update:model-value="value => setMetricTargetType(entry.metric, value)"><el-option label="利用率（%）" value="Utilization" /><el-option label="平均值" value="AverageValue" /></el-select></el-form-item>
          <el-form-item v-if="entry.metric.resource.target?.type !== 'AverageValue'" label="目标利用率" required><el-input-number :model-value="entry.metric.resource.target?.averageUtilization" :min="1" :precision="0" controls-position="right" :aria-label="`目标利用率 ${entry.index + 1}`" @update:model-value="value => setMetricValue(entry.metric, value)" /></el-form-item>
          <el-form-item v-else label="目标平均值" required><el-input :model-value="entry.metric.resource.target?.averageValue || ''" :aria-label="`目标平均值 ${entry.index + 1}`" :placeholder="entry.metric.resource.name === 'cpu' ? '例如 200m' : '例如 256Mi'" @update:model-value="value => setMetricValue(entry.metric, value)" /></el-form-item>
        </article>
        <p v-if="otherMetricCount" class="advanced-note">另外 {{ otherMetricCount }} 个已有指标按原配置保留。</p>
        <p v-if="!spec.metrics?.length" class="advanced-note">未指定指标时，Kubernetes 默认按 CPU 利用率扩缩容。</p>
      </template>

      <template v-else-if="kind === 'ResourceQuota'">
        <el-form-item label="资源配额" required><KeyValueFields :model-value="spec.hard" label="资源配额" add-label="添加资源配额" :disabled="disabled" @update:model-value="setQuotaHard" @validity="value => setChildValidity('quota-hard', value)" /></el-form-item>
        <p class="advanced-note">键填写 pods、requests.cpu、limits.memory 等资源名，值填写数量或容量。</p>
        <el-form-item label="配额范围"><el-select :model-value="spec.scopes || []" multiple filterable allow-create default-first-option clearable aria-label="配额范围" @update:model-value="setQuotaScopes"><el-option v-for="value in quotaScopes" :key="value" :label="value" :value="value" /></el-select></el-form-item>
      </template>

      <template v-else-if="kind === 'LimitRange'">
        <div class="advanced-section-head"><h3>资源限制</h3><el-button :icon="Plus" :disabled="disabled || limitTypes.every(value => limits.some(entry => entry.type === value))" @click="addLimit">添加限制</el-button></div>
        <article v-for="(entry, index) in limits" :key="addressKey(entry)" class="advanced-item">
          <div class="advanced-item-head"><strong>限制 {{ index + 1 }}</strong><el-button text type="danger" :icon="Delete" :disabled="disabled" :aria-label="`删除资源限制 ${index + 1}`" @click="removeLimit(index)" /></div>
          <el-form-item label="适用类型" required><el-select :model-value="entry.type" filterable allow-create default-first-option :aria-label="`资源限制类型 ${index + 1}`" @update:model-value="value => setLimitType(entry, value)"><el-option v-for="value in limitTypes" :key="value" :label="value" :value="value" :disabled="limits.some(item => item !== entry && item.type === value)" /></el-select></el-form-item>
          <el-form-item v-for="field in limitFields.filter(field => entry.type !== 'Pod' || !['default', 'defaultRequest'].includes(field.key))" :key="field.key" :label="field.label"><KeyValueFields :model-value="entry[field.key]" :label="field.label" :add-label="`添加${field.label}`" :disabled="disabled" @update:model-value="value => setLimitMap(entry, field.key, value)" @validity="value => setChildValidity(`limit-${addressKey(entry)}-${field.key}`, value)" /></el-form-item>
        </article>
      </template>

      <template v-else-if="kind === 'Endpoints'">
        <p class="advanced-note">端点名称应与对应 Service 相同。配置实际后端 IP 和端口。</p>
        <div class="advanced-section-head"><h3>端点组</h3><el-button :icon="Plus" :disabled="disabled" @click="addSubset">添加端点组</el-button></div>
        <article v-for="(subset, index) in subsets" :key="index" class="advanced-item">
          <div class="advanced-item-head"><strong>端点组 {{ index + 1 }}</strong><el-button text type="danger" :icon="Delete" :disabled="disabled" :aria-label="`删除端点组 ${index + 1}`" @click="removeSubset(index)" /></div>
          <div v-for="row in endpointRows(subset)" :key="addressKey(row.address)" class="endpoint-address-row">
            <el-input :model-value="row.address.ip || ''" aria-label="端点 IP" placeholder="实际 IPv4 或 IPv6 地址" @update:model-value="value => setValue(row.address, 'ip', value)" />
            <el-switch :model-value="row.ready" inline-prompt active-text="就绪" inactive-text="未就绪" aria-label="端点就绪状态" @update:model-value="value => setEndpointReady(subset, row.address, value)" />
            <el-button text type="danger" :icon="Delete" :disabled="disabled" aria-label="删除端点地址" @click="removeEndpointAddress(subset, row.address)" />
          </div>
          <el-button link type="primary" :icon="Plus" :disabled="disabled" @click="addEndpointAddress(subset)">添加地址</el-button>
          <div class="advanced-section-head"><h3>端口</h3><el-button link :icon="Plus" :disabled="disabled" @click="addPort(subset)">添加端口</el-button></div>
          <div v-for="(port, portIndex) in subset.ports || []" :key="portIndex" class="endpoint-port-row">
            <el-input :model-value="port.name || ''" aria-label="端点端口名称" placeholder="名称（多端口时必填）" @update:model-value="value => setValue(port, 'name', value)" />
            <el-input-number :model-value="port.port" :min="1" :max="65535" :precision="0" controls-position="right" aria-label="端点端口号" @update:model-value="value => setNumber(port, 'port', value)" />
            <el-select :model-value="port.protocol || 'TCP'" aria-label="端点端口协议" @update:model-value="value => setValue(port, 'protocol', value)"><el-option v-for="value in protocols" :key="value" :label="value" :value="value" /></el-select>
            <el-button text type="danger" :icon="Delete" :disabled="disabled" aria-label="删除端点端口" @click="removePort(subset, portIndex)" />
          </div>
        </article>
      </template>

      <template v-else-if="kind === 'EndpointSlice'">
        <el-form-item label="关联 Service" :required="creating"><el-input :model-value="modelValue.metadata?.labels?.['kubernetes.io/service-name'] || ''" aria-label="关联 Service 名称" placeholder="当前命名空间内的 Service 名称" @update:model-value="setServiceName" /></el-form-item>
        <el-form-item label="地址类型" required><el-select :model-value="modelValue.addressType || 'IPv4'" :disabled="disabled || !creating" aria-label="端点地址类型" @update:model-value="setAddressType"><el-option v-for="value in ['IPv4', 'IPv6', 'FQDN']" :key="value" :label="value" :value="value" /></el-select></el-form-item>
        <div class="advanced-section-head"><h3>端点</h3><el-button :icon="Plus" :disabled="disabled" @click="addSliceEndpoint">添加端点</el-button></div>
        <article v-for="(endpoint, index) in sliceEndpoints" :key="index" class="advanced-item">
          <div class="advanced-item-head"><strong>端点 {{ index + 1 }}</strong><div><el-select :model-value="endpoint.conditions?.ready === undefined || endpoint.conditions?.ready === null ? 'unknown' : endpoint.conditions.ready" aria-label="端点就绪条件" class="ready-select" @update:model-value="value => setSliceReady(endpoint, value)"><el-option label="就绪" :value="true" /><el-option label="未就绪" :value="false" /><el-option label="未指定" value="unknown" /></el-select><el-button text type="danger" :icon="Delete" :disabled="disabled" :aria-label="`删除端点 ${index + 1}`" @click="removeSliceEndpoint(index)" /></div></div>
          <div v-for="(address, addressIndex) in endpoint.addresses || []" :key="addressIndex" class="endpoint-address-row slice-address-row"><el-input :model-value="address" :aria-label="`端点 ${index + 1} 地址 ${addressIndex + 1}`" :placeholder="`实际 ${modelValue.addressType || 'IPv4'} 地址`" @update:model-value="value => setSliceAddress(endpoint, addressIndex, value)" /><el-button text type="danger" :icon="Delete" :disabled="disabled" aria-label="删除端点地址" @click="removeSliceAddress(endpoint, addressIndex)" /></div>
          <el-button link type="primary" :icon="Plus" :disabled="disabled" @click="addSliceAddress(endpoint)">添加地址</el-button>
        </article>
        <div class="advanced-section-head"><h3>端口</h3><el-button :icon="Plus" :disabled="disabled" @click="addPort(modelValue)">添加端口</el-button></div>
        <div v-for="(port, index) in modelValue.ports || []" :key="index" class="endpoint-port-row">
          <el-input :model-value="port.name || ''" aria-label="切片端口名称" placeholder="Service 端口名称" @update:model-value="value => setValue(port, 'name', value)" />
          <el-input-number :model-value="port.port" :min="1" :max="65535" :precision="0" controls-position="right" aria-label="切片端口号" placeholder="未指定" @update:model-value="value => setNumber(port, 'port', value)" />
          <el-select :model-value="port.protocol || 'TCP'" aria-label="切片端口协议" @update:model-value="value => setValue(port, 'protocol', value)"><el-option v-for="value in protocols" :key="value" :label="value" :value="value" /></el-select>
          <el-button text type="danger" :icon="Delete" :disabled="disabled" aria-label="删除切片端口" @click="removePort(modelValue, index)" />
        </div>
      </template>
    </el-form>
    <p v-if="touched && validationError" class="advanced-error" role="alert">{{ validationError }}</p>
  </section>
</template>

<script setup>
import {computed,ref,watch} from 'vue'
import {Plus,Delete} from '@element-plus/icons-vue'
import {validateAdvancedResource} from '../utils/advanced-resource-form'
import api from '../api'
import {store} from '../store'
import {canResource} from '../utils/perm'
import {readResourcePages} from '../utils/resource'
import KeyValueFields from './KeyValueFields.vue'

const props=defineProps({
  modelValue:{type:Object,required:true},
  creating:Boolean,
  disabled:Boolean,
  clusterId:String,
  namespaceScope:String,
  active:{type:Boolean,default:true},
})
const emit=defineEmits(['change','validity'])
const kind=computed(()=>props.modelValue.kind),spec=computed(()=>props.modelValue.spec||{}),targetRef=computed(()=>spec.value.scaleTargetRef||{})
const limits=computed(()=>spec.value.limits||[]),subsets=computed(()=>props.modelValue.subsets||[]),sliceEndpoints=computed(()=>props.modelValue.endpoints||[])
const heading=computed(()=>({HorizontalPodAutoscaler:'自动扩缩容配置',ResourceQuota:'资源配额配置',LimitRange:'资源限制配置',Endpoints:'端点配置',EndpointSlice:'端点切片配置'})[kind.value]||'资源配置')
const workloadTargets = {
  Deployment: { group:'apps', version:'v1', plural:'deployments' },
  StatefulSet: { group:'apps', version:'v1', plural:'statefulsets' },
  ReplicaSet: { group:'apps', version:'v1', plural:'replicasets' },
  ReplicationController: { group:'', version:'v1', plural:'replicationcontrollers' },
}
const targetKinds=Object.keys(workloadTargets),protocols=['TCP','UDP','SCTP'],limitTypes=['Container','Pod','PersistentVolumeClaim']
const targetOptions = ref([])
const targetLoading = ref(false)
const targetFailed = ref(false)
const targetMessage = ref('')
const targetReload = ref(0)
const targetNamespace = computed(() => props.modelValue.metadata?.namespace || '')
const allTargetNamespaces = computed(() => props.creating && props.namespaceScope === 'all')
const queryNamespace = computed(() => allTargetNamespaces.value ? undefined : targetNamespace.value)
const hpaMeta = { group: 'autoscaling', plural: 'horizontalpodautoscalers', namespaced: true }
const gvkVersion = ({ group, version }) => group ? `${group}/${version}` : version
const targetResource = computed(() => {
  const { kind: targetKind, apiVersion } = targetRef.value
  if (!targetKind || !apiVersion) return null
  const discovered = store.discovery.find(meta => meta.namespaced && !meta.plural.includes('/')
    && meta.kind === targetKind && gvkVersion(meta) === apiVersion)
  if (discovered) return discovered.verbs?.includes('list') ? discovered : null
  const builtin = Object.hasOwn(workloadTargets, targetKind) && workloadTargets[targetKind]
  return builtin && gvkVersion(builtin) === apiVersion ? { ...builtin, namespaced: true } : null
})
const canReadTargets = computed(() => !!(props.clusterId && targetResource.value
  && (allTargetNamespaces.value || (queryNamespace.value !== 'all' && /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(queryNamespace.value)))
  && canResource(targetResource.value, 'list', queryNamespace.value, props.clusterId)))
const targetValue = computed(() => {
  const name = targetRef.value.name || ''
  return allTargetNamespaces.value && name ? `${targetNamespace.value}/${name}` : name
})
const manualTargetAllowed = computed(() => !allTargetNamespaces.value || (!targetLoading.value && !targetOptions.value.length))
const targetEmptyText = computed(() => canReadTargets.value && !targetFailed.value
  ? '没有匹配的工作负载' : '可手动输入目标名称')

watch([kind, () => props.active, () => props.clusterId, queryNamespace, targetResource, canReadTargets, targetReload],
  async ([resourceKind, active, clusterId, namespace, resource, allowed], _, onCleanup) => {
    targetOptions.value = []
    targetLoading.value = false
    targetFailed.value = false
    targetMessage.value = ''
    if (resourceKind !== 'HorizontalPodAutoscaler' || !active || !allowed) return
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    const current = () => !controller.signal.aborted && props.active && props.clusterId === clusterId
      && queryNamespace.value === namespace && targetResource.value === resource && canReadTargets.value
    targetLoading.value = true
    try {
      const { items, incomplete } = await readResourcePages(cursor => api.list(resource.group, resource.version, resource.plural,
        { namespace, clusterId, limit: 200, continue: cursor }, { signal: controller.signal, silent: true }), controller.signal)
      if (!current()) return
      const options = new Map()
      for (const { metadata } of items) {
        const { name, namespace: workloadNamespace, deletionTimestamp } = metadata || {}
        if (!name || !workloadNamespace || deletionTimestamp) continue
        if (namespace ? workloadNamespace !== namespace : !canResource(hpaMeta, 'create', workloadNamespace, clusterId)) continue
        const value = namespace ? name : `${workloadNamespace}/${name}`
        const label = namespace ? name : `${workloadNamespace} / ${name}`
        options.set(value, { name, namespace: workloadNamespace, value, label })
      }
      targetOptions.value = [...options.values()].sort((a, b) => a.label.localeCompare(b.label))
      if (incomplete) targetMessage.value = namespace ? '已加载部分工作负载，可手动输入其他名称。' : '已加载部分工作负载，可切换到目标命名空间继续查找。'
    } catch {
      if (current()) {
        targetFailed.value = true
        targetMessage.value = '目标列表加载失败，可以重试或手动输入名称。'
      }
    } finally {
      if (current()) targetLoading.value = false
    }
  }, { immediate:true })

watch([() => props.modelValue, targetNamespace], ([resource, namespace], [previous, oldNamespace]) => {
  if (props.creating && kind.value === 'HorizontalPodAutoscaler' && resource === previous
    && namespace !== oldNamespace && targetRef.value.name) setTargetRef('name', '')
}, { flush:'sync' })
const quotaScopes=['Terminating','NotTerminating','BestEffort','NotBestEffort','PriorityClass','CrossNamespacePodAffinity']
const limitFields=[{key:'default',label:'默认限制'},{key:'defaultRequest',label:'默认请求'},{key:'min',label:'最小限制'},{key:'max',label:'最大限制'},{key:'maxLimitRequestRatio',label:'最大限制请求比'}]
const resourceMetrics=computed(()=>(spec.value.metrics||[]).map((metric,index)=>({metric,index})).filter(({metric})=>metric.type==='Resource'&&['cpu','memory'].includes(metric.resource?.name)))
const otherMetricCount=computed(()=>(spec.value.metrics?.length||0)-resourceMetrics.value.length)
const original=ref(JSON.parse(JSON.stringify(props.modelValue))),childErrors=ref({}),touched=ref(false)
const validationError=computed(()=>{try{validateAdvancedResource(props.modelValue,{creating:props.creating,original:original.value});return ''}catch(error){return error.message}})
const validity=computed(()=>Object.values(childErrors.value).find(Boolean)||(touched.value?validationError.value:''))
watch(validity,value=>emit('validity',value),{immediate:true})
watch(()=>props.modelValue,value=>{original.value=JSON.parse(JSON.stringify(value));childErrors.value={};touched.value=false})
function changed(){touched.value=true;emit('change')}
function ensureSpec(){return props.modelValue.spec||=( {})}
function setValue(target,key,value){if(props.disabled)return;target[key]=value;changed()}
function setNumber(target,key,value){if(props.disabled)return;if(value===undefined||value===null||value==='')delete target[key];else target[key]=value;changed()}
function setTargetRef(key, value) {
  if (props.disabled || value === targetRef.value[key]) return
  const target = ensureSpec().scaleTargetRef ||= {}
  target[key] = value || ''
  if (key === 'apiVersion') target.name = ''
  changed()
}
function selectTarget(value) {
  if (props.disabled) return
  const option = targetOptions.value.find(item => item.value === value)
  if (option && allTargetNamespaces.value) {
    if (!canResource(hpaMeta, 'create', option.namespace, props.clusterId)) return
    props.modelValue.metadata.namespace = option.namespace
  }
  if (!option && typeof value === 'string' && value.includes('/')) {
    targetMessage.value = '请从列表选择工作负载，手动输入时只填写名称。'
    return
  }
  setTargetRef('name', option?.name || value)
}
function setTargetKind(value) {
  if (props.disabled || value === targetRef.value.kind) return
  const target = ensureSpec().scaleTargetRef ||= {}
  const builtin = Object.hasOwn(workloadTargets, value) && workloadTargets[value]
  const discovered = store.discovery.find(meta => meta.kind === value && meta.namespaced
    && meta.preferred !== false && meta.verbs?.includes('list') && !meta.plural.includes('/'))
  target.kind = value || ''
  target.apiVersion = builtin ? gvkVersion(builtin) : discovered ? gvkVersion(discovered) : ''
  target.name = ''
  changed()
}
function addMetric(name){if(props.disabled||!['cpu','memory'].includes(name))return;const spec=ensureSpec();spec.metrics||=[];spec.metrics.push({type:'Resource',resource:{name,target:{type:'Utilization',averageUtilization:80}}});changed()}
function removeMetric(index){if(props.disabled)return;ensureSpec().metrics?.splice(index,1);changed()}
function setMetricTargetType(metric,value){if(props.disabled||!['Utilization','AverageValue'].includes(value))return;metric.resource||={};const target=metric.resource.target||=( {});if(target.type===value)return;delete target.averageUtilization;delete target.averageValue;delete target.value;target.type=value;if(value==='Utilization')target.averageUtilization=80;else target.averageValue='';changed()}
function setMetricValue(metric,value){if(props.disabled)return;metric.resource||={};const target=metric.resource.target||=( {type:'Utilization'});if(target.type==='AverageValue')target.averageValue=value;else if(value===undefined||value===null||value==='')delete target.averageUtilization;else target.averageUtilization=Number(value);changed()}
function setQuotaHard(value){if(props.disabled)return;ensureSpec().hard=value;changed()}
function setQuotaScopes(value){if(props.disabled)return;ensureSpec().scopes=[...value];changed()}
function setLimitMap(entry,key,value){if(props.disabled)return;entry[key]=value;changed()}
function setLimitType(entry,value){if(props.disabled)return;entry.type=value;if(value==='Pod'){delete entry.default;delete entry.defaultRequest;for(const key of ['default','defaultRequest'])clearChildErrors(`limit-${addressKey(entry)}-${key}`)}changed()}
function addLimit(){if(props.disabled)return;const type=limitTypes.find(type=>!limits.value.some(entry=>entry.type===type));if(!type)return;const spec=ensureSpec();spec.limits||=[];spec.limits.push({type,min:{},max:{},...(type==='Container'?{default:{},defaultRequest:{}}:{})});changed()}
function removeLimit(index){if(props.disabled)return;const [removed]=ensureSpec().limits?.splice(index,1)||[];if(removed)clearChildErrors(`limit-${addressKey(removed)}-`);changed()}
function setChildValidity(key,value){childErrors.value={...childErrors.value,[key]:value}}
function clearChildErrors(prefix){childErrors.value=Object.fromEntries(Object.entries(childErrors.value).filter(([key])=>!key.startsWith(prefix)))}
function addSubset(){if(props.disabled)return;props.modelValue.subsets||=[];props.modelValue.subsets.push({addresses:[{ip:''}],ports:[]});changed()}
function removeSubset(index){if(props.disabled)return;props.modelValue.subsets?.splice(index,1);changed()}
function endpointRows(subset){return [...(subset.addresses||[]).map(address=>({address,ready:true})),...(subset.notReadyAddresses||[]).map(address=>({address,ready:false}))]}
const addressIds=new WeakMap();let nextAddressId=0
function addressKey(address){if(!addressIds.has(address))addressIds.set(address,++nextAddressId);return addressIds.get(address)}
function addEndpointAddress(subset){if(props.disabled)return;subset.addresses||=[];subset.addresses.push({ip:''});changed()}
function removeEndpointAddress(subset,address){if(props.disabled)return;for(const key of ['addresses','notReadyAddresses']){const index=subset[key]?.indexOf(address)??-1;if(index>=0)subset[key].splice(index,1)}changed()}
function setEndpointReady(subset,address,ready){if(props.disabled)return;const from=ready?'notReadyAddresses':'addresses',to=ready?'addresses':'notReadyAddresses';const index=subset[from]?.indexOf(address)??-1;if(index<0)return;const [existing]=subset[from].splice(index,1);subset[to]||=[];subset[to].push(existing);changed()}
function addPort(owner){if(props.disabled)return;owner.ports||=[];owner.ports.push({name:'',protocol:'TCP'});changed()}
function removePort(owner,index){if(props.disabled)return;owner.ports?.splice(index,1);changed()}
function setServiceName(value){if(props.disabled)return;props.modelValue.metadata||={};props.modelValue.metadata.labels||={};if(value)props.modelValue.metadata.labels['kubernetes.io/service-name']=value;else delete props.modelValue.metadata.labels['kubernetes.io/service-name'];changed()}
function setAddressType(value){if(props.disabled||!props.creating)return;setValue(props.modelValue,'addressType',value)}
function addSliceEndpoint(){if(props.disabled)return;props.modelValue.endpoints||=[];props.modelValue.endpoints.push({addresses:[''],conditions:{ready:true}});changed()}
function removeSliceEndpoint(index){if(props.disabled)return;props.modelValue.endpoints?.splice(index,1);changed()}
function setSliceReady(endpoint,value){if(props.disabled)return;endpoint.conditions||={};if(value==='unknown')delete endpoint.conditions.ready;else endpoint.conditions.ready=value;changed()}
function setSliceAddress(endpoint,index,value){if(props.disabled)return;endpoint.addresses[index]=value;changed()}
function addSliceAddress(endpoint){if(props.disabled)return;endpoint.addresses||=[];endpoint.addresses.push('');changed()}
function removeSliceAddress(endpoint,index){if(props.disabled)return;endpoint.addresses?.splice(index,1);changed()}
</script>

<style scoped>
.target-picker{width:100%;max-width:520px;min-width:0}
.target-picker-note{display:flex;align-items:center;gap:8px;margin-top:5px;color:var(--kp-muted);font-size:12px;line-height:1.6}
.advanced-resource-form{min-width:0}.advanced-resource-form h2{font-size:16px;font-weight:600;margin:0 0 24px}.advanced-resource-form h3{font-size:14px;font-weight:600;margin:0}.advanced-resource-form :deep(.el-form-item){margin-bottom:18px}.advanced-resource-form :deep(.el-form-item__content){min-width:0}.advanced-resource-form :deep(.el-select){min-width:170px;width:100%;max-width:520px}.advanced-resource-form :deep(.el-input){max-width:680px}.inline-fields,.advanced-section-head,.advanced-item-head,.endpoint-address-row,.endpoint-port-row{display:flex;align-items:center;gap:12px}.inline-fields{flex-wrap:wrap}.advanced-section-head{margin:24px 0 12px}.advanced-section-head h3{flex:1}.advanced-section-head .el-button+.el-button{margin-left:0}.advanced-item{border:1px solid var(--kp-border);border-radius:8px;padding:16px;margin-bottom:16px;background:var(--kp-surface)}.advanced-item-head{justify-content:space-between;margin-bottom:16px;font-size:13px}.advanced-item-head>div{display:flex;gap:8px;align-items:center}.advanced-note{font-size:12px;line-height:1.7;color:var(--kp-muted);margin:8px 0 16px}.advanced-error{font-size:13px;line-height:1.6;color:var(--el-color-danger);margin:16px 0 0}.endpoint-address-row,.endpoint-port-row{margin:10px 0}.endpoint-address-row>.el-input{flex:1;min-width:160px}.endpoint-port-row>.el-input{flex:1;min-width:130px}.endpoint-port-row>.el-input-number{width:150px;flex:none}.endpoint-port-row>.el-select{width:105px;min-width:100px;flex:none}.advanced-resource-form .ready-select{width:110px;min-width:110px}.slice-address-row{gap:6px}.advanced-resource-form :deep(.kv-field-row){border:0;border-radius:0;background:transparent;padding:0;margin-bottom:10px}.advanced-resource-form :deep(.kv-equals){background:transparent;color:var(--kp-muted)}.advanced-resource-form :deep(.kv-field-row .el-input__wrapper){box-shadow:0 0 0 1px var(--kp-border) inset}.advanced-resource-form :deep(.kv-add){border-radius:6px;background:transparent}
@media(max-width:700px){.advanced-resource-form :deep(.el-form-item){display:block}.advanced-resource-form :deep(.el-form-item__label){float:none;width:auto!important;text-align:left;justify-content:flex-start}.advanced-resource-form :deep(.el-form-item__content){margin-left:0!important}.endpoint-port-row{flex-wrap:wrap}.endpoint-port-row>.el-input{flex-basis:100%}.endpoint-address-row{gap:8px}.advanced-item{padding:12px}.advanced-section-head{flex-wrap:wrap}}
</style>
