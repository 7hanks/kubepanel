const kinds=['Ingress','NetworkPolicy']
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const dnsLabel=value=>typeof value==='string'&&value.length>0&&value.length<=63&&/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value)
const dnsName=value=>typeof value==='string'&&value.length<=253&&value.split('.').every(dnsLabel)
const portName=value=>typeof value==='string'&&value.length<=15&&/[a-z]/.test(value)&&/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value)&&!value.includes('--')
const portNumber=value=>Number.isInteger(value)&&value>=1&&value<=65535

export function isNetworkFormResource(meta){return meta?.group==='networking.k8s.io'&&kinds.includes(meta.kind)}
export function networkDraftFields(kind){
 if(kind==='Ingress')return {spec:{rules:[{host:'',http:{paths:[{path:'/',pathType:'Prefix',backend:{service:{name:'',port:{number:80}}}}]}}],tls:[]}}
 // No policy is submit-ready until the user explicitly chooses its directions.
 if(kind==='NetworkPolicy')return {spec:{podSelector:{matchLabels:{}},policyTypes:[],ingress:[],egress:[]}}
 return {}
}

function validateBackend(backend){
 if(!object(backend)||Number(!!backend.service)+Number(!!backend.resource)!==1)throw new Error('Ingress 后端必须选择一个服务或资源引用')
 if(backend.service){
  if(!dnsLabel(backend.service.name))throw new Error('Ingress 后端服务名称必填，且必须是有效的服务名称')
  const port=backend.service.port
  if(!object(port)||Number(port.number!==undefined)+Number(port.name!==undefined)!==1||port.number!==undefined&&!portNumber(port.number)||port.name!==undefined&&!portName(port.name))throw new Error('Ingress 服务端口必须指定一个有效端口号（1–65535）或端口名称')
 }else if(!backend.resource.name||!backend.resource.kind)throw new Error('Ingress 资源后端的名称和类型必填')
}
function hostValid(host){return dnsName(host.startsWith('*.')?host.slice(2):host)&&!/^\d+\.\d+\.\d+\.\d+$/.test(host)}
function validateIngress(spec){
 if(spec.ingressClassName!==undefined&&!dnsName(spec.ingressClassName))throw new Error('Ingress 类名称无效；不指定时请清空此字段')
 if(spec.rules!==undefined&&!Array.isArray(spec.rules))throw new Error('Ingress 规则必须是列表')
 if(!spec.rules?.length&&!spec.defaultBackend)throw new Error('至少添加一条 Ingress 规则，或配置默认后端')
 if(spec.defaultBackend!==undefined)validateBackend(spec.defaultBackend)
 for(const rule of spec.rules||[]){
  if(!object(rule))throw new Error('Ingress 规则必须是对象')
  if(rule.host!==undefined&&rule.host!==''&&(typeof rule.host!=='string'||!hostValid(rule.host)))throw new Error('Ingress 域名无效，请填写域名或 *.example.com')
  if(!Array.isArray(rule.http?.paths)||!rule.http.paths.length)throw new Error('每条 Ingress 规则至少需要一条路径')
  for(const path of rule.http.paths){
   if(!object(path)||!['Prefix','Exact','ImplementationSpecific'].includes(path.pathType))throw new Error('Ingress 路径类型必须是 Prefix、Exact 或 ImplementationSpecific')
   if(path.path!==undefined&&typeof path.path!=='string'||path.pathType!=='ImplementationSpecific'&&!(typeof path.path==='string'&&path.path.startsWith('/')))throw new Error('Prefix / Exact 路径必须以 / 开头')
   validateBackend(path.backend)
  }
 }
 if(spec.tls!==undefined&&!Array.isArray(spec.tls))throw new Error('TLS 设置必须是列表')
 for(const tls of spec.tls||[]){
  if(!object(tls)||tls.hosts!==undefined&&(!Array.isArray(tls.hosts)||tls.hosts.some(host=>typeof host!=='string'||!hostValid(host))))throw new Error('TLS 域名列表无效')
  if(tls.secretName!==undefined&&tls.secretName!==''&&!dnsName(tls.secretName))throw new Error('TLS Secret 名称无效')
 }
}

function labelKey(value){
 if(typeof value!=='string')return false
 const parts=value.split('/'),name=parts.at(-1)
 return parts.length<=2&&(parts.length===1||dnsName(parts[0]))&&name.length>0&&name.length<=63&&/^[A-Za-z0-9](?:[-_.A-Za-z0-9]*[A-Za-z0-9])?$/.test(name)
}
function labelValue(value){return typeof value==='string'&&value.length<=63&&(value===''||/^[A-Za-z0-9](?:[-_.A-Za-z0-9]*[A-Za-z0-9])?$/.test(value))}
function validateSelector(selector){
 if(!object(selector))throw new Error('标签选择器必须是对象；空对象表示匹配其范围内全部 Pod / 命名空间')
 if(selector.matchLabels!==undefined&&(!object(selector.matchLabels)||Object.entries(selector.matchLabels).some(([key,value])=>!labelKey(key)||!labelValue(value))))throw new Error('标签选择器的标签键或值无效')
 if(selector.matchExpressions!==undefined&&!Array.isArray(selector.matchExpressions))throw new Error('选择器表达式必须是列表')
 for(const expression of selector.matchExpressions||[]){
  if(!object(expression)||!labelKey(expression.key)||!['In','NotIn','Exists','DoesNotExist'].includes(expression.operator))throw new Error('标签选择器表达式的键或操作符无效')
  const values=expression.values||[]
  if(!Array.isArray(values)||values.some(value=>!labelValue(value))||(['In','NotIn'].includes(expression.operator)?values.length===0:values.length!==0))throw new Error('选择器 In / NotIn 需要值；Exists / DoesNotExist 不能填写值')
 }
}
function ipv4(text){
 const bytes=text.split('.')
 if(bytes.length!==4||bytes.some(part=>!/^\d{1,3}$/.test(part)||Number(part)>255))return null
 return bytes.reduce((total,part)=>(total<<8n)+BigInt(part),0n)
}
function ipAddress(text){
 if(!text.includes(':')){const value=ipv4(text);return value===null?null:{bits:32,value}}
 if(text.includes('.') ){
  const tail=text.slice(text.lastIndexOf(':')+1),value=ipv4(tail);if(value===null)return null
  text=text.slice(0,text.lastIndexOf(':')+1)+(value>>16n).toString(16)+':'+(value&65535n).toString(16)
 }
 const parts=text.split('::');if(parts.length>2)return null
 const left=parts[0]?parts[0].split(':'):[],right=parts.length===2&&parts[1]?parts[1].split(':'):[]
 if([...left,...right].some(part=>!/^[0-9a-fA-F]{1,4}$/.test(part)))return null
 const missing=8-left.length-right.length
 if(parts.length===1&&missing!==0||parts.length===2&&missing<1)return null
 return {bits:128,value:[...left,...Array(parts.length===2?missing:0).fill('0'),...right].reduce((total,part)=>(total<<16n)+BigInt('0x'+part),0n)}
}
function cidr(text){
 if(typeof text!=='string')return null
 const parts=text.split('/');if(parts.length!==2||!/^\d{1,3}$/.test(parts[1]))return null
 const ip=ipAddress(parts[0]),prefix=Number(parts[1]);if(!ip||prefix>ip.bits)return null
 return {...ip,prefix,network:ip.value>>BigInt(ip.bits-prefix)}
}
function validatePeer(peer){
 if(!object(peer))throw new Error('网络策略来源 / 目标必须是对象')
 const selectors=['podSelector','namespaceSelector'].filter(key=>peer[key]!==undefined)
 if(peer.ipBlock!==undefined){
  if(selectors.length)throw new Error('ipBlock 不能与 Pod / 命名空间选择器组合')
  const block=peer.ipBlock,network=cidr(block?.cidr);if(!network)throw new Error('ipBlock 必须填写有效的 IPv4 / IPv6 CIDR，例如 10.0.0.0/8')
  if(block.except!==undefined&&!Array.isArray(block.except))throw new Error('ipBlock 排除子网必须是列表')
  for(const except of block.except||[]){const sub=cidr(except);if(!sub||sub.bits!==network.bits||sub.prefix<=network.prefix||sub.value>>BigInt(sub.bits-network.prefix)!==network.network)throw new Error('排除 CIDR 必须是 ipBlock 范围内的更小子网')}
 }else{
  if(!selectors.length)throw new Error('请选择 Pod / 命名空间选择器或 ipBlock；移除所有来源 / 目标表示不限来源 / 目标')
  selectors.forEach(key=>validateSelector(peer[key]))
 }
}
function validatePolicy(spec,{creating=false}={}){
 if(spec.podSelector===undefined)throw new Error('必须配置目标 Pod 选择器，空选择器匹配本命名空间全部 Pod')
 validateSelector(spec.podSelector)
 if(creating&&(!Array.isArray(spec.policyTypes)||!spec.policyTypes.length))throw new Error('请明确选择至少一个策略方向，以及该方向的允许规则或拒绝全部流量')
 if(spec.policyTypes!==undefined&&(!Array.isArray(spec.policyTypes)||!spec.policyTypes.length||spec.policyTypes.some(type=>!['Ingress','Egress'].includes(type))||new Set(spec.policyTypes).size!==spec.policyTypes.length))throw new Error('策略方向必须是 Ingress、Egress 或两者，且不能重复')
 for(const direction of ['ingress','egress']){
  const rules=spec[direction],peerKey=direction==='ingress'?'from':'to'
  if(rules!==undefined&&!Array.isArray(rules))throw new Error('网络策略规则必须是列表')
  if(rules?.length&&spec.policyTypes&&!spec.policyTypes.includes(direction==='ingress'?'Ingress':'Egress'))throw new Error('有规则的方向必须包含在策略方向中')
  for(const rule of rules||[]){
   if(!object(rule))throw new Error('每条网络策略规则必须是对象')
   if(rule[peerKey]!==undefined&&!Array.isArray(rule[peerKey]))throw new Error('网络策略来源 / 目标必须是列表')
   for(const peer of rule[peerKey]||[])validatePeer(peer)
   if(rule.ports!==undefined&&!Array.isArray(rule.ports))throw new Error('网络策略端口必须是列表')
   for(const port of rule.ports||[]){
    if(!object(port)||port.protocol!==undefined&&!['TCP','UDP','SCTP'].includes(port.protocol))throw new Error('网络策略协议必须是 TCP、UDP 或 SCTP')
    if(port.port!==undefined&&!(portNumber(port.port)||portName(port.port)))throw new Error('网络策略端口必须是 1–65535 的整数或端口名称；留空表示所选协议的全部端口')
    if(port.endPort!==undefined&&(!portNumber(port.port)||!portNumber(port.endPort)||port.endPort<port.port))throw new Error('结束端口需要数字起始端口，且不能小于起始端口')
   }
  }
 }
}
export function validateNetworkResource(body,options={}){
 if(!kinds.includes(body?.kind)||body.apiVersion&&body.apiVersion.split('/')[0]!=='networking.k8s.io')return
 if(!object(body.spec))throw new Error('网络资源 spec 必须是对象')
 if(body.kind==='Ingress')validateIngress(body.spec);else validatePolicy(body.spec,options)
}
