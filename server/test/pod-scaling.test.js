import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kubepanel-pod-scale-'))
process.env.DASHBOARD_SECRET = 'pod-scaling-test-secret-not-for-production'
const { default: router } = await import('../src/routes.js')
const { assertResourceAccess } = await import('../src/access.js')
const { registerCluster, unregisterCluster, KubeError } = await import('../src/kube.js')

const NS = 'team'
const POD = '/api/v1/namespaces/team/pods/web-pod'
const RS = '/apis/apps/v1/namespaces/team/replicasets/web-rs'
const DEPLOY = '/apis/apps/v1/namespaces/team/deployments/web'
const STS = '/apis/apps/v1/namespaces/team/statefulsets/db'
const ref = (kind, name, uid, apiVersion = 'apps/v1') => ({ apiVersion, kind, name, uid, controller: true, blockOwnerDeletion: true })
const object = (kind, name, uid, owners = [], replicas = 3) => ({
  apiVersion: kind === 'Pod' ? 'v1' : 'apps/v1', kind,
  metadata: { namespace: NS, name, uid, resourceVersion: '17', ownerReferences: owners },
  spec: kind === 'Pod' ? { containers: [{ name: 'web', image: 'nginx' }] } : { replicas },
  status: kind === 'Pod' ? { phase: 'Running' } : { replicas },
})
const account = { username: 'scaler', permissions: ['cluster:list', 'cluster:update'], scope: { clusters: ['test'], namespaces: [NS], resources: ['_core/pods', 'apps/replicasets', 'apps/deployments', 'apps/statefulsets'] } }
const input = { uid: 'pod-uid', controllerUid: 'deploy-uid', replicas: 5, expectedReplicas: 3 }
function fixture(mutate = () => {}, active = account) {
  const resources = new Map([
    [POD, object('Pod', 'web-pod', 'pod-uid', [ref('ReplicaSet', 'web-rs', 'rs-uid')])],
    [RS, object('ReplicaSet', 'web-rs', 'rs-uid', [ref('Deployment', 'web', 'deploy-uid')])],
    [DEPLOY, object('Deployment', 'web', 'deploy-uid')],
    [STS, object('StatefulSet', 'db', 'sts-uid')],
    [`${DEPLOY}/scale`, { apiVersion: 'autoscaling/v1', kind: 'Scale', metadata: { name: 'web', namespace: NS, uid: 'deploy-uid', resourceVersion: 'fresh-22' }, spec: { replicas: 3 }, status: { replicas: 3, selector: 'app=web' } }],
  ])
  mutate(resources)
  const calls = [], access = []
  const request = async (method, url, options) => {
    calls.push({ method, url, ...structuredClone(options) })
    const resource = resources.get(url.split('?')[0])
    if (!resource) throw new KubeError(404, 'fixture resource not found')
    return { status: 200, data: structuredClone(method === 'PUT' ? options.body : resource) }
  }
  const authorize = meta => {
    access.push(meta)
    return assertResourceAccess(active, { ...meta, clusterId: 'test' })
  }
  return { resources, calls, access, request, options: { authorize, uid: 'pod-uid' } }
}
async function service(f) {
  const { createPodScaling } = await import('../src/podScaling.js')
  return createPodScaling({ request: f.request })
}
async function invoke(method, pattern, request = {}) {
  const layer = router.stack.find(l => l.route?.path === pattern && l.route.methods[method.toLowerCase()])
  assert.ok(layer, `missing route ${method} ${pattern}`)
  return new Promise((resolve, reject) => {
    let i = 0
    const res = { code: 200, status(code) { this.code = code; return this }, json(body) { resolve({ status: this.code, body }); return this } }
    const next = error => {
      if (error) return reject(error)
      const handler = layer.route.stack[i++]?.handle
      if (!handler) return reject(new Error('route returned no response'))
      try { Promise.resolve(handler({ account, clusterId: 'test', params: { namespace: NS, name: 'web-pod' }, query: {}, body: {}, ...request }, res, next)).catch(reject) } catch (e) { reject(e) }
    }
    next()
  })
}

test('Pod scaling exposes read target and guarded update routes', () => {
  assert.ok(router.stack.some(l => l.route?.path === '/v1/pods/:namespace/:name/scale-target' && l.route.methods.get))
  assert.ok(router.stack.some(l => l.route?.path === '/v1/pods/:namespace/:name/scale' && l.route.methods.post))
})

test('Deployment-owned ReplicaSet resolves to its Deployment, ignoring non-controller references', async () => {
  const f = fixture(r => r.get(POD).metadata.ownerReferences.unshift({ ...ref('Job', 'other', 'other', 'batch/v1'), controller: false }))
  const result = await (await service(f)).resolveTarget(NS, 'web-pod', 'test', f.options)
  assert.deepEqual(result, { kind: 'Deployment', group: 'apps', version: 'v1', plural: 'deployments', namespace: NS, name: 'web', uid: 'deploy-uid', replicas: 3, resourceVersion: '17' })
  assert.deepEqual(f.calls.map(c => c.url), [POD, RS, DEPLOY])
  assert.ok(f.access.every(a => a.verb === 'get'))
})

test('standalone ReplicaSet and StatefulSet remain the scale target', async () => {
  for (const [kind, name, uid, plural] of [['ReplicaSet', 'web-rs', 'rs-uid', 'replicasets'], ['StatefulSet', 'db', 'sts-uid', 'statefulsets']]) {
    const f = fixture(r => {
      r.get(POD).metadata.ownerReferences = [ref(kind, name, uid)]
      r.get(RS).metadata.ownerReferences = []
    })
    const result = await (await service(f)).resolveTarget(NS, 'web-pod', 'test', f.options)
    assert.equal(result.kind, kind)
    assert.equal(result.uid, uid)
    assert.equal(result.plural, plural)
  }
})

test('unmanaged and unsupported controller types refuse instead of scaling the child', async () => {
  for (const owners of [[], [ref('DaemonSet', 'ds', 'uid')], [ref('Job', 'job', 'uid', 'batch/v1')], [ref('ReplicaSet', 'web-rs', 'rs-uid', 'extensions/v1beta1')], [ref('ReplicaSet', 'web-rs', 'rs-uid'), ref('StatefulSet', 'db', 'sts-uid')]]) {
    const f = fixture(r => { r.get(POD).metadata.ownerReferences = owners })
    await assert.rejects((await service(f)).resolveTarget(NS, 'web-pod', 'test', f.options), { status: 400 })
    assert.ok(f.calls.every(c => c.method === 'GET'))
  }
  const f = fixture(r => { r.get(RS).metadata.ownerReferences = [ref('CustomOwner', 'operator', 'uid', 'custom.io/v1')] })
  await assert.rejects((await service(f)).resolveTarget(NS, 'web-pod', 'test', f.options), { status: 400 })
})

test('selected Pod and every controller identity or deletion state is verified', async () => {
  for (const mutate of [
    r => { r.get(POD).metadata.uid = 'replacement' },
    r => { r.get(RS).metadata.uid = 'replacement' },
    r => { r.get(DEPLOY).metadata.uid = 'replacement' },
    r => { r.get(RS).metadata.name = 'other' },
    r => { r.get(DEPLOY).metadata.namespace = 'outside' },
    r => { r.get(DEPLOY).apiVersion = 'apps/v9' },
    ...[POD, RS, DEPLOY].map(path => r => { r.get(path).metadata.deletionTimestamp = '2026-11-12T00:00:00Z' }),
  ]) {
    const f = fixture(mutate)
    await assert.rejects((await service(f)).resolveTarget(NS, 'web-pod', 'test', f.options), { status: 409 })
    assert.ok(f.calls.every(c => c.method === 'GET'))
  }
})

test('path injection, malformed owner references and missing Pod UID never reach unsafe paths', async () => {
  for (const [namespace, name, uid] of [['..', 'web-pod', 'pod-uid'], ['_all', 'web-pod', 'pod-uid'], [NS, '../secrets', 'pod-uid'], [NS, 'web-pod', undefined]]) {
    const f = fixture()
    await assert.rejects((await service(f)).resolveTarget(namespace, name, 'test', { ...f.options, uid }), { status: 400 })
    assert.equal(f.calls.length, 0)
  }
  for (const patch of [{ name: '../secrets' }, { uid: '' }, { name: '' }]) {
    const f = fixture(r => Object.assign(r.get(POD).metadata.ownerReferences[0], patch))
    await assert.rejects((await service(f)).resolveTarget(NS, 'web-pod', 'test', f.options), { status: 400 })
    assert.deepEqual(f.calls.map(c => c.url), [POD])
  }
})

test('namespace and actual controller scope denials prevent upstream writes', async () => {
  for (const scope of [{ ...account.scope, namespaces: ['outside'] }, { ...account.scope, resources: ['_core/pods', 'apps/replicasets'] }]) {
    const f = fixture(undefined, { ...account, scope })
    await assert.rejects((await service(f)).scalePod(NS, 'web-pod', 'test', { ...f.options, ...input }), { status: 403 })
    assert.ok(f.calls.every(c => c.method === 'GET'))
    if (scope.namespaces[0] === 'outside') assert.equal(f.calls.length, 0)
    else assert.ok(!f.calls.some(c => c.url.startsWith(DEPLOY)))
  }
})

test('read-only controller permission and revocation before PUT never write upstream', async () => {
  const readOnly = fixture(undefined, { ...account, permissions: ['cluster:list'] })
  await assert.rejects((await service(readOnly)).scalePod(NS, 'web-pod', 'test', { ...readOnly.options, ...input }), { status: 403 })
  assert.ok(readOnly.calls.every(c => c.method === 'GET'))

  const f = fixture()
  let updateChecks = 0
  const authorize = meta => {
    f.options.authorize(meta)
    if (meta.verb === 'update' && ++updateChecks === 2) throw Object.assign(new Error('permission revoked'), { status: 403 })
  }
  await assert.rejects((await service(f)).scalePod(NS, 'web-pod', 'test', { ...f.options, ...input, authorize }), { status: 403 })
  assert.ok(f.calls.every(c => c.method === 'GET'))
})

test('replica values and missing controller identity fail before requests', async () => {
  for (const patch of [
    ...[-1, 1000, 1.5, '5', null, true, undefined].map(replicas => ({ replicas })),
    ...[-1, 1000, 1.5, '3', undefined].map(expectedReplicas => ({ expectedReplicas })),
    { controllerUid: '' }, { controllerUid: undefined }, { dryRun: 'true' },
  ]) {
    const f = fixture()
    await assert.rejects((await service(f)).scalePod(NS, 'web-pod', 'test', { ...f.options, ...input, ...patch }), { status: 400 })
    assert.equal(f.calls.length, 0)
  }
})

test('changed target UID and expected replica conflicts stop before PUT', async () => {
  for (const patch of [{ controllerUid: 'old-controller' }, { expectedReplicas: 2 }]) {
    const f = fixture()
    await assert.rejects((await service(f)).scalePod(NS, 'web-pod', 'test', { ...f.options, ...input, ...patch }), { status: 409 })
    assert.ok(f.calls.every(c => c.method === 'GET'))
  }
  for (const mutate of [
    r => { r.get(`${DEPLOY}/scale`).metadata.uid = 'replacement' },
    r => { r.get(`${DEPLOY}/scale`).spec.replicas = 4 },
    r => { delete r.get(`${DEPLOY}/scale`).metadata.resourceVersion },
  ]) {
    const f = fixture(mutate)
    await assert.rejects((await service(f)).scalePod(NS, 'web-pod', 'test', { ...f.options, ...input }), error => [409, 502].includes(error.status))
    assert.ok(f.calls.every(c => c.method === 'GET'))
  }
})

test('scale PUT uses the fresh Scale UID/resourceVersion and never updates Pods or child ReplicaSets', async () => {
  for (const replicas of [0, 5, 999]) {
    const f = fixture()
    const result = await (await service(f)).scalePod(NS, 'web-pod', 'test', { ...f.options, ...input, replicas })
    assert.equal(result.ok, true)
    assert.equal(result.replicas, replicas)
    const writes = f.calls.filter(c => c.method !== 'GET')
    assert.equal(writes.length, 1)
    assert.equal(writes[0].method, 'PUT')
    assert.equal(writes[0].url, `${DEPLOY}/scale`)
    assert.deepEqual(writes[0].body, { apiVersion: 'autoscaling/v1', kind: 'Scale', metadata: { name: 'web', namespace: NS, uid: 'deploy-uid', resourceVersion: 'fresh-22' }, spec: { replicas } })
    assert.ok(f.access.some(a => a.plural === 'deployments' && a.verb === 'update'))
    assert.ok(!f.access.some(a => a.plural === 'pods' && a.verb !== 'get'))
  }
})

test('server dry-run reaches only the target Scale PUT with dryRun=All', async () => {
  const f = fixture()
  const result = await (await service(f)).scalePod(NS, 'web-pod', 'test', { ...f.options, ...input, dryRun: true })
  assert.equal(result.dryRun, true)
  assert.equal(f.calls.at(-1).url, `${DEPLOY}/scale?dryRun=All`)
  assert.ok(f.calls.slice(0, -1).every(c => c.method === 'GET' && !c.url.includes('?')))
})

test('owner change during Scale GET is re-resolved before mutation', async () => {
  const f = fixture()
  const transport = f.request
  f.request = async (...args) => {
    const response = await transport(...args)
    if (args[0] === 'GET' && args[1] === `${DEPLOY}/scale`) f.resources.get(POD).metadata.ownerReferences = [ref('StatefulSet', 'db', 'sts-uid')]
    return response
  }
  await assert.rejects((await service(f)).scalePod(NS, 'web-pod', 'test', { ...f.options, ...input }), { status: 409 })
  assert.ok(f.calls.every(c => c.method === 'GET'))
})

test('Scale API conflict is surfaced once without retrying a stale write', async () => {
  const f = fixture()
  const transport = f.request
  let writes = 0
  f.request = async (...args) => {
    if (args[0] === 'PUT') {
      writes++
      throw new KubeError(409, 'resourceVersion changed')
    }
    return transport(...args)
  }
  await assert.rejects((await service(f)).scalePod(NS, 'web-pod', 'test', { ...f.options, ...input }), { status: 409 })
  assert.equal(writes, 1)
})

test('standalone ReplicaSet and StatefulSet PUT the correct Scale subresource', async () => {
  for (const [kind, name, uid, path] of [['ReplicaSet', 'web-rs', 'rs-uid', RS], ['StatefulSet', 'db', 'sts-uid', STS]]) {
    const f = fixture(r => {
      r.get(POD).metadata.ownerReferences = [ref(kind, name, uid)]
      r.get(RS).metadata.ownerReferences = []
      r.set(`${path}/scale`, { apiVersion: 'autoscaling/v1', kind: 'Scale', metadata: { name, namespace: NS, uid, resourceVersion: 'fresh-25' }, spec: { replicas: 3 }, status: { replicas: 3 } })
    })
    const result = await (await service(f)).scalePod(NS, 'web-pod', 'test', { ...f.options, ...input, controllerUid: uid })
    assert.equal(result.target.kind, kind)
    assert.equal(f.calls.at(-1).url, `${path}/scale`)
    assert.equal(f.calls.at(-1).body.metadata.uid, uid)
  }
})

test('GET and POST routes preserve controller scopes and POST requires cluster:update', async () => {
  const denied = await invoke('POST', '/v1/pods/:namespace/:name/scale', { account: { ...account, permissions: ['cluster:list'] }, body: input })
  assert.equal(denied.status, 403)
  const f = fixture()
  registerCluster({ id: 'test', request: f.request, kc: { getCurrentCluster: () => ({ server: 'http://fixture.invalid' }), getCurrentContext: () => 'test', getCurrentUser: () => ({}), getClusters: () => [], getUsers: () => [] } })
  try {
    const read = await invoke('GET', '/v1/pods/:namespace/:name/scale-target', { query: { uid: 'pod-uid' } })
    assert.equal(read.body.kind, 'Deployment')
    assert.equal(read.body.uid, 'deploy-uid')
    const write = await invoke('POST', '/v1/pods/:namespace/:name/scale', { body: { ...input, dryRun: true } })
    assert.equal(write.body.ok, true)
    assert.equal(f.calls.at(-1).url, `${DEPLOY}/scale?dryRun=All`)
  } finally { unregisterCluster('test') }
})
