import { kubeRequest, apiPath, KUBE_HEADERS, KubeError } from './kube.js'

const WORKLOADS = { Deployment: 'deployments', StatefulSet: 'statefulsets', DaemonSet: 'daemonsets' }
const CONTROLLERS = {
  'apps/v1/ReplicaSet': ['apps', 'v1', 'replicasets'],
  'apps/v1/StatefulSet': ['apps', 'v1', 'statefulsets'],
  'apps/v1/DaemonSet': ['apps', 'v1', 'daemonsets'],
  'batch/v1/Job': ['batch', 'v1', 'jobs'],
  'v1/ReplicationController': ['', 'v1', 'replicationcontrollers'],
}
const ownerOf = pod => pod.metadata?.ownerReferences?.find(o => o.controller === true && CONTROLLERS[`${o.apiVersion}/${o.kind}`])
const dryQuery = dryRun => dryRun ? '?dryRun=All' : ''
const clone = value => structuredClone(value)
const podPath = (ns, name) => apiPath({ version: 'v1', plural: 'pods', namespace: ns, name })
const exemptPod = pod => !!pod.metadata?.annotations?.['kubernetes.io/config.mirror'] || ownerOf(pod)?.kind === 'DaemonSet' || ['Succeeded', 'Failed'].includes(pod.status?.phase)
async function mapLimit(items, limit, fn) {
  const output = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(items.length, limit) }, async () => {
    while (cursor < items.length) { const i = cursor++; output[i] = await fn(items[i]) }
  }))
  return output
}

/** Only the transport is injectable; production routes always provide the authorization callback. */
export function createOperations({ request = kubeRequest, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now } = {}) {
  const authorize = (options, group, plural, namespace, verb) => options?.authorize?.({ group, plural, namespace, verb })
  const timeout = options => {
    if (!options?.deadline) return 10000
    const remaining = options.deadline - now()
    if (remaining <= 0) throw new KubeError(408, '维护操作已超时，请重新预检；节点可能保持 cordon')
    return Math.max(1, Math.min(10000, remaining))
  }
  async function getPod(namespace, name, clusterId, options) {
    await authorize(options, '', 'pods', namespace, 'get')
    return (await request('GET', podPath(namespace, name), { clusterId, timeout: timeout(options) })).data
  }
  async function evict(pod, clusterId, options) {
    const { namespace, name, uid } = pod.metadata || {}
    if (!namespace || !name || !uid) throw new KubeError(400, 'Pod 缺少 namespace/name/UID，拒绝驱逐')
    await authorize(options, '', 'pods', namespace, 'delete')
    return request('POST', `${podPath(namespace, name)}/eviction${dryQuery(options?.dryRun)}`, {
      clusterId, timeout: timeout(options), body: { apiVersion: 'policy/v1', kind: 'Eviction', metadata: { namespace, name },
        deleteOptions: { preconditions: { uid }, ...(options?.dryRun ? { dryRun: ['All'] } : {}) } },
    })
  }

  async function validateLiveController(pod, clusterId, options) {
    const owner = ownerOf(pod)
    if (!owner || !owner.name || !owner.uid) throw new KubeError(400, 'Pod 没有支持的有效 controller 控制器，拒绝重建操作')
    const [group, version, plural] = CONTROLLERS[`${owner.apiVersion}/${owner.kind}`]
    const namespace = pod.metadata?.namespace
    await authorize(options, group, plural, namespace, 'get')
    const controller = (await request('GET', apiPath({ group, version, plural, namespace, name: owner.name }), { clusterId, timeout: timeout(options) })).data
    if (controller?.metadata?.uid !== owner.uid || controller.metadata.deletionTimestamp) throw new KubeError(409, 'Pod 控制器 UID 不匹配或已删除，请刷新后重试')
    return owner
  }

  async function restartPod(namespace, name, clusterId, options = {}) {
    const pod = await getPod(namespace, name, clusterId, options)
    if (pod.metadata.deletionTimestamp || ['Succeeded', 'Failed'].includes(pod.status?.phase)) throw new KubeError(409, 'Pod 已终止或正在删除，无法提交重建操作')
    const owner = await validateLiveController(pod, clusterId, options)
    await evict(pod, clusterId, options)
    return { ok: true, dryRun: !!options.dryRun, owners: [{ kind: owner.kind, name: owner.name }],
      message: options.dryRun ? 'API Server 驱逐预检通过，未改变 Pod' : '已提交 Pod 驱逐请求；后续调度取决于控制器、预算与集群容量' }
  }

  async function workloadRecords(namespace, name, kind, clusterId, options = {}) {
    const plural = WORKLOADS[kind]
    if (!plural) throw new KubeError(400, '历史记录仅支持 Deployment、StatefulSet、DaemonSet')
    await authorize(options, 'apps', plural, namespace, 'get')
    const workload = (await request('GET', apiPath({ group: 'apps', version: 'v1', plural, namespace, name }), { clusterId })).data
    if (!workload?.metadata?.uid) throw new KubeError(502, '工作负载缺少 UID')
    const historyPlural = kind === 'Deployment' ? 'replicasets' : 'controllerrevisions'
    await authorize(options, 'apps', historyPlural, namespace, 'list')
    const response = await request('GET', apiPath({ group: 'apps', version: 'v1', plural: historyPlural, namespace }), { clusterId })
    const records = (response.data?.items || []).filter(item => item.metadata?.ownerReferences?.some(o => o.controller === true && o.uid === workload.metadata.uid && o.kind === kind)).map(item => {
      const template = clone(kind === 'Deployment' ? item.spec?.template : item.data?.spec?.template)
      if (template?.metadata?.labels) delete template.metadata.labels['pod-template-hash']
      if (template?.$patch) delete template.$patch
      return { revision: Number(kind === 'Deployment' ? item.metadata.annotations?.['deployment.kubernetes.io/revision'] : item.revision),
        name: item.metadata.name, createdAt: item.metadata.creationTimestamp || null,
        images: (template?.spec?.containers || []).map(c => c.image), available: !!template?.spec,
        template, replicas: item.status?.replicas ?? null }
    }).filter(item => Number.isInteger(item.revision) && item.revision > 0).sort((a, b) => b.revision - a.revision)
    return { workload, plural, records }
  }
  async function workloadHistory(namespace, name, kind, clusterId, options = {}) {
    const { records } = await workloadRecords(namespace, name, kind, clusterId, options)
    return { kind, items: records.map(({ template, ...record }) => record) }
  }
  async function rollbackWorkload(namespace, name, kind, revision, clusterId, options = {}) {
    const target = Number(revision)
    if (!Number.isInteger(target) || target <= 0) throw new KubeError(400, 'revision 必须是正整数')
    const { workload, plural, records } = await workloadRecords(namespace, name, kind, clusterId, options)
    const record = records.find(r => r.revision === target)
    if (!record?.available) throw new KubeError(404, '目标 revision 已被清理或不含可恢复的 Pod 模板')
    if (!workload.metadata.resourceVersion) throw new KubeError(502, '工作负载缺少 resourceVersion')
    await authorize(options, 'apps', plural, namespace, 'patch')
    await request('PATCH', apiPath({ group: 'apps', version: 'v1', plural, namespace, name }) + dryQuery(options.dryRun), {
      clusterId, headers: KUBE_HEADERS.jsonPatch, body: [
        { op: 'test', path: '/metadata/uid', value: workload.metadata.uid },
        { op: 'test', path: '/metadata/resourceVersion', value: workload.metadata.resourceVersion },
        { op: 'replace', path: '/spec/template', value: record.template },
      ],
    })
    return { ok: true, dryRun: !!options.dryRun, revision: target, message: options.dryRun ? '回滚服务端预检通过' : '已提交历史 Pod 模板，发布进度请查看工作负载状态' }
  }

  async function getCronJob(namespace, name, clusterId, options) {
    await authorize(options, 'batch', 'cronjobs', namespace, 'get')
    return (await request('GET', apiPath({ group: 'batch', version: 'v1', plural: 'cronjobs', namespace, name }), { clusterId })).data
  }
  async function runCronJob(namespace, name, clusterId, options = {}) {
    const cron = await getCronJob(namespace, name, clusterId, options)
    if (!cron.spec?.jobTemplate?.spec) throw new KubeError(400, 'CronJob 缺少 jobTemplate')
    await authorize(options, 'batch', 'jobs', namespace, 'create')
    const job = { apiVersion: 'batch/v1', kind: 'Job', metadata: {
      namespace, generateName: `${name.slice(0, 45)}-manual-`, labels: clone(cron.spec.jobTemplate.metadata?.labels || {}),
      annotations: { ...clone(cron.spec.jobTemplate.metadata?.annotations || {}), 'cronjob.kubernetes.io/instantiate': 'manual' },
    }, spec: clone(cron.spec.jobTemplate.spec) }
    const result = await request('POST', apiPath({ group: 'batch', version: 'v1', plural: 'jobs', namespace }) + dryQuery(options.dryRun), { clusterId, body: job })
    return { ok: true, dryRun: !!options.dryRun, job: result.data, message: options.dryRun ? 'Job 创建服务端预检通过' : '已创建独立 Job，运行结果请查看 Job 状态' }
  }
  async function suspendCronJob(namespace, name, suspend, clusterId, options = {}) {
    if (typeof suspend !== 'boolean') throw new KubeError(400, 'suspend 必须是布尔 boolean 值')
    const cron = await getCronJob(namespace, name, clusterId, options)
    await authorize(options, 'batch', 'cronjobs', namespace, 'patch')
    await request('PATCH', apiPath({ group: 'batch', version: 'v1', plural: 'cronjobs', namespace, name }) + dryQuery(options.dryRun), {
      clusterId, headers: KUBE_HEADERS.mergePatch, body: { metadata: { resourceVersion: cron.metadata.resourceVersion }, spec: { suspend } },
    })
    return { ok: true, dryRun: !!options.dryRun, suspend, message: options.dryRun ? '暂停状态服务端预检通过' : (suspend ? '已暂停后续定时调度；已运行的 Job 继续运行' : '已恢复定时调度') }
  }

  async function nodeDrainPreflight(name, clusterId, options = {}) {
    await authorize(options, '', 'nodes', undefined, 'get')
    await authorize(options, '', 'pods', undefined, 'list')
    const [node, pods] = await Promise.all([
      request('GET', apiPath({ plural: 'nodes', name }), { clusterId, timeout: timeout(options) }),
      request('GET', `/api/v1/pods?${new URLSearchParams({ fieldSelector: `spec.nodeName=${name}` })}`, { clusterId, timeout: timeout(options) }),
    ])
    const rows = await mapLimit(pods.data?.items || [], 6, async pod => {
      const exempt = exemptPod(pod)
      const blockers = []
      if (!exempt) {
        try { await validateLiveController(pod, clusterId, options) }
        catch (e) { blockers.push(`无法确认存活控制器（${e.status || 502}）：${e.message}`) }
        if ((pod.spec?.volumes || []).some(v => v.emptyDir || v.hostPath)) blockers.push('使用本地 emptyDir/hostPath 存储，驱逐可能丢失数据')
        for (const volume of pod.spec?.volumes || []) {
          if (!volume.persistentVolumeClaim) continue
          try {
            const ns = pod.metadata.namespace
            await authorize(options, '', 'persistentvolumeclaims', ns, 'get')
            const pvc = (await request('GET', apiPath({ plural: 'persistentvolumeclaims', namespace: ns, name: volume.persistentVolumeClaim.claimName }), { clusterId, timeout: timeout(options) })).data
            if (!pvc.spec?.volumeName) continue
            await authorize(options, '', 'persistentvolumes', undefined, 'get')
            const pv = (await request('GET', apiPath({ plural: 'persistentvolumes', name: pvc.spec.volumeName }), { clusterId, timeout: timeout(options) })).data
            if (pv.spec?.local || pv.spec?.hostPath) blockers.push(`PVC ${volume.persistentVolumeClaim.claimName} 使用节点本地卷`)
          } catch (e) { blockers.push(`无法验证 PVC 本地存储安全性：${e.message}`) }
        }
        if (!blockers.length) {
          try { await evict(pod, clusterId, { ...options, dryRun: true }) }
          catch (e) { blockers.push(`驱逐预检失败（${e.status || 502}）：${e.message}`) }
        }
      }
      return { namespace: pod.metadata.namespace, name: pod.metadata.name, uid: pod.metadata.uid, exempt, blockers, pod }
    })
    return { node: name, unschedulable: !!node.data?.spec?.unschedulable, resourceVersion: node.data?.metadata?.resourceVersion,
      pods: rows.map(({ pod, ...row }) => row), blockers: rows.flatMap(row => row.blockers.map(message => ({ namespace: row.namespace, name: row.name, message }))), canDrain: rows.every(row => !row.blockers.length), _pods: rows }
  }
  async function drainNode(name, clusterId, options = {}) {
    const seconds = options.timeoutSeconds === undefined ? 30 : Number(options.timeoutSeconds)
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) throw new KubeError(400, 'timeoutSeconds 必须是 1 到 120 的整数')
    const deadline = now() + seconds * 1000
    options = { ...options, deadline }
    const preflight = await nodeDrainPreflight(name, clusterId, options)
    const result = { ok: false, dryRun: !!options.dryRun, node: name, cordoned: preflight.unschedulable, blockers: preflight.blockers, results: [] }
    if (!preflight.canDrain) return result
    await authorize(options, '', 'nodes', undefined, 'patch')
    await request('PATCH', apiPath({ plural: 'nodes', name }) + dryQuery(options.dryRun), { clusterId, timeout: timeout(options), headers: KUBE_HEADERS.mergePatch,
      body: { metadata: { resourceVersion: preflight.resourceVersion }, spec: { unschedulable: true } } })
    result.cordoned = !options.dryRun || preflight.unschedulable
    for (const row of preflight._pods) {
      if (row.exempt) { result.results.push({ namespace: row.namespace, name: row.name, ok: true, status: 'exempt', message: '跳过 DaemonSet、mirror 或已终止 Pod' }); continue }
      while (true) {
        try {
          await validateLiveController(row.pod, clusterId, options)
          await evict(row.pod, clusterId, options)
          if (!options.dryRun) {
            while (true) {
              let current
              try { current = await getPod(row.namespace, row.name, clusterId, options) } catch (e) { if (e.status === 404) break; throw e }
              if (current?.metadata?.uid !== row.uid) break
              if (now() >= deadline) throw new KubeError(408, '驱逐已提交，但等待 Pod 终止超时；节点保持 cordon')
              await sleep(Math.min(1000, deadline - now()))
            }
          }
          result.results.push({ namespace: row.namespace, name: row.name, ok: true, status: options.dryRun ? 'dryRun' : 'evicted', message: options.dryRun ? '服务端驱逐预检通过' : '原 Pod 已终止' })
          break
        } catch (e) {
          if (!options.dryRun && e.status === 429 && now() < deadline) { await sleep(Math.min(1000, deadline - now())); continue }
          result.results.push({ namespace: row.namespace, name: row.name, ok: false, status: e.status || 502, message: e.message })
          break
        }
      }
    }
    result.ok = result.results.every(row => row.ok)
    if (!options.dryRun && result.ok) {
      try {
        const remaining = (await request('GET', `/api/v1/pods?${new URLSearchParams({ fieldSelector: `spec.nodeName=${name}` })}`, { clusterId, timeout: timeout(options) })).data?.items || []
        for (const pod of remaining.filter(p => !exemptPod(p))) result.results.push({ namespace: pod.metadata.namespace, name: pod.metadata.name, ok: false, status: 409, message: '节点仍有非豁免 Pod，请重新预检；节点保持 cordon' })
      } catch (e) { result.results.push({ ok: false, status: e.status || 502, message: `无法确认节点维护完成：${e.message}` }) }
      result.ok = result.results.every(row => row.ok)
    }
    return result
  }
  return { restartPod, workloadHistory, rollbackWorkload, runCronJob, suspendCronJob, nodeDrainPreflight, drainNode }
}

export const operations = createOperations()
