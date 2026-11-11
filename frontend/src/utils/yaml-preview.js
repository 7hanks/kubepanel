import { dump, loadAll } from 'js-yaml'

const runtimeMetadata = [
  'uid', 'resourceVersion', 'generation', 'creationTimestamp', 'deletionTimestamp',
  'deletionGracePeriodSeconds', 'managedFields', 'selfLink',
]
const runtimeAnnotations = new Set(['cni.projectcalico.org/containerID', 'cni.projectcalico.org/podIP', 'cni.projectcalico.org/podIPs', 'k8s.v1.cni.cncf.io/network-status'])
const owns = (value, key) => value && typeof value === 'object' && Object.hasOwn(value, key)
function equal(left, right) {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => owns(right, key) && equal(left[key], right[key]))
}
const emptyObject = value => value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length

function originalConfiguration(resource) {
  try {
    const original = JSON.parse(resource.metadata?.annotations?.['kubectl.kubernetes.io/last-applied-configuration'])
    return original?.apiVersion === resource.apiVersion && original?.kind === resource.kind && original?.metadata?.name === resource.metadata?.name
      && (!original.metadata.namespace || original.metadata.namespace === resource.metadata?.namespace) ? original : null
  } catch { return null }
}

function userOwnsPodField(resource, key) {
  return (resource?.metadata?.managedFields || []).some(record => !['kube-scheduler', 'kube-controller-manager', 'kubelet', 'calico'].includes(record.manager)
    && owns(record.fieldsV1?.['f:spec'], `f:${key}`))
}

function stripDefaults(value, original, defaults) {
  const cleaned = { ...value }
  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (!owns(original, key) && (defaultValue === 'empty-object' ? emptyObject(value[key]) : value[key] === defaultValue)) delete cleaned[key]
  }
  return cleaned
}

function standardApiVolume(volume) {
  const projected = volume.projected
  if (!/^kube-api-access-[a-z0-9]{5,}$/.test(volume.name || '') || Object.keys(volume).some(key => !['name', 'projected'].includes(key))
    || !projected || Object.keys(projected).some(key => !['sources', 'defaultMode'].includes(key))
    || (projected.defaultMode !== undefined && projected.defaultMode !== 420) || projected.sources?.length !== 3) return false
  const expected = [
    { serviceAccountToken: { expirationSeconds: 3607, path: 'token' } },
    { configMap: { name: 'kube-root-ca.crt', items: [{ key: 'ca.crt', path: 'ca.crt' }] } },
    { downwardAPI: { items: [{ path: 'namespace', fieldRef: { apiVersion: 'v1', fieldPath: 'metadata.namespace' } }] } },
  ]
  return expected.every(item => projected.sources.filter(source => equal(source, item)).length === 1)
}

function cleanPodSpec(spec, original, livePod) {
  if (!spec || typeof spec !== 'object') return spec
  const cleaned = stripDefaults(spec, original, { restartPolicy: 'Always', dnsPolicy: 'ClusterFirst', terminationGracePeriodSeconds: 30,
    serviceAccountName: 'default', serviceAccount: 'default', schedulerName: 'default-scheduler', securityContext: 'empty-object',
    enableServiceLinks: true, ...(!spec.priorityClassName ? { priority: 0, preemptionPolicy: 'PreemptLowerPriority' } : {}) })
  if (livePod && !owns(original, 'nodeName') && livePod.metadata?.managedFields?.length && !userOwnsPodField(livePod, 'nodeName')) delete cleaned.nodeName
  const containerKeys = ['containers', 'initContainers', 'ephemeralContainers']
  const allContainers = containerKeys.flatMap(key => spec[key] || [])
  const removedVolumes = new Set(livePod ? (spec.volumes || []).filter(volume => {
    if (spec.automountServiceAccountToken === false || !standardApiVolume(volume) || original?.volumes?.some(item => item.name === volume.name)) return false
    const mounts = allContainers.flatMap(container => (container.volumeMounts || []).filter(mount => mount.name === volume.name))
    return mounts.length > 0 && mounts.every(mount => mount.mountPath === '/var/run/secrets/kubernetes.io/serviceaccount' && mount.readOnly === true
      && Object.keys(mount).every(key => ['name', 'mountPath', 'readOnly'].includes(key)))
      && !allContainers.some(container => container.volumeDevices?.some(device => device.name === volume.name))
  }).map(volume => volume.name) : [])
  if (removedVolumes.size) {
    cleaned.volumes = spec.volumes.filter(volume => !removedVolumes.has(volume.name))
    if (!cleaned.volumes.length) delete cleaned.volumes
  }
  for (const key of containerKeys) {
    if (!Array.isArray(spec[key])) continue
    cleaned[key] = spec[key].map(container => {
      const originalContainer = original?.[key]?.find(item => item.name === container.name)
      const value = stripDefaults(container, originalContainer, { resources: 'empty-object', terminationMessagePath: '/dev/termination-log', terminationMessagePolicy: 'File', stdin: false, stdinOnce: false, tty: false })
      if (removedVolumes.size && container.volumeMounts) {
        value.volumeMounts = container.volumeMounts.filter(mount => !removedVolumes.has(mount.name))
        if (!value.volumeMounts.length) delete value.volumeMounts
      }
      if (Array.isArray(container.ports)) value.ports = container.ports.map(port => stripDefaults(port,
        originalContainer?.ports?.find(item => item.containerPort === port.containerPort && (item.protocol || 'TCP') === (port.protocol || 'TCP')), { protocol: 'TCP' }))
      return value
    })
  }
  if (livePod && Array.isArray(spec.tolerations) && !userOwnsPodField(livePod, 'tolerations')) {
    cleaned.tolerations = spec.tolerations.filter(toleration => {
      if (original?.tolerations?.some(item => equal(item, toleration))) return true
      return !(['node.kubernetes.io/not-ready', 'node.kubernetes.io/unreachable'].includes(toleration.key)
        && toleration.operator === 'Exists' && toleration.effect === 'NoExecute' && toleration.tolerationSeconds === 300
        && Object.keys(toleration).every(key => ['key', 'operator', 'effect', 'tolerationSeconds'].includes(key)))
    })
    if (!cleaned.tolerations.length) delete cleaned.tolerations
  }
  return cleaned
}

function cleanMetadata(metadata, original, pod = false) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata
  const cleaned = { ...metadata }
  for (const key of runtimeMetadata) delete cleaned[key]
  if (cleaned.annotations && typeof cleaned.annotations === 'object' && !Array.isArray(cleaned.annotations)) {
    cleaned.annotations = { ...cleaned.annotations }
    delete cleaned.annotations['kubectl.kubernetes.io/last-applied-configuration']
    if (pod) for (const key of runtimeAnnotations) if (!owns(original?.annotations, key)) delete cleaned.annotations[key]
    if (!Object.keys(cleaned.annotations).length) delete cleaned.annotations
  }
  return cleaned
}

const cleanTemplate = (template, original, pod = true) => template && typeof template === 'object'
  ? { ...template, ...(template.metadata ? { metadata: cleanMetadata(template.metadata, original?.metadata, pod) } : {}),
    ...(pod && template.spec ? { spec: cleanPodSpec(template.spec, original?.spec) } : {}) } : template

function cleanResource(resource, summary) {
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)
    || typeof resource.apiVersion !== 'string' || typeof resource.kind !== 'string') return resource
  const cleaned = { ...resource }
  const original = originalConfiguration(resource)
  if (original) summary.original++
  delete cleaned.status
  const livePod = resource.apiVersion === 'v1' && resource.kind === 'Pod'
  if (resource.metadata) cleaned.metadata = cleanMetadata(resource.metadata, original?.metadata, livePod)
  if (livePod) cleaned.spec = cleanPodSpec(resource.spec, original?.spec, resource)
  if (resource.kind.endsWith('List') && Array.isArray(resource.items)) cleaned.items = resource.items.map(item => cleanResource(item, summary))
  // Only Kubernetes-defined template paths; never recurse through arbitrary CRD configuration or data.
  const templateWorkload = (resource.apiVersion.startsWith('apps/') && ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet'].includes(resource.kind))
    || (resource.apiVersion.startsWith('batch/') && resource.kind === 'Job')
    || (resource.apiVersion === 'v1' && resource.kind === 'ReplicationController')
  if (templateWorkload && resource.spec?.template) cleaned.spec = { ...resource.spec, template: cleanTemplate(resource.spec.template, original?.spec?.template) }
  if (resource.apiVersion.startsWith('batch/') && resource.kind === 'CronJob') {
    const job = resource.spec?.jobTemplate
    if (job) cleaned.spec = { ...resource.spec, jobTemplate: { ...cleanTemplate(job, original?.spec?.jobTemplate, false),
      ...(job.spec?.template ? { spec: { ...job.spec, template: cleanTemplate(job.spec.template, original?.spec?.jobTemplate?.spec?.template) } } : {}) } }
  }
  if (resource.apiVersion === 'v1' && resource.kind === 'PodTemplate' && resource.template) cleaned.template = cleanTemplate(resource.template, original?.template)
  const { apiVersion, kind, metadata, ...configuration } = cleaned
  return { apiVersion, kind, ...(metadata ? { metadata } : {}), ...configuration }
}

/** A read-only projection. Full text, including resourceVersion, remains the editor's source of truth. */
export function yamlPreview(source, compact = false) {
  if (!compact) return { text: source, error: '', notice: '' }
  try {
    const documents = loadAll(source).filter(value => value !== null && value !== undefined)
    const summary = { original: 0 }
    const text = documents.map(value => dump(cleanResource(value, summary), { noRefs: true, lineWidth: 120 })).join('---\n')
    return { text, error: '', notice: summary.original ? '参考可用的上次应用配置保留显式字段，值仍取当前对象；不能还原原文件注释。'
      : '未保存原始清单：按规则隐藏常见默认值和系统注入项，不保证还原原文件。' }
  } catch (error) {
    const where = error.mark ? `（第 ${error.mark.line + 1} 行）` : ''
    return { text: '', error: `暂时无法生成精简 YAML${where}，请切回完整 YAML 修正格式；原编辑内容已保留。`, notice: '' }
  }
}
