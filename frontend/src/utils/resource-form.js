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
