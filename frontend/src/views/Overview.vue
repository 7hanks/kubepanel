<template>
 <div class="cluster-overview" v-loading="loading" :aria-busy="loading">
  <div class="kp-toolbar overview-toolbar">
   <strong>集群概览</strong>
   <el-tooltip :content="scopeDescription" placement="bottom"><span class="scope-label" tabindex="0">{{scopeLabel}}</span></el-tooltip>
   <span class="spacer"/>
   <span class="kp-muted update-time">更新 {{updatedAt || '—'}}</span>
   <el-button @click="load" :loading="loading">刷新</el-button>
  </div>
  <el-alert v-if="error" type="error" :title="error" :closable="false" class="overview-alert"/>
  <el-alert v-if="componentErrors.length || data.partial" type="warning" :closable="false" :title="`部分数据不可用${componentErrors.length ? `（${componentErrors.length}）`:''}，未知值显示 —`" class="overview-alert">
   <details v-if="componentErrors.length" class="source-errors"><summary>查看数据源错误</summary><ul><li v-for="e in componentErrors" :key="e.key">{{e.key}}：{{e.message}}</li></ul></details>
  </el-alert>
  <div class="overview-stats" aria-label="资源数量">
   <router-link v-for="card in cards" :key="card.key" class="kp-stat" :to="listPath(card.key)" :title="card.cluster ? '集群级授权范围，不随命名空间切换':scopeDescription">
    <div class="label">{{card.label}}</div><div class="value">{{number(stat[card.key])}}</div>
   </router-link>
  </div>
  <section class="health-panel" :class="{'health-panel-ok':healthKnown && !hasActiveRisks,'health-panel-risk':hasActiveRisks}" aria-label="运行状态">
   <div class="health-summary">
    <strong :class="hasActiveRisks ? 'kp-danger':healthKnown ? 'kp-ok':''">{{hasActiveRisks ? '发现活跃异常':healthKnown ? '当前范围内未发现活跃异常':'运行状态待确认'}}</strong>
    <el-button v-if="activePodCount > 0" link type="danger" @click="jump('pods',{state:'active-abnormal'})">{{activePodCount}} 个活跃异常 Pod</el-button>
    <el-button v-if="badNodes.length" link type="danger" @click="showNodes">{{badNodes.length}} 个异常节点</el-button>
    <span v-if="!healthKnown && !hasActiveRisks" class="kp-muted">{{loading ? '正在读取数据':'部分健康数据未能读取'}}</span>
    <span class="spacer"/>
    <el-button v-if="stat.failedPods > 0" link @click="jump('pods',{phase:'Failed'})">历史失败 Pod {{stat.failedPods}}</el-button>
    <el-button v-if="hasActiveRisks" link type="primary" @click="riskDetailsOpen=!riskDetailsOpen" :aria-expanded="riskDetailsOpen">{{riskDetailsOpen ? '收起异常明细':'查看异常明细'}}</el-button>
   </div>
   <div v-if="hasActiveRisks && riskDetailsOpen" class="risk-details">
    <el-table v-if="riskPods.length" :data="riskPods.slice(0,8)" border>
     <el-table-column label="Pod" min-width="220"><template #default="{row}"><router-link :to="podPath(row)">{{row.namespace}} / {{row.name}}</router-link></template></el-table-column>
     <el-table-column label="状态" width="160"><template #default="{row}"><el-tag disable-transitions :type="statusTag(row.status)">{{row.status}}</el-tag></template></el-table-column>
     <el-table-column prop="node" label="节点" min-width="150"/>
     <el-table-column prop="restarts" label="重启" width="80"/>
     <el-table-column label="诊断线索" min-width="240" show-overflow-tooltip><template #default="{row}">{{diagnosis(row)}}</template></el-table-column>
    </el-table>
    <p v-else-if="activePodCount > 0" class="kp-muted">暂无可展示的 Pod 明细，请打开异常 Pod 列表核查。</p>
    <div v-if="badNodes.length" class="node-risks"><router-link v-for="node in badNodes" :key="node.name" :to="nodePath(node)">{{node.name}} · {{!node.ready ? 'NotReady':nodeDiagnosis(node)}}</router-link></div>
    <div class="risk-footer"><el-button v-if="activePodCount > 0" link type="primary" @click="jump('pods',{state:'active-abnormal'})">查看全部异常 Pod</el-button><span v-if="riskPods.length > 8" class="kp-muted">明细显示前 8 项</span></div>
   </div>
  </section>
  <p v-if="podsLimited" class="scope-notice">Pod 诊断仅覆盖前 500 项，完整范围请在资源列表加载更多。</p>
  <el-alert v-if="podError" type="warning" :title="podError" :closable="false" class="overview-alert"/>
  <section class="kp-card usage-panel" aria-labelledby="usage-title">
   <div class="kp-section-title" id="usage-title">Pod 用量 Top 10
    <el-tooltip content="用量 / request 是实际用量与声明预留量的比值，可超过 100%，不是节点容量使用率。" placement="top"><button class="help-button" aria-label="用量指标说明">?</button></el-tooltip>
    <span class="spacer"/>
    <el-select v-model="metricSort" class="metric-sort" aria-label="Top 10 排序"><el-option label="CPU 用量" value="cpu"/><el-option label="内存用量" value="memory"/><el-option label="CPU / request" value="cpuPercent"/><el-option label="内存 / request" value="memoryPercent"/></el-select>
   </div>
   <p v-if="!usage.available" class="kp-muted">{{loading ? '正在读取指标':'无法读取 Pod 用量，请检查数据源错误或 metrics-server。'}}</p>
   <el-table v-else :data="topPods" border max-height="380" empty-text="当前范围暂无 Pod 用量数据" @sort-change="metricTableSort">
    <el-table-column prop="namespace" label="命名空间" min-width="130" show-overflow-tooltip/>
    <el-table-column label="Pod" min-width="200"><template #default="{row}"><router-link :to="podPath(row)">{{row.name}}</router-link></template></el-table-column>
    <el-table-column prop="cpu" label="CPU 实际" min-width="120" sortable="custom"><template #default="{row}">{{row.cpuText}}</template></el-table-column>
    <el-table-column prop="cpuPercent" label="CPU / request" min-width="155" sortable="custom"><template #default="{row}">{{pct(row.cpuPercent)}}</template></el-table-column>
    <el-table-column prop="memory" label="内存实际" min-width="125" sortable="custom"><template #default="{row}">{{row.memoryText}}</template></el-table-column>
    <el-table-column prop="memoryPercent" label="内存 / request" min-width="160" sortable="custom"><template #default="{row}">{{pct(row.memoryPercent)}}</template></el-table-column>
   </el-table>
  </section>
  <details ref="diagnostics" class="kp-card diagnostics-panel">
   <summary>诊断详情<span class="kp-muted">Pod 阶段、节点、事件与连接</span></summary>
   <el-tabs v-model="diagnosticTab" class="diagnostic-tabs">
    <el-tab-pane label="Pod 阶段" name="pods" lazy>
     <p v-if="!phaseRows.length" class="kp-muted">{{data.errors?.pods ? 'Pod 数据读取失败' : loaded ? '暂无 Pod' : '数据尚未读取'}}</p>
     <div v-else class="phase-list"><button v-for="phase in phaseRows" :key="phase.name" class="phase-button" @click="jump('pods',{phase:phase.name})"><span>{{phase.name}}</span><strong>{{phase.count}}</strong><span class="kp-muted">{{phase.percent}}%</span></button></div>
    </el-tab-pane>
    <el-tab-pane label="节点" name="nodes" lazy>
     <el-table :data="data.nodes || []" border :empty-text="data.errors?.nodes ? '节点数据读取失败':'当前授权范围暂无节点'">
      <el-table-column label="节点" min-width="180"><template #default="{row}"><router-link :to="nodePath(row)">{{row.name}}</router-link></template></el-table-column>
      <el-table-column label="健康 / 调度" min-width="180"><template #default="{row}"><el-tag disable-transitions :type="row.ready ? 'success':'danger'">{{row.ready ? 'Ready':'NotReady'}}</el-tag> {{row.unschedulable ? '已封锁':''}} {{row.diskPressure ? 'DiskPressure':''}}</template></el-table-column>
      <el-table-column label="实际 CPU / 内存" min-width="180"><template #default="{row}">{{data.metricsAvailable ? `${row.cpu} / ${row.memory}`:'—（指标不可用）'}}</template></el-table-column>
      <el-table-column label="CPU 容量 / 可分配" min-width="170"><template #default="{row}">{{row.capacity?.cpu || '—'}} / {{row.allocatable?.cpu || '—'}}</template></el-table-column>
      <el-table-column label="内存容量 / 可分配" min-width="210"><template #default="{row}">{{row.capacity?.memory || '—'}} / {{row.allocatable?.memory || '—'}}</template></el-table-column>
      <el-table-column label="Pod / 可分配" min-width="155"><template #header><el-tooltip :content="`实际 Pod 数量仅统计${scopeLabel}；可分配量是节点容量。`"><span tabindex="0">Pod / 可分配</span></el-tooltip></template><template #default="{row}">{{number(row.pods)}} / {{row.allocatable?.pods || '—'}}</template></el-table-column>
      <el-table-column label="污点 / 压力" min-width="240" show-overflow-tooltip><template #default="{row}">{{nodeDiagnosis(row)}}</template></el-table-column>
     </el-table>
    </el-tab-pane>
    <el-tab-pane label="近期事件" name="events" lazy>
     <div class="detail-actions"><el-button link type="primary" @click="jump('events')">全部事件</el-button></div>
     <el-table :data="data.events || []" border :empty-text="data.errors?.events ? '事件数据读取失败':'当前范围暂无近期事件'"><el-table-column prop="type" label="类型" width="100"/><el-table-column prop="reason" label="原因" min-width="150"/><el-table-column prop="object" label="对象" min-width="180"/><el-table-column prop="message" label="说明" min-width="260" show-overflow-tooltip/><el-table-column prop="age" label="时间" width="90"/></el-table>
    </el-tab-pane>
    <el-tab-pane label="连接信息" name="connection" lazy>
     <table class="kp-kv"><tbody><tr><td>API Server</td><td>{{store.cluster?.server || '—'}}</td></tr><tr><td>Kubernetes</td><td>{{store.cluster?.version || '—'}}</td></tr><tr><td>Context</td><td>{{store.cluster?.context || '—'}}</td></tr><tr><td>资源类型</td><td>{{data.resourceTypes ?? '—'}}</td></tr></tbody></table>
    </el-tab-pane>
   </el-tabs>
  </details>
 </div>
</template>
<script setup>
import {ref,computed,onMounted,onUnmounted,watch} from 'vue'
import {useRouter} from 'vue-router'
import api from '../api'
import {store} from '../store'
import {statusTag} from '../config/resources'
import {normalizeRow} from '../config/columns'
import {isAbnormal,createRequestGate} from '../utils/resource'
import {cpath} from '../utils/path'
const router=useRouter(),loading=ref(false),loaded=ref(false),data=ref({}),pods=ref([]),error=ref(''),podError=ref(''),updatedAt=ref(''),podsLimited=ref(false),gate=createRequestGate()
const diagnostics=ref(null),diagnosticTab=ref('pods'),riskDetailsOpen=ref(true)
const stat=computed(()=>data.value.stat || {}),usage=computed(()=>data.value.podUsage || {}),scopeLabel=computed(()=>store.namespace==='all' ? '授权命名空间范围':store.namespace)
const scopeDescription=computed(()=>`Pod、工作负载与事件统计${scopeLabel.value}；节点和命名空间统计集群级授权范围。所有数据受角色资源权限限制。`)
const cards=[{key:'nodes',label:'节点',cluster:true},{key:'namespaces',label:'命名空间',cluster:true},{key:'pods',label:'Pod'},{key:'deployments',label:'Deployment'},{key:'services',label:'Service'}]
const componentErrors=computed(()=>Object.entries(data.value.errors || {}).map(([key,e])=>({key,message:e.message || String(e)})))
const riskPods=computed(()=>pods.value.map(p=>normalizeRow('Pod',p)).filter(r=>isAbnormal(r.status) && !['Failed','Succeeded'].includes(r._raw.status?.phase) && !r._raw.metadata?.deletionTimestamp))
const badNodes=computed(()=>(data.value.nodes || []).filter(n=>!n.ready || n.diskPressure || n.conditions?.some(c=>/Pressure|NetworkUnavailable/.test(c.type) && c.status==='True')))
const activePodCount=computed(()=>Math.max(stat.value.unhealthyPods || 0,riskPods.value.length))
const hasActiveRisks=computed(()=>activePodCount.value > 0 || badNodes.value.length > 0)
const healthKnown=computed(()=>loaded.value && !loading.value && !error.value && !podError.value && !data.value.partial && !componentErrors.value.length && stat.value.unhealthyPods!=null && stat.value.nodes!=null)
const metricSort=ref('cpu'),metricOrder=ref('descending')
const topPods=computed(()=>[...(usage.value.items || [])].sort((a,b)=>{if(a[metricSort.value]==null)return 1;if(b[metricSort.value]==null)return -1;return (metricOrder.value==='ascending' ? 1:-1)*(a[metricSort.value]-b[metricSort.value])}).slice(0,10))
function metricTableSort(v){if(v.prop){metricSort.value=v.prop;metricOrder.value=v.order || 'descending'}}
const phaseRows=computed(()=>{const entries=Object.entries(data.value.podPhases || {}),total=entries.reduce((sum,[,n])=>sum+n,0);return entries.map(([name,count])=>({name,count,percent:total ? Math.round(count/total*100):0}))})
const number=v=>v==null ? '—':v
const pct=v=>v==null ? '—':`${v}%`
function listPath(plural){return cpath(`/r/${plural==='deployments' ? 'apps':'_core'}/v1/${plural}`)}
function jump(plural,query){router.push({path:listPath(plural),query})}
function podPath(row){return cpath(`/r/_core/v1/pods/${encodeURIComponent(row.namespace)}/${encodeURIComponent(row.name)}`)}
function nodePath(row){return cpath(`/r/_core/v1/nodes/_all/${encodeURIComponent(row.name)}`)}
function showNodes(){diagnosticTab.value='nodes';if(diagnostics.value){diagnostics.value.open=true;diagnostics.value.scrollIntoView({block:'nearest',behavior:'smooth'})}}
function diagnosis(row){const st=row._raw.status || {},messages=[st.message,...(st.conditions || []).filter(c=>c.status!=='True').map(c=>c.message)];return messages.filter(Boolean).join('；') || row.reason || '检查事件与容器状态'}
function nodeDiagnosis(row){return [...(row.conditions || []).filter(c=>c.type!=='Ready' && c.status==='True').map(c=>`${c.type}: ${c.message || c.reason || ''}`),...(row.taints || []).map(t=>`${t.key}${t.value ? '='+t.value:''}:${t.effect}`)].join('；') || '无已报告压力或污点'}
async function load(){const id=gate.next(),namespace=store.namespace,clusterId=store.currentClusterId;loading.value=true;loaded.value=false;error.value='';podError.value='';podsLimited.value=false;pods.value=[];try{const result=await api.overview(namespace);if(!gate.current(id))return;data.value=result;loaded.value=true;updatedAt.value=new Date().toLocaleString('zh-CN');try{const p=await api.list('','v1','pods',{namespace,clusterId,limit:500});if(gate.current(id)){pods.value=p.items || [];podsLimited.value=!!p.metadata?.continue}}catch(e){if(gate.current(id)){pods.value=[];podError.value='诊断 Pod 加载失败：'+e.message}}}catch(e){if(gate.current(id)){data.value={};pods.value=[];error.value=e.message || '概览读取失败'}}finally{if(gate.current(id))loading.value=false}}
onMounted(()=>{load();window.addEventListener('kp:refresh',load)});watch(()=>store.namespace,load);onUnmounted(()=>{gate.invalidate();window.removeEventListener('kp:refresh',load)})
</script>
<style scoped>
.overview-toolbar>strong{font-size: 18px}.scope-label{color:var(--kp-muted);border-bottom:1px dotted var(--kp-border-strong);cursor:help}.overview-alert{margin-bottom:14px}.source-errors summary{cursor:pointer}.source-errors ul{margin:8px 0;padding-left:20px;overflow-wrap:anywhere}.overview-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px;margin-bottom:16px}.overview-stats .kp-stat{min-width:0;color:var(--kp-text)}.overview-stats .label{font-size: 13px}.overview-stats .value{font-size: 28px}.health-panel{padding:13px 16px;border:1px solid var(--kp-border);border-radius:var(--kp-r);background:var(--kp-surface);margin-bottom:16px}.health-panel-ok{background:var(--kp-success-bg)}.health-panel-risk{border-color:var(--kp-border-strong)}.health-summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-height:28px}.spacer{flex:1}.risk-details{margin-top:14px}.node-risks{display:flex;flex-direction:column;gap:8px;margin-top:12px;overflow-wrap:anywhere}.risk-footer{display:flex;align-items:center;gap:12px;margin-top:8px}.risk-footer:empty{display:none}.scope-notice{color:var(--kp-muted);margin:-4px 0 14px}.usage-panel{margin-bottom:16px;min-width:0}.kp-section-title{gap:10px;flex-wrap:wrap}.metric-sort{width:174px}.help-button{display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;border:1px solid var(--kp-border-strong);border-radius:50%;background:var(--kp-surface);color:var(--kp-muted);font:inherit;cursor:help}.diagnostics-panel>summary{display:flex;align-items:center;gap:16px;cursor:pointer;font-size: 15px;font-weight:600;list-style:none}.diagnostics-panel>summary::before{content:'›';font-size: 22px;line-height:1;color:var(--kp-muted)}.diagnostics-panel[open]>summary::before{transform:rotate(90deg)}.diagnostics-panel>summary .kp-muted{font-size: 13px;font-weight:400}.diagnostic-tabs{margin-top:14px}.phase-list{display:flex;flex-wrap:wrap;gap:10px}.phase-button{display:flex;align-items:center;gap:18px;padding:12px 16px;border:1px solid var(--kp-border);border-radius:var(--kp-r-sm);background:var(--kp-surface-2);font:inherit;cursor:pointer}.phase-button strong{font-size: 17px}.detail-actions{display:flex;justify-content:flex-end;margin-bottom:8px}.kp-kv td{overflow-wrap:anywhere}a{color:var(--kp-brand)}button:focus-visible,summary:focus-visible,.scope-label:focus-visible{outline:2px solid var(--kp-brand);outline-offset:3px}@media(max-width:1050px){.overview-stats{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:600px){.overview-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.overview-stats .kp-stat{padding:16px}.overview-toolbar .update-time{order:3;width:100%}.health-summary>.spacer{display:none}.health-summary{gap:8px 12px}.diagnostics-panel>summary{align-items:flex-start;flex-wrap:wrap;gap:8px}.diagnostics-panel>summary .kp-muted{width:100%;padding-left:18px}.metric-sort{width:160px}}
</style>
