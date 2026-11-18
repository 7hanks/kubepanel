import {dump} from 'js-yaml'

export const GENERATOR_KINDS=['Deployment','StatefulSet','DaemonSet','Pod','Job','CronJob','Service','ConfigMap','Secret','Namespace']
export const GENERATOR_WORKLOADS=['Deployment','StatefulSet','DaemonSet','Pod','Job','CronJob']
export const generatorHasNetwork=kind=>['Deployment','StatefulSet','DaemonSet','Pod'].includes(kind)
export function newGeneratorDraft(kind='Deployment',namespace='default'){
 return {kind,name:'',namespace:namespace||'default',replicas:1,schedule:'0 * * * *',nodeName:'',restartPolicy:'Always',governingService:'',containers:[{id:'container-1',name:'app',image:'',ports:[],env:[],mounts:[]}],volumes:[],service:{enabled:false,type:'ClusterIP',ports:[{name:'http',port:80,target:'',targetPort:'',nodePort:''}]},ingress:{enabled:false,host:'',path:'/',className:'',tlsSecret:''},serviceSelector:[],data:[]}
}
export function generatorContainerPorts(draft){return (draft.containers||[]).flatMap(container=>(container.ports||[]).map(port=>({key:`${container.id}/${port.id}`,label:`${container.name || '容器'} · ${port.name || port.containerPort || '端口'} (${port.containerPort || '未填写'}/${port.protocol||'TCP'})`,port:port.containerPort,protocol:port.protocol||'TCP',name:port.name||''})))}
const dns=(value,max=63)=>typeof value==='string'&&value.length>0&&value.length<=max&&/^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/.test(value)
const label=value=>dns(value)&&!value.includes('.')
const validPort=value=>Number.isInteger(value)&&value>=1&&value<=65535
const protocol=value=>['TCP','UDP','SCTP'].includes(value||'TCP')
function rowsMap(rows,description,validate){const seen=new Set(),entries=[];for(const row of rows||[]){if(validate&&(!row.key||seen.has(row.key)))throw new Error(`${description}的键不能为空或重复`);seen.add(row.key);entries.push([row.key||'',String(row.value??'')])}return Object.fromEntries(entries)}
function requireName(name,description='资源名称',max=63){if(!dns(name,max))throw new Error(`${description}需由小写字母、数字和连字符组成，长度不超过 ${max} 个字符`)}
function requirePortName(name){if(name&&(!label(name)||name.length>15||!/[a-z]/.test(name)))throw new Error('端口名称需为 1–15 个小写字母、数字或连字符，并至少包含一个字母')}
function validateDraft(draft){
 if(!GENERATOR_KINDS.includes(draft.kind))throw new Error('请选择支持的资源类型')
 requireName(draft.name,'资源名称',['ConfigMap','Secret'].includes(draft.kind)?253:63)
 if(['Namespace','Service'].includes(draft.kind)&&!label(draft.name))throw new Error('资源名称必须是有效的 DNS 标签，不能包含点')
 if(draft.kind!=='Namespace'&&!label(draft.namespace))throw new Error('命名空间必须是有效的 DNS 标签，不能包含点')
 if(GENERATOR_WORKLOADS.includes(draft.kind)){
  if(!draft.containers?.length)throw new Error('至少添加一个容器')
  const names=new Set(),volumeNames=new Set(),hostPorts=new Set(),portNames=new Set()
  for(const volume of draft.volumes||[]){
   if(!label(volume.name)||volumeNames.has(volume.name))throw new Error('存储卷名称不能为空、重复或包含无效字符');volumeNames.add(volume.name)
   if(!['emptyDir','configMap','secret','persistentVolumeClaim','hostPath'].includes(volume.type))throw new Error('请选择有效的存储卷类型')
   if(['configMap','secret','persistentVolumeClaim'].includes(volume.type))requireName(volume.source,'存储卷引用名称',253)
   if(volume.type==='hostPath'&&!String(volume.source||'').startsWith('/'))throw new Error('宿主机存储卷路径必须为绝对路径')
  }
  for(const container of draft.containers){
   if(!label(container.name)||names.has(container.name))throw new Error('容器名称不能为空、重复或包含无效字符');names.add(container.name)
   if(typeof container.image!=='string'||!container.image.trim())throw new Error('请填写每个容器的镜像')
   for(const port of container.ports||[]){
    if(!validPort(port.containerPort)||!protocol(port.protocol))throw new Error('容器端口需为 1–65535 的整数，协议需为 TCP、UDP 或 SCTP')
    requirePortName(port.name);if(port.name&&portNames.has(port.name))throw new Error('容器端口名称不能重复');if(port.name)portNames.add(port.name)
    if(port.hostPort!==undefined&&port.hostPort!==null&&port.hostPort!==''){
     if(!validPort(port.hostPort))throw new Error('宿主机端口需为 1–65535 的整数')
     const key=`${port.hostPort}/${port.protocol||'TCP'}`;if(hostPorts.has(key))throw new Error('宿主机端口与协议不能重复');hostPorts.add(key)
    }
   }
   const envNames=new Set();for(const env of container.env||[]){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(env.name)||envNames.has(env.name))throw new Error('环境变量名称无效或重复');envNames.add(env.name)}
   const paths=new Set();for(const mount of container.mounts||[]){if(!volumeNames.has(mount.name))throw new Error('挂载引用的存储卷不存在');if(!String(mount.mountPath||'').startsWith('/')||paths.has(mount.mountPath))throw new Error('挂载路径必须为不重复的绝对路径');paths.add(mount.mountPath)}
  }
  if(['Deployment','StatefulSet'].includes(draft.kind)&&(!Number.isInteger(draft.replicas)||draft.replicas<0))throw new Error('副本数必须为非负整数')
  if(draft.kind==='CronJob'&&!String(draft.schedule||'').trim())throw new Error('请填写 CronJob 调度表达式')
  if (draft.kind === 'StatefulSet') {
   const serviceName = governingServiceName(draft)
   if (!label(serviceName)) throw new Error('StatefulSet 管理服务名称需为不超过 63 字符的 DNS 标签')
   if (draft.service.enabled && serviceName === draft.name) throw new Error('管理服务名称必须与对外生成的 Service 名称不同')
  }
  if(draft.nodeName)requireName(draft.nodeName,'节点名称',253)
  if(draft.kind==='Pod'&&!['Always','Never','OnFailure'].includes(draft.restartPolicy))throw new Error('请选择有效的重启策略')
 }
 if(draft.kind==='Service'||generatorHasNetwork(draft.kind)&&draft.service.enabled)validateService(draft)
 if(generatorHasNetwork(draft.kind)&&draft.ingress.enabled){
  if(!draft.service.enabled)throw new Error('请先启用 Service，再配置 Ingress')
  if (servicePorts(draft)[0]?.protocol !== 'TCP') throw new Error('Ingress 使用的首个 Service 端口必须为 TCP')
  if(!dns(draft.ingress.host,253)||/^\d+\.\d+\.\d+\.\d+$/.test(draft.ingress.host))throw new Error('请填写有效的 Ingress 域名')
  if(!String(draft.ingress.path||'').startsWith('/'))throw new Error('Ingress 路径必须以 / 开头')
  if(draft.ingress.tlsSecret)requireName(draft.ingress.tlsSecret,'TLS Secret 名称',253)
 }
 if(['ConfigMap','Secret'].includes(draft.kind)){rowsMap(draft.data,'数据条目',true);for(const row of draft.data||[])if(!/^[A-Za-z0-9._-]{1,253}$/.test(row.key))throw new Error('数据键只能包含字母、数字、点、连字符和下划线')}
}
function validateService(draft){
 const service=draft.service||{},attached=draft.kind!=='Service',available=generatorContainerPorts(draft),names=new Set(),ports=new Set()
 if(!['ClusterIP','NodePort','LoadBalancer'].includes(service.type))throw new Error('请选择有效的 Service 类型')
 if(attached&&!label(draft.name))throw new Error('生成 Service 的资源名称不能包含点')
 if(!service.ports?.length)throw new Error('至少添加一个 Service 端口')
 for(const port of service.ports){
  if(!validPort(port.port))throw new Error('Service 端口需为 1–65535 的整数')
  requirePortName(port.name);if(service.ports.length>1&&!port.name||port.name&&names.has(port.name))throw new Error('多个 Service 端口的名称必填且不能重复');names.add(port.name)
  const target=attached?(port.target?available.find(item=>item.key===port.target):available[0]):null
  if(attached&&!target)throw new Error('Service 目标端口不存在，请先配置容器端口并重新选择')
  if(!attached){if(!protocol(port.protocol))throw new Error('请选择有效的端口协议');const targetPort=port.targetPort;if(targetPort!==''&&targetPort!==undefined&&targetPort!==null){if(/^\d+$/.test(String(targetPort))){if(!validPort(Number(targetPort)))throw new Error('目标端口需为 1–65535 的整数')}else requirePortName(targetPort)}}
  const key=`${port.port}/${target?.protocol||port.protocol||'TCP'}`;if(ports.has(key))throw new Error('Service 端口与协议不能重复');ports.add(key)
  if(service.type==='NodePort'&&port.nodePort!==''&&port.nodePort!==undefined&&port.nodePort!==null&&!validPort(port.nodePort))throw new Error('NodePort 需为 1–65535 的整数，或留空由集群分配')
 }
 if(!attached){rowsMap(draft.serviceSelector,'Service 选择器',true);for(const row of draft.serviceSelector||[]){const parts=String(row.key).split('/'),name=parts.at(-1),prefix=parts.length===2?parts[0]:'';if(parts.length>2||name.length>63||!/^[A-Za-z0-9]([-_.A-Za-z0-9]*[A-Za-z0-9])?$/.test(name)||prefix&&!dns(prefix,253)||String(row.value).length>63||row.value!==''&&!/^[A-Za-z0-9]([-_.A-Za-z0-9]*[A-Za-z0-9])?$/.test(String(row.value)))throw new Error('Service 选择器需填写有效的 Kubernetes 标签键和值')}}
}
function servicePorts(draft){const available=generatorContainerPorts(draft);return (draft.service.ports||[]).map(port=>{const target=draft.kind==='Service'?null:(port.target?available.find(item=>item.key===port.target):available[0]);const targetValue=port.targetPort===undefined||port.targetPort===null||port.targetPort===''?port.port:/^\d+$/.test(String(port.targetPort))?Number(port.targetPort):port.targetPort;return {...(port.name?{name:port.name}:{}),port:port.port,targetPort:draft.kind==='Service'?targetValue:target?.port??'',protocol:target?.protocol||port.protocol||'TCP',...(draft.service.type==='NodePort'&&port.nodePort!==''&&port.nodePort!==undefined&&port.nodePort!==null?{nodePort:port.nodePort}:{})}})}

function governingServiceName(draft) {
 return draft.governingService || `${draft.name}-headless`
}

function governingServicePorts(draft) {
 const uniquePorts = new Map()
 for (const port of generatorContainerPorts(draft)) {
  const key = `${port.port}/${port.protocol}`
  if (!uniquePorts.has(key)) uniquePorts.set(key, port)
 }
 const ports = [...uniquePorts.values()]
 const usedNames = new Set(ports.map(port => port.name).filter(Boolean))
 let index = 1
 return ports.map(({ name, port, protocol }) => {
  if (!name) {
   do { name = `port-${index++}` } while (usedNames.has(name))
   usedNames.add(name)
  }
  return { name, port, targetPort: port, protocol }
 })
}

function podSpec(draft){
 const spec={containers:(draft.containers||[]).map(container=>({name:container.name,image:container.image,...(container.ports?.length?{ports:container.ports.map(port=>({...port.name?{name:port.name}:{},containerPort:port.containerPort,protocol:port.protocol||'TCP',...(port.hostPort!==''&&port.hostPort!==undefined&&port.hostPort!==null?{hostPort:port.hostPort}:{})}))}:{}),...(container.env?.length?{env:container.env.map(env=>({name:env.name,value:String(env.value??'')}))}:{}),...(container.mounts?.length?{volumeMounts:container.mounts.map(mount=>({name:mount.name,mountPath:mount.mountPath,...(mount.subPath?{subPath:mount.subPath}:{}),...(mount.readOnly?{readOnly:true}:{})}))}:{})})),restartPolicy:['Job','CronJob'].includes(draft.kind)?'OnFailure':draft.kind==='Pod'?draft.restartPolicy:'Always'}
 if(draft.nodeName)spec.nodeName=draft.nodeName
 if(draft.volumes?.length)spec.volumes=draft.volumes.map(volume=>({name:volume.name,...(volume.type==='emptyDir'?{emptyDir:{}}:volume.type==='configMap'?{configMap:{name:volume.source}}:volume.type==='secret'?{secret:{secretName:volume.source}}:volume.type==='persistentVolumeClaim'?{persistentVolumeClaim:{claimName:volume.source}}:{hostPath:{path:volume.source}})}))
 return spec
}
export function buildGeneratedResources(draft,{validate=true}={}){
 if(validate)validateDraft(draft)
 if(!GENERATOR_KINDS.includes(draft.kind))throw new Error('请选择支持的资源类型')
 const kind=draft.kind,metadata={name:draft.name,...(kind!=='Namespace'?{namespace:draft.namespace}:{})},labels={app:draft.name},resources=[]
 if(GENERATOR_WORKLOADS.includes(kind)){
  const template={metadata:{labels:{...labels}},spec:podSpec(draft)},body={apiVersion:['Deployment','StatefulSet','DaemonSet'].includes(kind)?'apps/v1':['Job','CronJob'].includes(kind)?'batch/v1':'v1',kind,metadata:{...metadata,labels:{...labels}}}
  if(kind==='Pod')body.spec=template.spec
  else if(kind==='CronJob')body.spec={schedule:draft.schedule,jobTemplate:{spec:{template}}}
  else{body.spec={template};if(['Deployment','StatefulSet','DaemonSet'].includes(kind))body.spec.selector={matchLabels:{...labels}};if(['Deployment','StatefulSet'].includes(kind))body.spec.replicas=draft.replicas;if(kind==='StatefulSet')body.spec.serviceName=governingServiceName(draft)}
  resources.push(body)
  if (kind === 'StatefulSet') resources.push({
   apiVersion: 'v1',
   kind: 'Service',
   metadata: { ...metadata, name: body.spec.serviceName },
   spec: { clusterIP: 'None', selector: { ...labels }, ports: governingServicePorts(draft) },
  })
 }else if(kind==='Namespace')resources.push({apiVersion:'v1',kind,metadata})
 else if(kind==='ConfigMap')resources.push({apiVersion:'v1',kind,metadata,data:rowsMap(draft.data,'配置数据',validate)})
 else if(kind==='Secret')resources.push({apiVersion:'v1',kind,metadata,type:'Opaque',stringData:rowsMap(draft.data,'Secret 数据',validate)})
 if(kind==='Service'||generatorHasNetwork(kind)&&draft.service.enabled)resources.push({apiVersion:'v1',kind:'Service',metadata:{...metadata},spec:{type:draft.service.type,selector:kind==='Service'?rowsMap(draft.serviceSelector,'Service 选择器',validate):{...labels},ports:servicePorts(draft)}})
 if(generatorHasNetwork(kind)&&draft.ingress.enabled)resources.push({apiVersion:'networking.k8s.io/v1',kind:'Ingress',metadata:{...metadata},spec:{...(draft.ingress.className?{ingressClassName:draft.ingress.className}:{}),rules:[{host:draft.ingress.host,http:{paths:[{path:draft.ingress.path||'/',pathType:'Prefix',backend:{service:{name:draft.name,port:{number:draft.service.ports?.[0]?.port??80}}}}]}}],...(draft.ingress.tlsSecret?{tls:[{hosts:[draft.ingress.host],secretName:draft.ingress.tlsSecret}]}:{})}})
 return resources
}
export function generateResourceYaml(draft,options){return buildGeneratedResources(draft,options).map(resource=>dump(resource,{noRefs:true,lineWidth:110,noCompatMode:true})).join('---\n')}
export function downloadGeneratedYaml(text,name){const blob=new Blob([text],{type:'application/yaml;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');try{link.href=url;link.download=`${String(name||'resources').replace(/[^a-zA-Z0-9_.-]/g,'-')}.yaml`;document.body.appendChild(link);link.click()}finally{link.remove();URL.revokeObjectURL(url)}}
