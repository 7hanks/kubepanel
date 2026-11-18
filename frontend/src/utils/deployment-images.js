const tagPattern = /^\w[\w.-]{0,127}$/
const digestPattern = /^(?:sha256:[a-f0-9]{64}|sha384:[a-f0-9]{96}|sha512:[a-f0-9]{128})$/

export function deploymentImageRows(deployment) {
  const spec = deployment?.spec?.template?.spec
  if (!spec?.containers?.length) throw new Error('部署没有可调整镜像的容器')
  return ['containers', 'initContainers'].flatMap(field => (spec[field] || []).map(({ name, image }, index) => {
    if (!name || typeof image !== 'string' || !image) throw new Error('容器镜像信息不完整，请重新读取')
    const [base, digest] = image.split('@', 2)
    // A registry port is before the last slash. Only a colon after it introduces a tag.
    const colon = base.lastIndexOf(':')
    const tagged = colon > base.lastIndexOf('/')
    const repository = tagged ? base.slice(0, colon) : base
    const version = digest || (tagged ? base.slice(colon + 1) : 'latest')
    return { field, index, name, image, repository, version }
  }))
}

export function imageWithVersion(row, input) {
  const version = input.trim()
  if (version === row.version) return row.image
  const digest = version.replace(/^@/, '')
  if (digestPattern.test(digest)) return digest === row.version ? row.image : `${row.repository}@${digest}`
  if (tagPattern.test(version)) return `${row.repository}:${version}`
  return null
}

export function deploymentImagePatch(uid, generation, changes) {
  const checks = [{ op: 'test', path: '/metadata/uid', value: uid }]
  const replacements = []
  if (Number.isSafeInteger(generation)) checks.push({ op: 'test', path: '/metadata/generation', value: generation })
  for (const { row, image } of changes) {
    const path = `/spec/template/spec/${row.field}/${row.index}`
    checks.push({ op: 'test', path: `${path}/name`, value: row.name }, { op: 'test', path: `${path}/image`, value: row.image })
    replacements.push({ op: 'replace', path: `${path}/image`, value: image })
  }
  return [...checks, ...replacements]
}
