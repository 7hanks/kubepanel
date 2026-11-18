export const ADVANCED_FORM_KINDS=['HorizontalPodAutoscaler','ResourceQuota','LimitRange','Endpoints','EndpointSlice']
const apiGroups={HorizontalPodAutoscaler:['autoscaling','v2'],ResourceQuota:['','v1'],LimitRange:['','v1'],Endpoints:['','v1'],EndpointSlice:['discovery.k8s.io','v1']}
export function isAdvancedFormResource(meta){const expected=apiGroups[meta?.kind];return !!expected&&(meta.group==='_core'?'':meta.group||'')===expected[0]&&meta.version===expected[1]}
export function advancedDraftFields(kind,namespace='default'){
 switch(kind){
  case 'HorizontalPodAutoscaler':return {spec:{scaleTargetRef:{apiVersion:'apps/v1',kind:'Deployment',name:''},minReplicas:1,maxReplicas:3,metrics:[{type:'Resource',resource:{name:'cpu',target:{type:'Utilization',averageUtilization:80}}}]}}
  case 'ResourceQuota':return {spec:{hard:{},scopes:[]}}
  case 'LimitRange':return {spec:{limits:[{type:'Container',default:{},defaultRequest:{},min:{},max:{},maxLimitRequestRatio:{}}]}}
  case 'Endpoints':return {subsets:[{addresses:[{ip:''}],ports:[{name:'',protocol:'TCP'}]}]}
  case 'EndpointSlice':return {metadata:{name:'',namespace,labels:{'kubernetes.io/service-name':'','endpointslice.kubernetes.io/managed-by':'kubepanel.example.com/manual'},annotations:{}},addressType:'IPv4',ports:[{name:'',protocol:'TCP'}],endpoints:[{addresses:[''],conditions:{ready:true}}]}
  default:return {}
 }
}
function quantity(value){
 if(!['number','string'].includes(typeof value))return null
 const text=String(value),match=text.match(/^(\+?)(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+|[numkKMGTPE]|[KMGTPE]i)?$/)
 if(!match||text.length>512)return null
 const [, ,decimal,suffix='']=match,[integer,fraction='']=decimal.split('.')
 let numerator=BigInt(`${integer||'0'}${fraction}`),denominator=10n**BigInt(fraction.length)
 if(suffix.endsWith('i'))numerator*=2n**BigInt((['Ki','Mi','Gi','Ti','Pi','Ei'].indexOf(suffix)+1)*10)
 else{const power=/^[eE][+-]?\d+$/.test(suffix)?Number(suffix.slice(1)):({n:-9,u:-6,m:-3,'':0,k:3,K:3,M:6,G:9,T:12,P:15,E:18})[suffix];if(!Number.isSafeInteger(power)||Math.abs(power)>1000)return null;if(power>=0)numerator*=10n**BigInt(power);else denominator*=10n**BigInt(-power)}
 return {numerator,denominator}
}
const compare=(a,b)=>a.numerator*b.denominator-b.numerator*a.denominator
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
function quantityMap(value,label){
 if(value===undefined)return
 if(!object(value)||Object.entries(value).some(([key,item])=>!key.trim()||!quantity(item)))throw new Error(`${label}必须填写有效且非负的 Kubernetes 资源数量`)
}
function list(value,label){if(value!==undefined&&!Array.isArray(value))throw new Error(`${label}必须是列表`);return value||[]}
function ipFamily(value){
 if(typeof value!=='string')return ''
 if(/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)&&value.split('.').every(part=>Number(part)<=255))return 'IPv4'
 if(value.includes(':')&&!/[\s%[\]/]/.test(value)){try{new URL(`http://[${value}]/`);return 'IPv6'}catch{}}
 return ''
}
function validatePorts(ports,slice=false){
 const names=new Set()
 for(const port of list(ports,'端口')){
  if(!object(port)||(!slice||port.port!==undefined&&port.port!==null)&&(!Number.isInteger(port.port)||port.port<1||port.port>65535))throw new Error('端口必须是 1–65535 的整数')
  if(port.protocol!==undefined&&port.protocol!==null&&!['TCP','UDP','SCTP'].includes(port.protocol))throw new Error('端口协议必须是 TCP、UDP 或 SCTP')
  const name=port.name||''
  if(name&&(typeof name!=='string'||name.length>63||!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name)))throw new Error('端口名称必须是有效的 DNS 标签')
  if((ports.length>1&&!name)||names.has(name))throw new Error('多个端口的名称必填且不能重复')
  names.add(name)
 }
}
function validateHpa(body){
 const spec=body.spec||{},ref=spec.scaleTargetRef||{}
 if(typeof ref.name!=='string'||!ref.name.trim())throw new Error('扩缩容目标工作负载名称必填')
 if(typeof ref.kind!=='string'||!ref.kind.trim()||typeof ref.apiVersion!=='string'||!ref.apiVersion.trim())throw new Error('扩缩容目标类型和 API 版本必填')
 const minimum=spec.minReplicas??1
 if(!Number.isInteger(spec.maxReplicas)||spec.maxReplicas<1)throw new Error('最大副本数必须是大于 0 的整数')
 if(!Number.isInteger(minimum)||minimum<0||minimum>spec.maxReplicas)throw new Error('最小副本数必须为非负整数，且不能大于最大副本数')
 const metrics=list(spec.metrics,'扩缩容指标')
 if(minimum===0&&!metrics.some(metric=>['Object','External'].includes(metric.type)))throw new Error('最小副本数为 0 需要 Object 或 External 指标，以及集群开启 HPAScaleToZero')
 for(const metric of metrics){
  if(metric.type!=='Resource')continue
  const resource=metric.resource||{},target=resource.target||{}
  if(typeof resource.name!=='string'||!resource.name.trim())throw new Error('资源指标名称必填')
  if(!['Utilization','AverageValue'].includes(target.type))throw new Error('资源指标目标类型必须是利用率或平均值')
  if(target.type==='Utilization'&&(!Number.isInteger(target.averageUtilization)||target.averageUtilization<=0))throw new Error('目标利用率必须是大于 0 的整数百分比')
  if(target.type==='AverageValue'&&(!quantity(target.averageValue)||quantity(target.averageValue).numerator<=0n))throw new Error('指标平均值必须是大于 0 的 Kubernetes 资源数量')
  if(target.type==='Utilization'&&target.averageValue!==undefined||target.type==='AverageValue'&&target.averageUtilization!==undefined||target.value!==undefined)throw new Error('资源指标只能填写与目标类型对应的一个目标值')
 }
}
function validateQuota(body,{creating}){
 const spec=body.spec||{}
 quantityMap(spec.hard,'资源配额')
 if(creating&&!Object.keys(spec.hard||{}).length)throw new Error('至少添加一项资源配额')
 const scopes=list(spec.scopes,'配额范围')
 if(scopes.some(scope=>typeof scope!=='string'||!scope.trim())||new Set(scopes).size!==scopes.length)throw new Error('配额范围不能为空或重复')
 if(scopes.includes('BestEffort')&&scopes.includes('NotBestEffort')||scopes.includes('Terminating')&&scopes.includes('NotTerminating'))throw new Error('配额范围不能选择互相冲突的类型')
}
function validateLimits(body){
 const limits=list(body.spec?.limits,'资源限制')
 if(!limits.length)throw new Error('至少添加一项资源限制')
 const types=new Set()
 for(const entry of limits){
  if(!['Container','Pod','PersistentVolumeClaim'].includes(entry.type)&&!(typeof entry.type==='string'&&/^[a-z0-9]([-.a-z0-9]*[a-z0-9])?\/[A-Za-z0-9]([-_.A-Za-z0-9]*[A-Za-z0-9])?$/.test(entry.type)))throw new Error('资源限制类型必须是 Container、Pod、PersistentVolumeClaim 或完整限定类型名')
  if(types.has(entry.type))throw new Error('资源限制类型不能重复');types.add(entry.type)
  for(const field of ['default','defaultRequest','min','max','maxLimitRequestRatio'])quantityMap(entry[field],'资源限制')
  if(entry.type==='Pod'&&(Object.keys(entry.default||{}).length||Object.keys(entry.defaultRequest||{}).length))throw new Error('Pod 类型不能配置默认限制或默认请求')
  if(entry.type==='PersistentVolumeClaim'&&entry.min?.storage===undefined&&entry.max?.storage===undefined)throw new Error('存储申请必须配置最小或最大 storage 容量')
  for(const key of new Set(['default','defaultRequest','min','max','maxLimitRequestRatio'].flatMap(field=>Object.keys(entry[field]||{})))){
   const values=Object.fromEntries(['default','defaultRequest','min','max','maxLimitRequestRatio'].map(field=>[field,quantity(entry[field]?.[key])]))
   if(values.min&&values.max&&compare(values.min,values.max)>0n)throw new Error('资源最小限制不能大于最大限制')
   if(values.defaultRequest&&values.default&&compare(values.defaultRequest,values.default)>0n)throw new Error('默认请求不能大于默认限制')
   for(const field of ['default','defaultRequest'])if(values[field]&&(values.min&&compare(values[field],values.min)<0n||values.max&&compare(values[field],values.max)>0n))throw new Error('默认请求或默认限制必须在最小与最大限制之间')
   if(values.maxLimitRequestRatio&&compare(values.maxLimitRequestRatio,quantity('1'))<0n)throw new Error('限制与请求的最大比率不能小于 1')
  }
 }
}
function validateEndpoints(body){
 for(const subset of list(body.subsets,'端点组')){
  for(const address of [...list(subset.addresses,'就绪端点'),...list(subset.notReadyAddresses,'未就绪端点')])if(!ipFamily(address?.ip))throw new Error('端点 IP 必须是有效的 IPv4 或 IPv6 地址')
  validatePorts(subset.ports)
 }
}
function validateSlice(body,{creating,original}){
 if(!['IPv4','IPv6','FQDN'].includes(body.addressType))throw new Error('端点地址类型必须是 IPv4、IPv6 或 FQDN')
 if(!creating&&original&&original.addressType!==body.addressType)throw new Error('端点地址类型创建后不可修改')
 const service=body.metadata?.labels?.['kubernetes.io/service-name']
 if(creating&&(typeof service!=='string'||!service.trim()))throw new Error('关联 Service 名称必填')
 if(service&&(typeof service!=='string'||service.length>63||!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(service)))throw new Error('关联 Service 名称必须是有效的 DNS 标签')
 for(const endpoint of list(body.endpoints,'端点')){
  const addresses=list(endpoint.addresses,'端点地址')
  if(!addresses.length||addresses.length>100)throw new Error('每个端点需要 1–100 个地址')
  for(const address of addresses){
   if(body.addressType==='FQDN'){if(typeof address!=='string'||address.length>253||!address.split('.').every(part=>part&&part.length<=63&&/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/i.test(part)))throw new Error('端点 FQDN 地址格式不合法')}
   else if(ipFamily(address)!==body.addressType)throw new Error(`端点地址必须符合 ${body.addressType} 类型`)
  }
  if(endpoint.conditions?.ready!==undefined&&endpoint.conditions.ready!==null&&typeof endpoint.conditions.ready!=='boolean')throw new Error('端点就绪条件必须是布尔值')
 }
 validatePorts(body.ports,true)
}
export function validateAdvancedResource(body,options={}){
 const parts=String(body?.apiVersion||'').split('/'),group=parts.length===2?parts[0]:'',version=parts.at(-1)
 if(!isAdvancedFormResource({kind:body?.kind,group,version}))return
 if(body.kind==='HorizontalPodAutoscaler')validateHpa(body)
 else if(body.kind==='ResourceQuota')validateQuota(body,options)
 else if(body.kind==='LimitRange')validateLimits(body)
 else if(body.kind==='Endpoints')validateEndpoints(body)
 else validateSlice(body,options)
}
