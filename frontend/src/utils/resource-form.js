import { load, dump } from 'js-yaml'
import { yamlTemplate } from '../config/columns.js'
import { importYamlDraft } from './yaml-import.js'

export const WORKLOAD_KINDS = ['Pod','Deployment','StatefulSet','DaemonSet','ReplicaSet','Job','CronJob']
export const cloneResource = value => JSON.parse(JSON.stringify(value))
export const apiVersionOf = meta => meta.group ? `${meta.group}/${meta.version}` : meta.version
export function mergeFormFields(source, reserved, fields) {
  return Object.fromEntries([
    ...Object.entries(source).filter(([key]) => reserved.includes(key)),
    ...Object.entries(fields).filter(([key]) => !reserved.includes(key) && !['__proto__','constructor','prototype'].includes(key)),
  ])
}
export function podTemplate(resource) {
  if (resource.kind === 'Pod') return resource
  return resource.kind === 'CronJob' ? resource.spec?.jobTemplate?.spec?.template : resource.spec?.template
}
export const podSpec = resource => podTemplate(resource)?.spec
export function newResourceDraft(meta, namespace) {
  const resource = load(yamlTemplate(meta, namespace))
  resource.apiVersion = apiVersionOf(meta)
  resource.metadata.labels ||= {}
  resource.metadata.annotations ||= {}
  if (WORKLOAD_KINDS.includes(meta.kind)) {
    const job = ['Job','CronJob'].includes(meta.kind)
    const template = { metadata: { labels: job ? {} : { app: '' } }, spec: { containers: [{ name: 'app', image: '' }], restartPolicy: job ? 'OnFailure' : 'Always' } }
    if (meta.kind === 'Pod') resource.spec = template.spec
    else if (meta.kind === 'CronJob') resource.spec = { schedule: '*/5 * * * *', concurrencyPolicy: 'Allow', jobTemplate: { spec: { template } } }
    else {
      resource.spec = { template }
      if (!job) resource.spec.selector = { matchLabels: { app: '' } }
      if (['Deployment','StatefulSet','ReplicaSet'].includes(meta.kind)) resource.spec.replicas = 1
      if (meta.kind === 'StatefulSet') resource.spec.serviceName = ''
    }
  }
  if (meta.kind === 'ConfigMap') resource.data = {}
  return resource
}
export function rowsToMap(rows) {
  const keys = new Set(), entries = []
  for (const row of rows) {
    if (!row.key) throw new Error('键名称不能为空')
    if (keys.has(row.key)) throw new Error(`键名称重复：${row.key}`)
    keys.add(row.key); entries.push([row.key, String(row.value ?? '')])
  }
  return Object.fromEntries(entries)
}
function validateWorkload(body) {
  const spec = podSpec(body)
  if (!spec || !Array.isArray(spec.containers) || !spec.containers.length) throw new Error('至少添加一个工作容器')
  const names = new Set()
  for (const container of [...spec.containers, ...(spec.initContainers || [])]) {
    if (!container.name || !container.image?.trim()) throw new Error('每个容器的名称和镜像必填')
    if (names.has(container.name)) throw new Error(`容器名称重复：${container.name}`)
    names.add(container.name)
    const envNames = (container.env || []).map(item => item.name)
    if (envNames.some(name => !name) || new Set(envNames).size !== envNames.length) throw new Error('环境变量名称不能为空或重复')
  }
  if (body.kind === 'CronJob' && !body.spec.schedule?.trim()) throw new Error('CronJob 调度表达式必填')
  if (body.kind === 'StatefulSet' && !body.spec.serviceName?.trim()) throw new Error('StatefulSet 服务名称必填')
}
function validateService(body){
 const spec=body.spec||{},type=spec.type||'ClusterIP'
 if(type==='ExternalName'){
  if(typeof spec.externalName!=='string'||!spec.externalName.trim())throw new Error('ExternalName 服务的外部域名必填')
 }else if(spec.clusterIP!=='None'&&(!Array.isArray(spec.ports)||!spec.ports.length))throw new Error('至少添加一个服务端口')
 const names=new Set(),ports=new Set()
 for(const port of spec.ports||[]){
  if(!Number.isInteger(port.port)||port.port<1||port.port>65535)throw new Error('服务端口必须是 1–65535 的整数')
  if(typeof port.targetPort==='number'&&(!Number.isInteger(port.targetPort)||port.targetPort<1||port.targetPort>65535))throw new Error('目标端口必须是 1–65535 的整数或端口名称')
  if(typeof port.targetPort==='string'&&(port.targetPort.length>15||!/[a-z]/.test(port.targetPort)||port.targetPort.includes('--')||!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(port.targetPort)))throw new Error('目标端口名称无效；数字端口请填写整数')
  if((spec.ports.length>1&&!port.name)||port.name&&names.has(port.name))throw new Error('多个端口的名称必填，且不能重复')
  if(Object.hasOwn(port,'nodePort')&&(!Number.isInteger(port.nodePort)||port.nodePort<0||port.nodePort>65535))throw new Error('节点端口必须是 0–65535 的整数')
  if(port.name)names.add(port.name)
  const key=`${port.port}/${port.protocol||'TCP'}`;if(ports.has(key))throw new Error('服务端口与协议不能重复');ports.add(key)
 }
}
export function resourceBody(draft, {meta, creating, original, validate = true}) {
  const body = cloneResource(draft)
  if (!body || Array.isArray(body) || body.kind !== meta.kind || body.apiVersion !== apiVersionOf(meta)) throw new Error('资源类型 kind / apiVersion 与当前目标不一致')
  body.metadata ||= {}
  if (!creating) {
    if (body.metadata.name !== original?.metadata?.name || body.metadata.namespace !== original?.metadata?.namespace) throw new Error('不能更改资源名称或命名空间身份')
    for (const key of ['resourceVersion','uid']) if (original.metadata[key] != null) body.metadata[key] = original.metadata[key]
    if (validate && !body.metadata.resourceVersion) throw new Error('缺少资源版本，请重新读取后编辑')
  }
  if (validate) {
    if (typeof body.metadata.name !== 'string' || !body.metadata.name.trim()) throw new Error('资源名称必填')
    if (meta.namespaced && (typeof body.metadata.namespace !== 'string' || !body.metadata.namespace.trim())) throw new Error('命名空间必填')
  }
  if (!meta.namespaced) delete body.metadata.namespace
  delete body.status
  delete body.metadata.managedFields
  if (creating) {
    for (const key of ['uid','resourceVersion','creationTimestamp','generation','deletionTimestamp']) delete body.metadata[key]
    if (['Deployment','StatefulSet','DaemonSet','ReplicaSet'].includes(body.kind)) {
      const labels = body.spec?.selector?.matchLabels
      const template = podTemplate(body)
      if (labels && labels.app === '') labels.app = body.metadata.name
      if (template?.metadata?.labels?.app === '') template.metadata.labels.app = labels?.app || body.metadata.name
    }
  }
  if (validate && WORKLOAD_KINDS.includes(body.kind)) validateWorkload(body)
  if(body.kind==='Service'){
    const type=body.spec?.type||'ClusterIP'
    if((body.spec?.sessionAffinity||'None')==='None'&&body.spec)delete body.spec.sessionAffinityConfig
    if(body.spec&&(type==='ExternalName'||!['NodePort','LoadBalancer'].includes(type)&&!body.spec.externalIPs?.length))delete body.spec.externalTrafficPolicy
    if(type!=='ExternalName'&&body.spec)delete body.spec.externalName
    if(type!=='LoadBalancer'&&body.spec)delete body.spec.loadBalancerSourceRanges
    if(type==='ExternalName'&&body.spec)delete body.spec.internalTrafficPolicy
    if(type==='ExternalName')for(const key of ['clusterIP','clusterIPs','ipFamilies','ipFamilyPolicy','selector','healthCheckNodePort','allocateLoadBalancerNodePorts'])delete body.spec[key]
    if(['ClusterIP','ExternalName'].includes(type)){for(const port of body.spec?.ports||[])delete port.nodePort;delete body.spec?.healthCheckNodePort;delete body.spec?.allocateLoadBalancerNodePorts}
    if(validate)validateService(body)
  }
  for (const field of ['data','stringData']) if (body[field] && ['ConfigMap','Secret'].includes(body.kind)) {
    if (Object.values(body[field]).some(value => typeof value !== 'string')) throw new Error(`${field} 的值必须是文本`)
  }
  return body
}
export function parseResourceYaml(text, options) {
  const baseline = options.original || newResourceDraft(options.meta)
  const parsed = load(importYamlDraft(text, dump(baseline), { creating: options.creating }))
  return resourceBody(parsed, { ...options, validate: false })
}
