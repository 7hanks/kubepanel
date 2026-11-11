import { dump, loadAll } from 'js-yaml'

const runtimeMetadata = [
  'uid', 'resourceVersion', 'generation', 'creationTimestamp', 'deletionTimestamp',
  'deletionGracePeriodSeconds', 'managedFields', 'selfLink',
]

function cleanMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata
  const cleaned = { ...metadata }
  for (const key of runtimeMetadata) delete cleaned[key]
  if (cleaned.annotations && typeof cleaned.annotations === 'object' && !Array.isArray(cleaned.annotations)) {
    cleaned.annotations = { ...cleaned.annotations }
    delete cleaned.annotations['kubectl.kubernetes.io/last-applied-configuration']
    if (!Object.keys(cleaned.annotations).length) delete cleaned.annotations
  }
  return cleaned
}

const cleanTemplate = template => template && typeof template === 'object'
  ? { ...template, ...(template.metadata ? { metadata: cleanMetadata(template.metadata) } : {}) } : template

function cleanResource(resource) {
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)
    || typeof resource.apiVersion !== 'string' || typeof resource.kind !== 'string') return resource
  const cleaned = { ...resource }
  delete cleaned.status
  if (resource.metadata) cleaned.metadata = cleanMetadata(resource.metadata)
  if (resource.kind.endsWith('List') && Array.isArray(resource.items)) cleaned.items = resource.items.map(cleanResource)
  // Only Kubernetes-defined template paths; never recurse through arbitrary CRD configuration or data.
  const templateWorkload = (resource.apiVersion.startsWith('apps/') && ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet'].includes(resource.kind))
    || (resource.apiVersion.startsWith('batch/') && resource.kind === 'Job')
    || (resource.apiVersion === 'v1' && resource.kind === 'ReplicationController')
  if (templateWorkload && resource.spec?.template) cleaned.spec = { ...resource.spec, template: cleanTemplate(resource.spec.template) }
  if (resource.apiVersion.startsWith('batch/') && resource.kind === 'CronJob') {
    const job = resource.spec?.jobTemplate
    if (job) cleaned.spec = { ...resource.spec, jobTemplate: { ...cleanTemplate(job),
      ...(job.spec?.template ? { spec: { ...job.spec, template: cleanTemplate(job.spec.template) } } : {}) } }
  }
  if (resource.apiVersion === 'v1' && resource.kind === 'PodTemplate' && resource.template) cleaned.template = cleanTemplate(resource.template)
  const { apiVersion, kind, metadata, ...configuration } = cleaned
  return { apiVersion, kind, ...(metadata ? { metadata } : {}), ...configuration }
}

/** A read-only projection. Full text, including resourceVersion, remains the editor's source of truth. */
export function yamlPreview(source, compact = false) {
  if (!compact) return { text: source, error: '' }
  try {
    const documents = loadAll(source).filter(value => value !== null && value !== undefined)
    return { text: documents.map(value => dump(cleanResource(value), { noRefs: true, lineWidth: 120 })).join('---\n'), error: '' }
  } catch (error) {
    const where = error.mark ? `（第 ${error.mark.line + 1} 行）` : ''
    return { text: '', error: `暂时无法生成精简 YAML${where}，请切回完整 YAML 修正格式；原编辑内容已保留。` }
  }
}
