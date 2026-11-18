<template>
 <div class="network-resource-form">
  <template v-if="isIngress">
   <el-form label-position="top" :disabled="disabled">
    <el-form-item label="Ingress 类"><el-input :model-value="spec.ingressClassName||''" aria-label="Ingress 类" placeholder="留空使用集群默认类，例如 nginx" @update:model-value="value=>setSpecField('ingressClassName',value,true)"/></el-form-item>
   </el-form>
   <section v-for="(rule,ri) in spec.rules||[]" :key="ri" class="network-block">
    <div class="section-heading"><strong>路由规则 {{ri+1}}</strong><el-button text type="danger" :disabled="disabled" @click="removeItem(spec.rules,ri)">删除规则</el-button></div>
    <el-input v-model="rule.host" :disabled="disabled" :aria-label="`路由域名 ${ri+1}`" placeholder="域名；留空匹配所有域名" @update:model-value="changed"/>
    <div v-for="(path,pi) in rule.http?.paths||[]" :key="pi" class="network-path">
     <div class="network-row"><el-input v-model="path.path" :disabled="disabled" :aria-label="`路由路径 ${ri+1}-${pi+1}`" placeholder="/" @update:model-value="changed"/><el-select v-model="path.pathType" :disabled="disabled" :aria-label="`路径类型 ${ri+1}-${pi+1}`" @change="changed"><el-option v-for="type in ['Prefix','Exact','ImplementationSpecific']" :key="type" :label="type" :value="type"/></el-select><el-button text type="danger" :disabled="disabled" :aria-label="`删除路径 ${ri+1}-${pi+1}`" @click="removeItem(rule.http.paths,pi)">删除</el-button></div>
     <div v-if="path.backend?.service" class="network-row"><el-input v-model="path.backend.service.name" :disabled="disabled" :aria-label="`后端服务名称 ${ri+1}-${pi+1}`" placeholder="后端服务名称" @update:model-value="changed"/><el-input :model-value="path.backend.service.port?.number??path.backend.service.port?.name??''" :disabled="disabled" :aria-label="`后端服务端口 ${ri+1}-${pi+1}`" placeholder="端口号 / 名称，例如 80 / http" @update:model-value="value=>setServicePort(path.backend,value)"/></div>
     <details v-else open><summary>资源后端 / 其他后端设置</summary><StructuredFields :model-value="path.backend||{}" :disabled="disabled" :path="`rules.${ri}.paths.${pi}.backend`" @update:model-value="value=>{path.backend=value;changed()}"/></details>
     <details><summary>其他路径设置</summary><StructuredFields :model-value="extra(path,['path','pathType','backend'])" :reserved-keys="['path','pathType','backend']" :disabled="disabled" :path="`rules.${ri}.paths.${pi}`" @update:model-value="value=>replaceExtra(path,['path','pathType','backend'],value)"/></details>
    </div>
    <el-button :disabled="disabled" @click="addPath(rule)">添加路径</el-button>
    <details><summary>其他路由规则设置</summary><StructuredFields :model-value="extra(rule,['host','http'])" :reserved-keys="['host','http']" :disabled="disabled" :path="`rules.${ri}`" @update:model-value="value=>replaceExtra(rule,['host','http'],value)"/><StructuredFields v-if="rule.http" :model-value="extra(rule.http,['paths'])" :reserved-keys="['paths']" :disabled="disabled" :path="`rules.${ri}.http`" @update:model-value="value=>replaceExtra(rule.http,['paths'],value)"/></details>
   </section>
   <el-button :disabled="disabled" @click="addIngressRule">添加路由规则</el-button>
   <h3>TLS 证书</h3>
   <section v-for="(tls,index) in spec.tls||[]" :key="index" class="network-block">
    <div class="network-row"><el-select :model-value="tls.hosts||[]" multiple filterable allow-create default-first-option :disabled="disabled" :aria-label="`TLS 域名 ${index+1}`" placeholder="输入域名后按回车添加" @update:model-value="value=>setList(tls,'hosts',value)"/><el-input v-model="tls.secretName" :disabled="disabled" :aria-label="`TLS Secret 名称 ${index+1}`" placeholder="Secret 名称；可留空使用默认凭据" @update:model-value="changed"/><el-button text type="danger" :disabled="disabled" @click="removeItem(spec.tls,index)">删除</el-button></div>
    <details><summary>其他 TLS 设置</summary><StructuredFields :model-value="extra(tls,['hosts','secretName'])" :reserved-keys="['hosts','secretName']" :disabled="disabled" :path="`tls.${index}`" @update:model-value="value=>replaceExtra(tls,['hosts','secretName'],value)"/></details>
   </section>
   <el-button :disabled="disabled" @click="addTls">添加 TLS 配置</el-button>
   <details class="network-additional"><summary>默认后端</summary><p class="network-hint">没有匹配路由时使用；与上方路由至少配置一项。</p><StructuredFields v-if="spec.defaultBackend" :model-value="spec.defaultBackend" :disabled="disabled" path="defaultBackend" @update:model-value="value=>setSpecField('defaultBackend',value)"/><div class="network-row"><el-button v-if="!spec.defaultBackend" :disabled="disabled" @click="setSpecField('defaultBackend',newBackend())">添加默认后端</el-button><el-button v-else text type="danger" :disabled="disabled" @click="removeSpecField('defaultBackend')">移除默认后端</el-button></div></details>
  </template>
  <template v-else>
   <h3>目标 Pod</h3><p class="network-hint">空选择器匹配此命名空间全部 Pod；同一 Pod 的多个 NetworkPolicy 允许规则会叠加。</p>
   <KeyValueFields :model-value="spec.podSelector?.matchLabels||{}" label="Pod 标签" add-label="添加 Pod 标签" :disabled="disabled" @update:model-value="setPodLabels" @change="changed" @validity="value=>setChildValidity('pods',value)"/>
   <details><summary>目标 Pod 选择器表达式</summary><StructuredFields :model-value="extra(spec.podSelector||{},['matchLabels'])" :reserved-keys="['matchLabels']" :disabled="disabled" path="podSelector" @update:model-value="setPodSelectorExtra"/></details>
   <section v-for="direction in directions" :key="direction.key" class="network-block">
    <div class="section-heading"><strong>{{direction.label}}策略</strong><el-select :model-value="directionMode(direction.key)" :disabled="disabled" :aria-label="`${direction.label}策略模式`" @update:model-value="value=>setDirectionMode(direction.key,value)"><el-option label="不管理此方向" value="off"/><el-option label="拒绝全部流量（空允许规则列表）" value="deny"/><el-option label="仅允许下方规则" value="rules"/></el-select></div>
    <p v-if="directionMode(direction.key)==='deny'" class="network-warning" role="status">此策略不允许任何{{direction.label}}流量；仍可能被其他 NetworkPolicy 放行。</p>
    <template v-if="directionMode(direction.key)==='rules'">
     <p class="network-hint">各规则之间为“或”；同一规则中的来源 / 目标与端口为“且”。</p>
     <section v-for="(rule,ri) in spec[direction.key]||[]" :key="ri" class="network-rule">
      <div class="section-heading"><strong>允许规则 {{ri+1}}</strong><el-button text type="danger" :disabled="disabled" @click="removeItem(spec[direction.key],ri)">删除规则</el-button></div>
      <p v-if="!rule[direction.peers]?.length" class="network-warning">未限制{{direction.peerLabel}}，本条规则匹配全部{{direction.peerLabel}}。</p>
      <div v-for="(peer,pi) in rule[direction.peers]||[]" :key="pi" class="network-peer">
       <div class="network-row"><el-select :model-value="peerType(peer)" :disabled="disabled" :aria-label="`${direction.peerLabel}类型 ${ri+1}-${pi+1}`" @update:model-value="value=>setPeerType(peer,value)"><el-option label="本命名空间 Pod 标签" value="pod"/><el-option label="命名空间标签（该空间全部 Pod）" value="namespace"/><el-option label="命名空间标签 + Pod 标签（同时满足）" value="both"/><el-option label="IP 网段（ipBlock）" value="ip"/></el-select><el-button text type="danger" :disabled="disabled" @click="removeItem(rule[direction.peers],pi)">删除{{direction.peerLabel}}</el-button></div>
       <template v-if="peer.ipBlock">
        <el-input v-model="peer.ipBlock.cidr" :disabled="disabled" :aria-label="`IP 网段 ${direction.key}-${ri}-${pi}`" placeholder="CIDR，例如 10.0.0.0/8 或 2001:db8::/32" @update:model-value="changed"/>
        <el-select :model-value="peer.ipBlock.except||[]" multiple filterable allow-create default-first-option :disabled="disabled" :aria-label="`排除子网 ${direction.key}-${ri}-${pi}`" placeholder="排除子网，输入后按回车添加" @update:model-value="value=>setList(peer.ipBlock,'except',value)"/>
       </template>
       <template v-for="selectorKey in ['namespaceSelector','podSelector']" :key="selectorKey">
        <div v-if="peer[selectorKey]" class="selector-fields"><strong>{{selectorKey==='podSelector'?'Pod 标签':'命名空间标签'}}</strong><p class="network-hint">空选择器表示此范围内全部{{selectorKey==='podSelector'?' Pod':'命名空间'}}。</p><KeyValueFields :model-value="peer[selectorKey].matchLabels||{}" :label="selectorKey" :disabled="disabled" @update:model-value="value=>setSelectorLabels(peer[selectorKey],value)" @change="changed" @validity="value=>setChildValidity(peer[selectorKey],value)"/><details><summary>选择器表达式</summary><StructuredFields :model-value="extra(peer[selectorKey],['matchLabels'])" :reserved-keys="['matchLabels']" :disabled="disabled" :path="`${direction.key}.${ri}.${pi}.${selectorKey}`" @update:model-value="value=>replaceExtra(peer[selectorKey],['matchLabels'],value)"/></details></div>
       </template>
       <details><summary>其他{{direction.peerLabel}}设置</summary><StructuredFields :model-value="extra(peer,['ipBlock','podSelector','namespaceSelector'])" :reserved-keys="['ipBlock','podSelector','namespaceSelector']" :disabled="disabled" :path="`${direction.key}.${ri}.peers.${pi}`" @update:model-value="value=>replaceExtra(peer,['ipBlock','podSelector','namespaceSelector'],value)"/><StructuredFields v-if="peer.ipBlock" :model-value="extra(peer.ipBlock,['cidr','except'])" :reserved-keys="['cidr','except']" :disabled="disabled" :path="`${direction.key}.${ri}.peers.${pi}.ipBlock`" @update:model-value="value=>replaceExtra(peer.ipBlock,['cidr','except'],value)"/></details>
      </div>
      <el-button :disabled="disabled" @click="addPeer(rule,direction.peers)">添加{{direction.peerLabel}}</el-button>
      <h4>允许端口</h4><p v-if="!rule.ports?.length" class="network-warning">未限制端口：本条规则允许全部协议与端口。</p>
      <div v-for="(port,pi) in rule.ports||[]" :key="pi" class="network-port">
       <div class="network-row"><el-select :model-value="port.protocol||'TCP'" :disabled="disabled" :aria-label="`协议 ${direction.key}-${ri}-${pi}`" @update:model-value="value=>setField(port,'protocol',value)"><el-option v-for="protocol in ['TCP','UDP','SCTP']" :key="protocol" :label="protocol" :value="protocol"/></el-select><el-input :model-value="port.port??''" :disabled="disabled" :aria-label="`起始端口 ${direction.key}-${ri}-${pi}`" placeholder="端口号 / 名称；留空=此协议全部端口" @update:model-value="value=>setPolicyPort(port,value)"/><el-input-number :model-value="port.endPort" :min="1" :max="65535" :disabled="disabled" :aria-label="`结束端口 ${direction.key}-${ri}-${pi}`" placeholder="结束端口（可选，仅数字端口）" @update:model-value="value=>setOptionalNumber(port,'endPort',value)"/><el-button text type="danger" :disabled="disabled" @click="removeItem(rule.ports,pi)">删除端口</el-button></div>
       <StructuredFields v-if="Object.keys(extra(port,['port','protocol','endPort'])).length" :model-value="extra(port,['port','protocol','endPort'])" :reserved-keys="['port','protocol','endPort']" :disabled="disabled" :path="`${direction.key}.${ri}.ports.${pi}`" @update:model-value="value=>replaceExtra(port,['port','protocol','endPort'],value)"/>
      </div>
      <el-button :disabled="disabled" @click="addPolicyPort(rule)">添加端口</el-button>
      <details><summary>其他规则设置</summary><StructuredFields :model-value="extra(rule,[direction.peers,'ports'])" :reserved-keys="[direction.peers,'ports']" :disabled="disabled" :path="`${direction.key}.${ri}`" @update:model-value="value=>replaceExtra(rule,[direction.peers,'ports'],value)"/></details>
     </section>
     <el-button :disabled="disabled" @click="addPolicyRule(direction.key)">添加允许规则</el-button>
    </template>
   </section>
  </template>
  <details class="network-additional"><summary>其他{{isIngress?'Ingress':'网络策略'}}设置</summary><StructuredFields :model-value="additionalFields" :reserved-keys="managedFields" :disabled="disabled" path="spec" @update:model-value="setAdditionalFields"/></details>
 </div>
</template>
<script setup>
import {computed,ref,watch} from 'vue'
import {validateNetworkResource} from '../utils/network-resource-form'
import KeyValueFields from './KeyValueFields.vue'
import StructuredFields from './StructuredFields.vue'
const props=defineProps({modelValue:{type:Object,required:true},creating:Boolean,disabled:Boolean})
const emit=defineEmits(['change','validity'])
const spec=computed(()=>props.modelValue.spec||{}),isIngress=computed(()=>props.modelValue.kind==='Ingress'),touched=ref(false),childErrors=ref(new Map())
const managedFields=computed(()=>isIngress.value?['ingressClassName','rules','tls','defaultBackend']:['podSelector','policyTypes','ingress','egress'])
const additionalFields=computed(()=>extra(spec.value,managedFields.value))
const directions=[{key:'ingress',type:'Ingress',label:'入站',peers:'from',peerLabel:'来源'},{key:'egress',type:'Egress',label:'出站',peers:'to',peerLabel:'目标'}]
const activeSelectors=computed(()=>new Set(['pods',...directions.flatMap(direction=>(spec.value[direction.key]||[]).flatMap(rule=>(rule[direction.peers]||[]).flatMap(peer=>[peer.podSelector,peer.namespaceSelector].filter(Boolean))))]))
const validity=computed(()=>{const child=[...childErrors.value].find(([selector,error])=>error&&activeSelectors.value.has(selector));if(child)return child[1];if(!touched.value)return '';try{validateNetworkResource(props.modelValue,{creating:props.creating});return ''}catch(error){return error.message}})
watch(validity,value=>emit('validity',value),{immediate:true})
function changed(){if(!props.disabled){touched.value=true;emit('change')}}
function extra(target,keys){return Object.fromEntries(Object.entries(target||{}).filter(([key])=>!keys.includes(key)))}
function replaceExtra(target,keys,value){if(props.disabled)return;for(const key of Object.keys(target))if(!keys.includes(key))delete target[key];for(const [key,item] of Object.entries(value||{}))if(!keys.includes(key)&&!['__proto__','constructor','prototype'].includes(key))target[key]=item;changed()}
function ensureSpec(){return props.modelValue.spec||={}}
function setSpecField(key,value,optional=false){if(props.disabled)return;if(optional&&value==='')delete ensureSpec()[key];else ensureSpec()[key]=value;changed()}
function removeSpecField(key){if(props.disabled)return;delete ensureSpec()[key];changed()}
function setField(target,key,value){if(props.disabled)return;target[key]=value;changed()}
function setList(target,key,value){if(props.disabled)return;target[key]=[...value];changed()}
function removeItem(list,index){if(props.disabled)return;list.splice(index,1);changed()}
function newBackend(){return {service:{name:'',port:{number:80}}}}
function newPath(){return {path:'/',pathType:'Prefix',backend:newBackend()}}
function addIngressRule(){if(props.disabled)return;(ensureSpec().rules||=[]).push({host:'',http:{paths:[newPath()]}});changed()}
function addPath(rule){if(props.disabled)return;rule.http||={};(rule.http.paths||=[]).push(newPath());changed()}
function addTls(){if(props.disabled)return;(ensureSpec().tls||=[]).push({hosts:[],secretName:''});changed()}
function setServicePort(backend,value){if(props.disabled||!backend.service)return;backend.service.port=replaceManaged(backend.service.port||{},['number','name'],/^\d+$/.test(String(value))?{number:Number(value)}:{name:value});changed()}
function replaceManaged(target,keys,value){return {...extra(target,keys),...value}}
function setAdditionalFields(value){if(props.disabled)return;replaceExtra(ensureSpec(),managedFields.value,value)}
function setPodLabels(value){if(props.disabled)return;ensureSpec().podSelector||={};ensureSpec().podSelector.matchLabels=value;changed()}
function setPodSelectorExtra(value){if(props.disabled)return;ensureSpec().podSelector||={};replaceExtra(ensureSpec().podSelector,['matchLabels'],value)}
function setSelectorLabels(selector,value){if(props.disabled)return;selector.matchLabels=value;changed()}
function setChildValidity(key,value){if(value)childErrors.value.set(key,value);else childErrors.value.delete(key)}
function effectiveTypes(){return spec.value.policyTypes||['Ingress',...(spec.value.egress?.length?['Egress']:[])]}
function directionMode(direction){const type=direction==='ingress'?'Ingress':'Egress';return !effectiveTypes().includes(type)?'off':spec.value[direction]?.length?'rules':'deny'}
function newPolicyRule(direction){return {[direction==='ingress'?'from':'to']:[{ipBlock:{cidr:''}}],ports:[{protocol:'TCP',port:80}]}}
function setDirectionMode(direction,mode){
 if(props.disabled||!['ingress','egress'].includes(direction))return
 const target=ensureSpec(),type=direction==='ingress'?'Ingress':'Egress',types=effectiveTypes().filter(value=>value!==type)
 if(mode==='off'){delete target[direction]}else{types.push(type);if(mode==='deny')target[direction]=[];else if(!target[direction]?.length)target[direction]=[newPolicyRule(direction)]}
 target.policyTypes=['Ingress','Egress'].filter(value=>types.includes(value));changed()
}
function addPolicyRule(direction){if(props.disabled)return;(ensureSpec()[direction]||=[]).push(newPolicyRule(direction));changed()}
function addPeer(rule,key){if(props.disabled)return;(rule[key]||=[]).push({ipBlock:{cidr:''}});changed()}
function peerType(peer){return peer.ipBlock?'ip':peer.podSelector&&peer.namespaceSelector?'both':peer.namespaceSelector?'namespace':'pod'}
function setPeerType(peer,type){
 if(props.disabled)return
 if(type==='ip'){delete peer.podSelector;delete peer.namespaceSelector;peer.ipBlock||={cidr:''}}
 else{delete peer.ipBlock;if(type==='pod'||type==='both')peer.podSelector||={matchLabels:{}};else delete peer.podSelector;if(type==='namespace'||type==='both')peer.namespaceSelector||={matchLabels:{}};else delete peer.namespaceSelector}
 changed()
}
function addPolicyPort(rule){if(props.disabled)return;(rule.ports||=[]).push({protocol:'TCP',port:80});changed()}
function setPolicyPort(port,value){if(props.disabled)return;if(value==='')delete port.port;else port.port=/^\d+$/.test(String(value))?Number(value):value;changed()}
function setOptionalNumber(target,key,value){if(props.disabled)return;if(value===undefined||value===null)delete target[key];else target[key]=value;changed()}
</script>
<style scoped>
.network-resource-form{min-width:0}.network-resource-form h3{font-size:15px;margin:22px 0 12px}.network-resource-form h4{font-size:13px;margin:16px 0 8px}.network-block{border:1px solid var(--kp-border);border-radius:8px;padding:16px;margin:14px 0}.network-row,.section-heading{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.section-heading{justify-content:space-between}.network-row>.el-input,.network-row>.el-select{flex:1;min-width:160px}.section-heading>.el-select{width:310px;max-width:100%}.network-path,.network-rule{background:var(--kp-surface-2);padding:14px;border-radius:7px;margin:12px 0}.network-peer{border-left:2px solid var(--kp-border);padding:10px 0 10px 14px;margin:10px 0}.network-peer>.el-input,.network-peer>.el-select{width:100%;margin:5px 0}.network-hint,.network-warning{font-size:13px;line-height:1.6;color:var(--kp-muted);margin:7px 0 12px}.network-warning{color:var(--kp-warning)}.selector-fields{margin-top:12px}.selector-fields>strong{font-size:13px}details{margin:14px 0}summary{font-size:13px;cursor:pointer;color:var(--kp-text-2);margin-bottom:10px}.network-additional{border-top:1px solid var(--kp-border);padding-top:16px;margin-top:22px}
@media(max-width:600px){.network-block,.network-path,.network-rule{padding:12px}.network-row>.el-input,.network-row>.el-select,.section-heading>.el-select{min-width:0;width:100%;flex-basis:100%}.network-port .el-input-number{width:100%}}
</style>
