<template>
  <div class="workload-strategy-form">
    <section v-if="hasReplicas" class="strategy-row">
      <h3 class="strategy-label">副本数量</h3>
      <div class="strategy-content">
        <el-input-number :model-value="spec.replicas??1" :min="0" :max="2147483647" :precision="0" controls-position="right" :disabled="disabled" aria-label="副本数量" @update:model-value="value=>setNumber('replicas',value)"/>
        <span class="strategy-inline-help">期望运行的容器组数量</span>
      </div>
    </section>

    <section v-if="hasSelector" class="strategy-row strategy-selector">
      <h3 class="strategy-label">容器组选择器</h3>
      <div class="strategy-content">
        <template v-if="creating">
          <p class="strategy-help">选择器需与容器组模板中的标签匹配，创建后不可修改。</p>
          <KeyValueFields :model-value="spec.selector?.matchLabels||{}" label="匹配标签" add-label="添加匹配标签" :disabled="disabled" @update:model-value="setSelectorLabels" @validity="value=>setValidation('selector',value)" @change="emit('change')"/>
        </template>
        <template v-else>
          <div class="strategy-label-list" aria-label="只读容器组选择器">
            <span v-for="(value,key) in spec.selector?.matchLabels||{}" :key="key" class="strategy-label-tag">{{key}} = {{value}}</span>
            <span v-if="!Object.keys(spec.selector?.matchLabels||{}).length" class="strategy-help">未设置匹配标签</span>
          </div>
          <p class="strategy-help">已有工作负载的选择器不可修改。</p>
        </template>
        <p v-for="(expression,index) in spec.selector?.matchExpressions||[]" :key="index" class="strategy-expression">{{expression.key}} {{expression.operator}}<template v-if="expression.values?.length"> ({{expression.values.join(', ')}})</template></p>
      </div>
    </section>

    <section v-if="kind==='StatefulSet'" class="strategy-row">
      <h3 class="strategy-label">有状态服务</h3>
      <div class="strategy-content">
        <div class="strategy-subrow"><label>服务名称</label><el-input :model-value="spec.serviceName||''" :disabled="disabled||!creating" aria-label="有状态服务名称" placeholder="提供网络标识的 Headless Service" @update:model-value="value=>setText('serviceName',value)"/></div>
        <div class="strategy-subrow"><label>容器组管理</label><el-radio-group :model-value="spec.podManagementPolicy||'OrderedReady'" :disabled="disabled||!creating" aria-label="容器组管理策略" @update:model-value="value=>setChoice('podManagementPolicy',value)"><el-radio value="OrderedReady">顺序创建</el-radio><el-radio value="Parallel">并行创建</el-radio></el-radio-group></div>
        <p v-if="!creating" class="strategy-help">服务名称和容器组管理策略在创建后不可修改。</p>
      </div>
    </section>

    <section v-if="strategyKey" class="strategy-row">
      <h3 class="strategy-label">更新策略</h3>
      <div class="strategy-content">
        <div class="strategy-info">{{kind==='Deployment'?'更新容器组模板时，选择替换现有容器组的方式。':'选择容器组模板变更后，工作负载更新容器组的方式。'}}</div>
        <el-radio-group :model-value="strategyType" :disabled="disabled" aria-label="更新策略" @update:model-value="setStrategyType">
          <el-radio value="RollingUpdate">滚动更新（RollingUpdate）</el-radio>
          <el-radio v-if="kind==='Deployment'" value="Recreate">重新创建（Recreate）</el-radio>
          <el-radio v-else value="OnDelete">手动删除后更新（OnDelete）</el-radio>
        </el-radio-group>
        <p class="strategy-help">{{strategyDescription}}</p>
        <div v-if="strategyType==='RollingUpdate'" class="strategy-rolling">
          <div v-for="field in rollingFields" :key="field.key" class="strategy-subrow rolling-subrow">
            <label>{{field.label}}</label>
            <div class="strategy-input-group">
              <el-checkbox :model-value="hasRollingField(field.key)" :disabled="disabled" :aria-label="`自定义${field.label}`" @update:model-value="value=>toggleRollingField(field.key,value)">自定义</el-checkbox>
              <el-input-number :key="String(disabled||!hasRollingField(field.key))" :model-value="rollingNumber(field.key)" :min="0" :max="rollingUnit(field.key)==='percent'&&field.key==='maxUnavailable'?100:2147483647" :precision="0" controls-position="right" :disabled="disabled||!hasRollingField(field.key)" :aria-label="field.label" :placeholder="String(field.defaultValue).replace('%','')" @update:model-value="value=>setRollingValue(field.key,value)"/>
              <el-select :model-value="rollingUnit(field.key)" :disabled="disabled||!hasRollingField(field.key)" :aria-label="`${field.label}单位`" @update:model-value="value=>setRollingUnit(field.key,value)"><el-option label="个" value="count"/><el-option label="百分比 %" value="percent"/></el-select>
              <span class="strategy-field-help">{{field.help}}</span>
            </div>
          </div>
          <div v-if="kind==='StatefulSet'" class="strategy-subrow">
            <label>更新分区</label><div class="strategy-input-group"><el-checkbox :model-value="hasRollingField('partition')" :disabled="disabled" aria-label="自定义更新分区" @update:model-value="value=>toggleRollingField('partition',value)">自定义</el-checkbox><el-input-number :key="String(disabled||!hasRollingField('partition'))" :model-value="strategy.rollingUpdate?.partition" :min="0" :max="2147483647" :precision="0" controls-position="right" :disabled="disabled||!hasRollingField('partition')" aria-label="更新分区" placeholder="0" @update:model-value="value=>setPartition(value)"/><span class="strategy-field-help">仅更新序号大于或等于此值的容器组</span></div>
          </div>
        </div>
        <details v-if="Object.keys(strategyExtra).length||Object.keys(rollingExtra).length" class="strategy-nested-additional">
          <summary>其他更新策略参数</summary>
          <StructuredFields v-if="Object.keys(strategyExtra).length" :model-value="strategyExtra" :reserved-keys="['type','rollingUpdate']" :disabled="disabled" path="更新策略" @update:model-value="setStrategyExtra"/>
          <StructuredFields v-if="strategyType==='RollingUpdate'&&Object.keys(rollingExtra).length" :model-value="rollingExtra" :reserved-keys="rollingManagedKeys" :disabled="disabled" path="滚动更新" @update:model-value="setRollingExtra"/>
        </details>
      </div>
    </section>

    <section v-if="historyFields.length" class="strategy-row">
      <h3 class="strategy-label">历史版本</h3>
      <div class="strategy-content">
        <div class="strategy-info">保留指定数量的历史版本，用于追踪变更和回滚。</div>
        <div v-for="field in historyFields" :key="field.key" class="strategy-subrow">
          <label>{{field.label}}</label><div class="strategy-input-group"><el-checkbox :model-value="hasField(field.key)" :disabled="disabled" :aria-label="`自定义${field.label}`" @update:model-value="value=>setOptionalNumber(field.key,value,field.defaultValue)">自定义</el-checkbox><el-input-number :key="String(disabled||!hasField(field.key))" :model-value="spec[field.key]" :min="field.min||0" :max="2147483647" :precision="0" controls-position="right" :disabled="disabled||!hasField(field.key)" :aria-label="field.label" :placeholder="String(field.defaultValue)" @update:model-value="value=>setNumber(field.key,value)"/><span class="strategy-field-help">{{field.help}}</span></div>
        </div>
      </div>
    </section>

    <section v-if="readinessFields.length" class="strategy-row">
      <h3 class="strategy-label">就绪与进度</h3>
      <div class="strategy-content">
        <div class="strategy-info">设置容器组保持就绪的时间，以及部署取得进展的等待时限。</div>
        <div v-for="field in readinessFields" :key="field.key" class="strategy-subrow">
          <label>{{field.label}}</label><div class="strategy-input-group"><el-checkbox :model-value="hasField(field.key)" :disabled="disabled" :aria-label="`自定义${field.label}`" @update:model-value="value=>setOptionalNumber(field.key,value,field.defaultValue)">自定义</el-checkbox><el-input-number :key="String(disabled||!hasField(field.key))" :model-value="spec[field.key]" :min="field.min||0" :max="2147483647" :precision="0" controls-position="right" :disabled="disabled||!hasField(field.key)" :aria-label="field.label" :placeholder="String(field.defaultValue)" @update:model-value="value=>setNumber(field.key,value)"/><span>秒</span><span class="strategy-field-help">{{field.help}}</span></div>
        </div>
      </div>
    </section>

    <section v-if="kind==='Deployment'" class="strategy-row">
      <h3 class="strategy-label">暂停部署</h3>
      <div class="strategy-content"><el-switch :model-value="!!spec.paused" :disabled="disabled" aria-label="暂停部署" @update:model-value="value=>setBoolean('paused',value)"/><span class="strategy-inline-help">暂停后，模板变更暂不触发新的部署；恢复后继续更新。</span></div>
    </section>

    <section v-if="kind==='CronJob'" class="strategy-row">
      <h3 class="strategy-label">定时调度</h3>
      <div class="strategy-content">
        <div class="strategy-info">按 Cron 表达式创建任务，并控制并发执行和错过调度的处理方式。</div>
        <div class="strategy-subrow"><label>调度表达式</label><el-input :model-value="spec.schedule||''" :disabled="disabled" aria-label="调度表达式" placeholder="例如 */5 * * * *" @update:model-value="value=>setText('schedule',value)"/></div>
        <div class="strategy-subrow"><label>时区</label><el-input :model-value="spec.timeZone||''" :disabled="disabled" aria-label="调度时区" placeholder="例如 Asia/Shanghai；留空使用控制器时区" @update:model-value="value=>setText('timeZone',value)"/></div>
        <div class="strategy-subrow"><label>并发策略</label><el-select :model-value="spec.concurrencyPolicy||'Allow'" :disabled="disabled" aria-label="并发策略" @update:model-value="value=>setChoice('concurrencyPolicy',value)"><el-option label="允许并发（Allow）" value="Allow"/><el-option label="禁止并发（Forbid）" value="Forbid"/><el-option label="替换旧任务（Replace）" value="Replace"/></el-select></div>
        <div v-for="field in cronFields" :key="field.key" class="strategy-subrow"><label>{{field.label}}</label><div class="strategy-input-group"><el-checkbox :model-value="hasField(field.key)" :disabled="disabled" :aria-label="`自定义${field.label}`" @update:model-value="value=>setOptionalNumber(field.key,value,field.defaultValue)">自定义</el-checkbox><el-input-number :key="String(disabled||!hasField(field.key))" :model-value="spec[field.key]" :min="0" :max="2147483647" :precision="0" controls-position="right" :disabled="disabled||!hasField(field.key)" :aria-label="field.label" :placeholder="String(field.defaultValue)" @update:model-value="value=>setNumber(field.key,value)"/><span class="strategy-field-help">{{field.help}}</span></div></div>
        <div class="strategy-subrow"><label>暂停调度</label><el-switch :model-value="!!spec.suspend" :disabled="disabled" aria-label="暂停调度" @update:model-value="value=>setBoolean('suspend',value)"/></div>
      </div>
    </section>

    <section v-if="isJob" class="strategy-row">
      <h3 class="strategy-label">任务执行</h3>
      <div class="strategy-content">
        <div class="strategy-info">控制{{kind==='CronJob'?'每次调度所创建任务的':'任务的'}}并行数量、完成目标和失败重试。</div>
        <div v-for="field in jobFields" :key="field.key" class="strategy-subrow"><label>{{field.label}}</label><div class="strategy-input-group"><el-checkbox :model-value="hasField(field.key,'job')" :disabled="disabled" :aria-label="`自定义${field.label}`" @update:model-value="value=>setOptionalNumber(field.key,value,field.defaultValue,'job')">自定义</el-checkbox><el-input-number :key="String(disabled||!hasField(field.key,'job'))" :model-value="jobSpec[field.key]" :min="field.min||0" :max="2147483647" :precision="0" controls-position="right" :disabled="disabled||!hasField(field.key,'job')" :aria-label="field.label" :placeholder="String(field.defaultValue)" @update:model-value="value=>setNumber(field.key,value,'job')"/><span class="strategy-field-help">{{field.help}}</span></div></div>
        <div class="strategy-subrow"><label>暂停任务</label><el-switch :model-value="!!jobSpec.suspend" :disabled="disabled" aria-label="暂停任务" @update:model-value="value=>setBoolean('suspend',value,'job')"/></div>
        <details v-if="kind==='CronJob'" class="strategy-nested-additional"><summary>其他任务执行设置</summary><StructuredFields :model-value="jobAdditionalFields" :reserved-keys="jobManagedKeys" :disabled="disabled" path="任务执行" @update:model-value="setJobAdditionalFields"/></details>
      </div>
    </section>

    <details class="strategy-additional">
      <summary>其他{{kind==='CronJob'?'调度':'工作负载'}}设置</summary>
      <p class="strategy-help">编辑以上表单未覆盖的设置。</p>
      <StructuredFields :model-value="additionalFields" :reserved-keys="managedFields" :disabled="disabled" path="工作负载" @update:model-value="setAdditionalFields"/>
    </details>
  </div>
</template>

<script setup>
import {computed} from 'vue'
import {mergeFormFields} from '../utils/resource-form'
import KeyValueFields from './KeyValueFields.vue'
import StructuredFields from './StructuredFields.vue'

const props=defineProps({modelValue:Object,creating:Boolean,disabled:Boolean})
const emit=defineEmits(['change','validity'])
const validationErrors=new Map()
function setValidation(key,message){if(message)validationErrors.set(key,message);else validationErrors.delete(key);emit('validity',validationErrors.values().next().value||'')}
const kind=computed(()=>props.modelValue?.kind)
const spec=computed(()=>props.modelValue?.spec||{})
const isJob=computed(()=>['Job','CronJob'].includes(kind.value))
const jobSpec=computed(()=>kind.value==='CronJob'?spec.value.jobTemplate?.spec||{}:spec.value)
const hasReplicas=computed(()=>['Deployment','StatefulSet','ReplicaSet'].includes(kind.value))
const hasSelector=computed(()=>['Deployment','StatefulSet','DaemonSet','ReplicaSet'].includes(kind.value))
const strategyKey=computed(()=>kind.value==='Deployment'?'strategy':['StatefulSet','DaemonSet'].includes(kind.value)?'updateStrategy':null)
const strategy=computed(()=>spec.value[strategyKey.value]||{})
const strategyType=computed(()=>strategy.value.type||'RollingUpdate')
const strategyDescription=computed(()=>strategyType.value==='Recreate'?'先终止所有旧容器组，再创建新容器组，期间服务可能不可用。':strategyType.value==='OnDelete'?'保留现有容器组，手动删除后才按新模板创建。':'逐步替换旧容器组，可设置更新过程中允许的不可用数量和额外副本。')
const rollingFields=computed(()=>kind.value==='StatefulSet'?[]:strategyKey.value?[
 {key:'maxUnavailable',label:'最大不可用',defaultValue:kind.value==='Deployment'?'25%':1,help:'更新期间允许不可用的容器组数量'},
 {key:'maxSurge',label:'最大超出副本',defaultValue:kind.value==='Deployment'?'25%':0,help:'更新期间允许超出期望数量的容器组'},
]:[])
const rollingManagedKeys=computed(()=>kind.value==='StatefulSet'?['partition']:rollingFields.value.map(field=>field.key))
const historyFields=computed(()=>['Deployment','StatefulSet','DaemonSet'].includes(kind.value)?[{key:'revisionHistoryLimit',label:'保留版本数',defaultValue:10,help:'设置为 0 时不保留历史版本'}]:[])
const readinessFields=computed(()=>[
 ...(['Deployment','StatefulSet','DaemonSet','ReplicaSet'].includes(kind.value)?[{key:'minReadySeconds',label:'最短就绪时间',defaultValue:0,help:'容器组保持就绪多久后，视为可用'}]:[]),
 ...(kind.value==='Deployment'?[{key:'progressDeadlineSeconds',label:'部署进度时限',defaultValue:600,min:1,help:'超时未取得进展时标记部署失败，需大于最短就绪时间'}]:[]),
])
const cronFields=[
 {key:'startingDeadlineSeconds',label:'调度启动时限',defaultValue:200,help:'错过调度后允许延迟启动的秒数'},
 {key:'successfulJobsHistoryLimit',label:'成功任务保留数',defaultValue:3,help:'保留的已成功任务数量'},
 {key:'failedJobsHistoryLimit',label:'失败任务保留数',defaultValue:1,help:'保留的已失败任务数量'},
]
const jobFields=[
 {key:'parallelism',label:'并行数量',defaultValue:1,help:'同时运行的容器组数量'},
 {key:'completions',label:'完成数量',defaultValue:1,help:'任务需要成功完成的容器组数量'},
 {key:'backoffLimit',label:'失败重试次数',defaultValue:6,help:'达到次数后将任务标记为失败'},
 {key:'activeDeadlineSeconds',label:'执行时限',defaultValue:3600,min:1,help:'任务允许运行的最长秒数'},
 {key:'ttlSecondsAfterFinished',label:'完成后保留时间',defaultValue:300,help:'任务完成后自动清理前保留的秒数'},
]
const jobManagedKeys=['template',...jobFields.map(field=>field.key),'suspend']
const managedFields=computed(()=>[
 'template','jobTemplate',...(hasSelector.value?['selector']:[]),...(hasReplicas.value?['replicas']:[]),
 ...(strategyKey.value?[strategyKey.value]:[]),...historyFields.value.map(field=>field.key),...readinessFields.value.map(field=>field.key),
 ...(kind.value==='Deployment'?['paused']:[]),...(kind.value==='StatefulSet'?['serviceName','podManagementPolicy']:[]),
 ...(kind.value==='CronJob'?['schedule','timeZone','concurrencyPolicy','suspend',...cronFields.map(field=>field.key)]:[]),
 ...(kind.value==='Job'?jobManagedKeys:[]),
])
const omit=(value,keys)=>Object.fromEntries(Object.entries(value||{}).filter(([key])=>!keys.includes(key)))
const additionalFields=computed(()=>omit(spec.value,managedFields.value))
const jobAdditionalFields=computed(()=>omit(jobSpec.value,jobManagedKeys))
const strategyExtra=computed(()=>omit(strategy.value,['type','rollingUpdate']))
const rollingExtra=computed(()=>omit(strategy.value.rollingUpdate,rollingManagedKeys.value))

function ensureSpec(){return props.modelValue.spec||=( {})}
function target(scope){return scope==='job'&&kind.value==='CronJob'?jobSpec.value:spec.value}
function ensureTarget(scope){const current=ensureSpec();if(scope==='job'&&kind.value==='CronJob'){current.jobTemplate||={};return current.jobTemplate.spec||={}}return current}
function numberField(key,scope='spec'){
 if(scope==='job')return isJob.value?jobFields.find(field=>field.key===key):null
 if(key==='replicas'&&hasReplicas.value)return {key,min:0}
 return [...historyFields.value,...readinessFields.value,...(kind.value==='CronJob'?cronFields:[]),...(kind.value==='Job'?jobFields:[])].find(field=>field.key===key)
}
function validNumber(value,field){return typeof value==='number'&&Number.isInteger(value)&&value>=(field.min||0)&&value<=2147483647}
function hasField(key,scope='spec'){return key in target(scope)}
function setNumber(key,value,scope='spec'){
 const field=numberField(key,scope)
 if(props.disabled||!field)return
 if(!validNumber(value,field)){setValidation(scope+':'+key,'请填写有效的'+(field.label||'副本数量')+'整数');return}
 setValidation(scope+':'+key,'');ensureTarget(scope)[key]=value;emit('change')
}
function setOptionalNumber(key,enabled,defaultValue,scope='spec'){
 const field=numberField(key,scope)
 if(props.disabled||!field)return
 if(enabled){if(!hasField(key,scope)&&validNumber(defaultValue,field))ensureTarget(scope)[key]=defaultValue}
 else delete target(scope)[key]
 setValidation(scope+':'+key,'');emit('change')
}
function setBoolean(key,value,scope='spec'){
 if(props.disabled||!(key==='paused'&&kind.value==='Deployment'&&scope==='spec'||key==='suspend'&&(scope==='job'?isJob.value:['Job','CronJob'].includes(kind.value))))return
 ensureTarget(scope)[key]=!!value;emit('change')
}
function setText(key,value){
 if(props.disabled||!((kind.value==='CronJob'&&['schedule','timeZone'].includes(key))||(kind.value==='StatefulSet'&&key==='serviceName'&&props.creating)))return
 if(key==='timeZone'&&!value)delete spec.value[key];else ensureSpec()[key]=value
 emit('change')
}
function setChoice(key,value){
 if(props.disabled)return
 if(key==='concurrencyPolicy'&&kind.value==='CronJob'&&['Allow','Forbid','Replace'].includes(value)||key==='podManagementPolicy'&&kind.value==='StatefulSet'&&props.creating&&['OrderedReady','Parallel'].includes(value)){ensureSpec()[key]=value;emit('change')}
}
function setSelectorLabels(value){
 if(props.disabled||!props.creating||!hasSelector.value)return
 const current=ensureSpec();current.selector||={};current.selector.matchLabels={...value};emit('change')
}
function ensureStrategy(){const current=ensureSpec();return current[strategyKey.value]||={}}
function setStrategyType(value){
 if(props.disabled||!strategyKey.value||!['RollingUpdate',kind.value==='Deployment'?'Recreate':'OnDelete'].includes(value))return
 const current=ensureStrategy();current.type=value
 if(value!=='RollingUpdate'){delete current.rollingUpdate;for(const key of [...validationErrors.keys()])if(key.startsWith('rolling:'))validationErrors.delete(key);setValidation('strategy','')}
 emit('change')
}
function hasRollingField(key){return key in (strategy.value.rollingUpdate||{})}
function rollingDefinition(key){return rollingFields.value.find(field=>field.key===key)}
function rollingValue(key){return strategy.value.rollingUpdate?.[key]??rollingDefinition(key)?.defaultValue}
function rollingUnit(key){return typeof rollingValue(key)==='string'&&rollingValue(key).endsWith('%')?'percent':'count'}
function rollingNumber(key){const value=rollingValue(key),number=typeof value==='string'?Number(value.replace(/%$/,'')):value;return Number.isFinite(number)?number:undefined}
function ensureRolling(){const current=ensureStrategy();current.type||='RollingUpdate';return current.rollingUpdate||={}}
function setRollingValue(key,value){
 if(props.disabled||strategyType.value!=='RollingUpdate'||!rollingDefinition(key))return
 if(!validNumber(value,{})||(rollingUnit(key)==='percent'&&key==='maxUnavailable'&&value>100)){setValidation('rolling:'+key,'请填写有效的滚动更新数量或百分比');return}
 setValidation('rolling:'+key,'')
 ensureRolling()[key]=rollingUnit(key)==='percent'?`${value}%`:value;emit('change')
}
function setRollingUnit(key,unit){
 if(props.disabled||strategyType.value!=='RollingUpdate'||!rollingDefinition(key)||!['count','percent'].includes(unit))return
 const value=rollingNumber(key)
 if(!validNumber(value,{})||unit==='percent'&&key==='maxUnavailable'&&value>100){setValidation('rolling:'+key,'最大不可用百分比不能超过 100%');return}
 setValidation('rolling:'+key,'')
 ensureRolling()[key]=unit==='percent'?`${value}%`:value;emit('change')
}
function toggleRollingField(key,enabled){
 if(props.disabled||!strategyKey.value||strategyType.value!=='RollingUpdate')return
 const field=rollingDefinition(key)||(kind.value==='StatefulSet'&&key==='partition'?{defaultValue:0}:null)
 if(!field)return
 if(enabled){if(!hasRollingField(key))ensureRolling()[key]=field.defaultValue}
 else if(strategy.value.rollingUpdate)delete strategy.value.rollingUpdate[key]
 setValidation('rolling:'+key,'');emit('change')
}
function setPartition(value){if(props.disabled||kind.value!=='StatefulSet'||strategyType.value!=='RollingUpdate')return;if(!validNumber(value,{})){setValidation('rolling:partition','请填写有效的更新分区整数');return}setValidation('rolling:partition','');ensureRolling().partition=value;emit('change')}
function setAdditionalFields(value){if(props.disabled)return;props.modelValue.spec=mergeFormFields(spec.value,managedFields.value,value);emit('change')}
function setJobAdditionalFields(value){if(props.disabled||kind.value!=='CronJob')return;ensureSpec().jobTemplate||={};spec.value.jobTemplate.spec=mergeFormFields(jobSpec.value,jobManagedKeys,value);emit('change')}
function setStrategyExtra(value){if(props.disabled||!strategyKey.value)return;ensureSpec()[strategyKey.value]=mergeFormFields(strategy.value,['type','rollingUpdate'],value);emit('change')}
function setRollingExtra(value){if(props.disabled||!strategyKey.value||strategyType.value!=='RollingUpdate')return;ensureStrategy().rollingUpdate=mergeFormFields(strategy.value.rollingUpdate||{},rollingManagedKeys.value,value);emit('change')}
</script>

<style scoped>
.workload-strategy-form{min-width:0;color:var(--kp-text,#303b49);font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:14px;line-height:1.7}
.strategy-row{display:grid;grid-template-columns:132px minmax(0,1fr);gap:24px;margin:0 0 28px;align-items:start}.strategy-label{font-size:14px;font-weight:400;text-align:right;margin:0;padding-top:6px;color:var(--kp-text-2,#4b596c)}.strategy-content{min-width:0}.strategy-info{background:#42618b;color:#fff;padding:10px 16px;margin:0 0 17px;font-size:14px;line-height:1.75;border-radius:3px}.strategy-help{font-size:13px;color:var(--kp-muted,#68758a);line-height:1.75;margin:7px 0 12px}.strategy-inline-help{font-size:13px;color:var(--kp-muted,#68758a);margin-left:16px}.strategy-subrow{display:flex;align-items:center;gap:16px;margin:0 0 16px;min-height:34px}.strategy-subrow:last-child{margin-bottom:0}.strategy-subrow>label{width:112px;flex-shrink:0;font-size:14px;color:var(--kp-text-2,#4b596c)}.strategy-input-group{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-width:0}.strategy-field-help{font-size:13px;color:var(--kp-muted,#68758a);line-height:1.6}.strategy-rolling{margin-top:18px}.strategy-label-list{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-height:34px}.strategy-label-tag{font-size:13px;background:#eef3f8;border:1px solid #d2dfec;border-radius:3px;color:#42618b;padding:2px 9px;overflow-wrap:anywhere}.strategy-expression{font-size:13px;color:var(--kp-text-2,#4b596c);overflow-wrap:anywhere;margin:4px 0}.strategy-additional{margin:8px 0 0 156px;border-top:1px solid var(--kp-border,#dce3ed);padding-top:16px}.strategy-additional>summary,.strategy-nested-additional>summary{font-size:14px;cursor:pointer;color:#42618b;line-height:30px}.strategy-nested-additional{margin-top:18px}.strategy-nested-additional[open]>summary{margin-bottom:12px}
.workload-strategy-form :deep(.el-input-number){width:150px}.workload-strategy-form :deep(.el-radio__label),.workload-strategy-form :deep(.el-checkbox__label),.workload-strategy-form :deep(.el-input__inner),.workload-strategy-form :deep(.el-select__placeholder){font-size:14px;font-family:inherit}.workload-strategy-form :deep(.el-radio){margin-right:24px;height:auto;min-height:32px;white-space:normal}.workload-strategy-form :deep(.el-radio__label){line-height:1.8}.workload-strategy-form :deep(.el-radio-group){display:flex;gap:4px 0;flex-wrap:wrap}.strategy-input-group :deep(.el-checkbox){margin-right:0;min-width:70px}.strategy-input-group :deep(.el-select){width:112px}.strategy-subrow>:deep(.el-input),.strategy-subrow>:deep(.el-select){max-width:440px}.strategy-selector :deep(.kv-fields){max-width:800px}
@media(max-width:1100px){.strategy-row{grid-template-columns:112px minmax(0,1fr);gap:18px}.strategy-additional{margin-left:130px}.strategy-field-help{flex:1 1 220px}.strategy-subrow{align-items:flex-start}.strategy-subrow>label{padding-top:4px}}
@media(max-width:700px){.strategy-row{grid-template-columns:minmax(0,1fr);gap:9px;margin-bottom:24px}.strategy-label{text-align:left;font-weight:600;padding:0}.strategy-additional{margin-left:0}.strategy-subrow{display:block}.strategy-subrow>label{display:block;width:auto;margin-bottom:8px;padding:0}.strategy-info{padding:10px 12px}.strategy-inline-help{display:block;margin:8px 0 0}.strategy-field-help{flex-basis:100%}.strategy-input-group{gap:10px}.workload-strategy-form :deep(.el-radio){margin-right:16px}}
</style>
