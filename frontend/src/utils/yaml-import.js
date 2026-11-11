import * as yaml from 'js-yaml'

export const MAX_YAML_IMPORT_BYTES = 2 * 1024 * 1024

function checkExpandedSize(value) {
  // Count repeated aliases as repeated content because dumping without refs expands them.
  const pending = [[value, 0]]
  let nodes = 0, characters = 0
  while (pending.length) {
    const [entry, depth] = pending.pop()
    if (++nodes > 100_000 || depth > 100 || characters > MAX_YAML_IMPORT_BYTES) throw new Error('YAML 内容过大或引用过于复杂')
    if (entry && typeof entry === 'object') {
      for (const [key, child] of Object.entries(entry)) {
        characters += key.length + 4
        pending.push([child, depth + 1])
      }
    } else characters += String(entry ?? '').length + 4
  }
}

export function importYamlDraft(source, baseline, { creating = false } = {}) {
  if (new TextEncoder().encode(source).length > MAX_YAML_IMPORT_BYTES) throw new Error('YAML 文件不能超过 2 MiB')
  let incoming, current
  try { incoming = yaml.load(source); current = yaml.load(baseline) }
  catch { throw new Error('YAML 格式错误，请导入单个资源文件') }
  const object = value => value && typeof value === 'object' && !Array.isArray(value)
  if (!object(incoming) || !object(incoming.metadata) || typeof incoming.metadata.name !== 'string' || !incoming.metadata.name.trim()) {
    throw new Error('文件需包含单个资源及 metadata.name')
  }
  if (!object(current) || incoming.apiVersion !== current.apiVersion || incoming.kind !== current.kind) {
    throw new Error('导入资源的 apiVersion / kind 与当前目标不一致')
  }
  // An omitted namespace means the current dialog scope, never an implicit default scope.
  incoming.metadata.namespace ??= current.metadata?.namespace
  if (!creating) {
    if (incoming.metadata.name !== current.metadata?.name) throw new Error('不能更改当前资源名称')
    if (incoming.metadata.namespace !== current.metadata?.namespace) throw new Error('不能更改当前资源命名空间')
    // Use the baseline read from the server; a later server change still yields 409.
    if (current.metadata?.resourceVersion != null) incoming.metadata.resourceVersion = current.metadata.resourceVersion
  }
  checkExpandedSize(incoming)
  const result = yaml.dump(incoming, { noRefs: true, lineWidth: 120 })
  if (new TextEncoder().encode(result).length > MAX_YAML_IMPORT_BYTES) throw new Error('展开后的 YAML 内容过大')
  return result
}
