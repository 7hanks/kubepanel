import { apiPath, kubeRequest, KubeError } from './kube.js'

const PLURALS = { ReplicaSet: 'replicasets', StatefulSet: 'statefulsets', Deployment: 'deployments' }
const uidPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,252}$/
const labelPattern = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/

function identity(namespace, name) {
  if (typeof namespace !== 'string' || namespace.length > 63 || !labelPattern.test(namespace)
    || typeof name !== 'string' || name.length > 253 || !name.split('.').every(label => label.length <= 63 && labelPattern.test(label))) {
    throw new KubeError(400, '缺少合法的 namespace/name，拒绝扩缩容')
  }
}
function requireUid(uid, label) {
  if (typeof uid !== 'string' || !uidPattern.test(uid)) throw new KubeError(400, `缺少合法的 ${label} UID，请刷新后重新选择`)
}
function replicaCount(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 999) throw new KubeError(400, `${label} 必须是 0–999 的整数`)
}
function controllerOf(resource) {
  const owners = resource.metadata?.ownerReferences
  if (owners !== undefined && !Array.isArray(owners)) throw new KubeError(400, '资源 ownerReferences 格式无效')
  const controllers = (owners || []).filter(owner => owner?.controller === true)
  if (controllers.length > 1) throw new KubeError(400, '资源存在多个 controller，拒绝扩缩容')
  return controllers[0]
}
function ownerIdentity(owner, namespace, supportedKinds) {
  if (!owner || owner.apiVersion !== 'apps/v1' || !supportedKinds.includes(owner.kind)) {
    throw new KubeError(400, '该 Pod 的控制器不支持扩缩容；仅支持 Deployment、独立 ReplicaSet 和 StatefulSet')
  }
  identity(namespace, owner.name)
  requireUid(owner.uid, '控制器')
}
function verifyResource(resource, { apiVersion, kind, namespace, name, uid }) {
  if (resource?.apiVersion !== apiVersion || resource?.kind !== kind || resource.metadata?.namespace !== namespace
    || resource.metadata?.name !== name || resource.metadata?.uid !== uid || resource.metadata?.deletionTimestamp) {
    throw new KubeError(409, 'Pod 或控制器身份已变化或正在删除，请刷新后重新选择')
  }
}
const pathOf = target => apiPath({ group: target.group, version: target.version, plural: target.plural, namespace: target.namespace, name: target.name })

/** Transport injection is internal; production routes provide resource authorization on every read/write. */
export function createPodScaling({ request = kubeRequest } = {}) {
  const authorize = (options, group, plural, namespace, verb) => options.authorize?.({ group, version: 'v1', plural, namespace, verb })
  const get = async (path, clusterId) => (await request('GET', path, { clusterId })).data

  async function resolveTarget(namespace, name, clusterId, options = {}) {
    identity(namespace, name)
    requireUid(options.uid, '所选 Pod')
    await authorize(options, '', 'pods', namespace, 'get')
    const pod = await get(apiPath({ version: 'v1', plural: 'pods', namespace, name }), clusterId)
    verifyResource(pod, { apiVersion: 'v1', kind: 'Pod', namespace, name, uid: options.uid })
    if (pod.metadata.annotations?.['kubernetes.io/config.mirror'] !== undefined) throw new KubeError(400, '静态镜像 Pod 不支持扩缩容')

    async function load(owner, supportedKinds) {
      ownerIdentity(owner, namespace, supportedKinds)
      const plural = PLURALS[owner.kind]
      await authorize(options, 'apps', plural, namespace, 'get')
      const resource = await get(apiPath({ group: 'apps', version: 'v1', plural, namespace, name: owner.name }), clusterId)
      verifyResource(resource, { apiVersion: owner.apiVersion, kind: owner.kind, namespace, name: owner.name, uid: owner.uid })
      return resource
    }

    let controller = await load(controllerOf(pod), ['ReplicaSet', 'StatefulSet'])
    if (controller.kind === 'ReplicaSet') {
      const owner = controllerOf(controller)
      if (owner) controller = await load(owner, ['Deployment'])
    }
    if (!Number.isSafeInteger(controller.spec?.replicas) || controller.spec.replicas < 0 || !controller.metadata.resourceVersion) {
      throw new KubeError(502, '控制器缺少有效的 replicas/resourceVersion，拒绝扩缩容')
    }
    return { kind: controller.kind, group: 'apps', version: 'v1', plural: PLURALS[controller.kind], namespace,
      name: controller.metadata.name, uid: controller.metadata.uid, replicas: controller.spec.replicas, resourceVersion: controller.metadata.resourceVersion }
  }

  async function scalePod(namespace, name, clusterId, options = {}) {
    replicaCount(options.replicas, 'replicas')
    replicaCount(options.expectedReplicas, 'expectedReplicas')
    requireUid(options.controllerUid, '控制器')
    if (options.dryRun !== undefined && typeof options.dryRun !== 'boolean') throw new KubeError(400, 'dryRun 必须是布尔值')
    const target = await resolveTarget(namespace, name, clusterId, options)
    const checkExpected = current => {
      if (current.uid !== options.controllerUid || current.replicas !== options.expectedReplicas
        || current.kind !== target.kind || current.namespace !== target.namespace || current.name !== target.name) {
        throw new KubeError(409, '控制器或副本数已变化，请刷新后重新确认扩缩容')
      }
    }
    checkExpected(target)
    await authorize(options, target.group, target.plural, namespace, 'update')

    const scalePath = `${pathOf(target)}/scale`
    const scale = await get(scalePath, clusterId)
    verifyResource(scale, { apiVersion: 'autoscaling/v1', kind: 'Scale', namespace, name: target.name, uid: target.uid })
    if (scale.spec?.replicas !== options.expectedReplicas) throw new KubeError(409, '控制器副本数已变化，请刷新后重新确认扩缩容')
    if (typeof scale.metadata.resourceVersion !== 'string' || !scale.metadata.resourceVersion) throw new KubeError(502, 'Scale 缺少 resourceVersion，拒绝扩缩容')

    // A Pod/ReplicaSet can change ownership while the Scale GET is in flight. Recheck the full chain.
    checkExpected(await resolveTarget(namespace, name, clusterId, options))
    await authorize(options, target.group, target.plural, namespace, 'update')
    const result = await request('PUT', scalePath + (options.dryRun ? '?dryRun=All' : ''), { clusterId, body: {
      apiVersion: 'autoscaling/v1', kind: 'Scale',
      metadata: { name: target.name, namespace, uid: target.uid, resourceVersion: scale.metadata.resourceVersion },
      spec: { replicas: options.replicas },
    } })
    return { ok: true, dryRun: !!options.dryRun, replicas: options.replicas,
      target: { ...target, replicas: options.replicas, resourceVersion: result.data?.metadata?.resourceVersion || scale.metadata.resourceVersion },
      message: options.dryRun ? '扩缩容服务端预检通过' : '已提交控制器副本数，实际运行数量请查看工作负载状态' }
  }

  return { resolveTarget, scalePod }
}

export const podScaling = createPodScaling()
