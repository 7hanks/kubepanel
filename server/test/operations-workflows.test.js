import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kubepanel-workflows-'))
process.env.DASHBOARD_SECRET = 'workflow-test-secret-not-for-production'
const { createOperations } = await import('../src/operations.js')
const pod = (extra = {}) => ({ metadata: { name: 'web', namespace: 'team', uid: 'pod-uid', ownerReferences: [{ apiVersion: 'apps/v1', kind: 'ReplicaSet', name: 'web-rs', uid: 'rs-uid', controller: true }] }, spec: { nodeName: 'worker', ...extra }, status: { phase: 'Running' } })

test('pod restart verifies real controller and sends Eviction with UID and API dry-run', async () => {
  const writes = []
  const service = createOperations({ request: async (method, url, options) => {
    if (method !== 'GET') { writes.push({ method, url, ...options }); return { data: {} } }
    return { data: url.includes('/replicasets/') ? { metadata: { uid: 'rs-uid' } } : pod() }
  } })
  const result = await service.restartPod('team', 'web', 'c', { dryRun: true })
  assert.equal(result.ok, true)
  assert.equal(writes[0].method, 'POST')
  assert.match(writes[0].url, /\/eviction\?dryRun=All$/)
  assert.equal(writes[0].body.deleteOptions.preconditions.uid, 'pod-uid')
  assert.doesNotMatch(result.message, /自动重建|guaranteed/i)
})

test('restart rejects a noncontroller reference and a stale owner UID without any mutation', async () => {
  for (const stale of [false, true]) {
    let writes = 0
    const service = createOperations({ request: async (method, url) => {
      if (method !== 'GET') writes++
      const p = pod(); if (!stale) p.metadata.ownerReferences[0].controller = false
      return { data: url.includes('/replicasets/') ? { metadata: { uid: 'wrong' } } : p }
    } })
    await assert.rejects(service.restartPod('team', 'web', 'c'), /控制器|UID/)
    assert.equal(writes, 0)
  }
})

test('restart refuses a replaced selected Pod UID before controller lookup or mutation',async()=>{
  const calls=[]
  const service=createOperations({request:async(method,url)=>{calls.push({method,url});return {data:pod()}}})
  for(const dryRun of [true,false])await assert.rejects(service.restartPod('team','web','c',{dryRun,uid:'old-selection'}),{status:409})
  assert.equal(calls.length,2)
  assert.ok(calls.every(call=>call.method==='GET'&&call.url.endsWith('/pods/web')))
})

test('restart rejects malformed identity and static mirror Pods even with a supported owner',async()=>{
  const calls=[]
  const service=createOperations({request:async(method,url)=>{calls.push({method,url});const item=pod();item.metadata.annotations={'kubernetes.io/config.mirror':'mirror-hash'};return {data:item}}})
  for(const uid of ['',null,{},'bad\nidentity'])await assert.rejects(service.restartPod('team','web','c',{uid}),{status:400})
  assert.equal(calls.length,0)
  await assert.rejects(service.restartPod('team','web','c',{uid:'pod-uid',dryRun:true}),/静态|镜像/)
  assert.equal(calls.length,1)
})

test('drain refuses unmanaged or local-storage pods before cordoning', async () => {
  let writes = 0
  const p = pod({ volumes: [{ emptyDir: {}, name: 'cache' }] }); delete p.metadata.ownerReferences
  const service = createOperations({ request: async (method, url) => {
    if (method !== 'GET') writes++
    return { data: url.includes('/nodes/') ? { metadata: { name: 'worker', uid: 'n', resourceVersion: '1' } } : { items: [p] } }
  } })
  const result = await service.drainNode('worker', 'c', { dryRun: true })
  assert.equal(result.ok, false)
  assert.equal(result.blockers.length, 2)
  assert.equal(writes, 0)
})

test('drain dry-run cordons with server dry-run and PDB denial stays failure without DELETE fallback', async () => {
  const calls = []
  let evictionCalls = 0
  const service = createOperations({ request: async (method, url, options) => {
    calls.push({ method, url, ...options })
    if (method === 'GET' && url.includes('/replicasets/')) return { data: { metadata: { uid: 'rs-uid' } } }
    if (url.includes('/eviction') && ++evictionCalls > 1) throw Object.assign(new Error('PDB prevents disruption'), { status: 429 })
    return { data: url.includes('/nodes/') ? { metadata: { name: 'worker', uid: 'n', resourceVersion: '1' } } : { items: [pod()] } }
  } })
  const result = await service.drainNode('worker', 'c', { dryRun: true })
  assert.equal(result.ok, false)
  assert.match(calls.find(x => x.method === 'PATCH').url, /dryRun=All/)
  assert.equal(result.results[0].status, 429)
  assert.ok(!calls.some(x => x.method === 'DELETE'))
})

test('drain GET preflight detects current PDB blockers using API dry-run without cordoning', async () => {
  const calls = []
  const service = createOperations({ request: async (method, url, options) => {
    calls.push({ method, url, ...options })
    if (method === 'GET' && url.includes('/replicasets/')) return { data: { metadata: { uid: 'rs-uid' } } }
    if (url.includes('/eviction')) throw Object.assign(new Error('PDB blocks'), { status: 429 })
    return { data: url.includes('/nodes/') ? { metadata: { name: 'worker', uid: 'n', resourceVersion: '1' } } : { items: [pod()] } }
  } })
  const result = await service.nodeDrainPreflight('worker', 'c')
  assert.equal(result.canDrain, false)
  assert.match(result.blockers[0].message, /PDB/)
  assert.match(calls.at(-1).url, /eviction\?dryRun=All$/)
  assert.ok(!calls.some(x => x.method === 'PATCH'))
})

for (const state of ['missing', 'replaced', 'deleting', 'unsupported']) {
  test(`drain preflight blocks ${state} controllers before any Eviction or cordon`, async () => {
    const calls = []
    const item = pod()
    if (state === 'unsupported') item.metadata.ownerReferences[0].kind = 'UnknownController'
    const service = createOperations({ request: async (method, url, options) => {
      calls.push({ method, url, ...options })
      if (url.includes('/replicasets/')) {
        if (state === 'missing') throw Object.assign(new Error('controller not found'), { status: 404 })
        return { data: { metadata: { uid: state === 'replaced' ? 'different-uid' : 'rs-uid', ...(state === 'deleting' ? { deletionTimestamp: '2026-11-09T00:00:00Z' } : {}) } } }
      }
      return { data: url.includes('/nodes/') ? { metadata: { name: 'worker', resourceVersion: '1' } } : { items: [item] } }
    } })
    const result = await service.nodeDrainPreflight('worker', 'c')
    assert.equal(result.canDrain, false)
    assert.ok(result.blockers.length > 0)
    assert.ok(calls.every(call => call.method === 'GET'))
    const drain = await service.drainNode('worker', 'c', { dryRun: false })
    assert.equal(drain.ok, false)
    assert.equal(drain.cordoned, false)
    assert.ok(calls.every(call => call.method === 'GET'))
  })
}

test('drain verifies live controller through authorized namespace path within its shared deadline', async () => {
  const calls = [], authorized = []
  const service = createOperations({ now: () => 1000, request: async (method, url, options) => {
    calls.push({ method, url, ...options })
    if (url.includes('/replicasets/')) return { data: { metadata: { uid: 'rs-uid' } } }
    return { data: url.includes('/nodes/') ? { metadata: { name: 'worker', resourceVersion: '1' } } : { items: [pod()] } }
  } })
  const result = await service.nodeDrainPreflight('worker', 'c', { deadline: 2500, authorize: target => authorized.push(target) })
  assert.equal(result.canDrain, true)
  const controller = calls.find(call => call.url.includes('/replicasets/'))
  assert.equal(controller?.url, '/apis/apps/v1/namespaces/team/replicasets/web-rs')
  assert.equal(controller?.timeout, 1500)
  assert.ok(authorized.some(target => target.group === 'apps' && target.plural === 'replicasets' && target.namespace === 'team' && target.verb === 'get'))
})

test('drain rechecks controller before actual eviction if it disappears after preflight', async () => {
  let cordoned = false
  const calls = []
  const service = createOperations({ request: async (method, url, options) => {
    calls.push({ method, url, ...options })
    if (url.includes('/replicasets/')) {
      if (cordoned) throw Object.assign(new Error('controller disappeared'), { status: 404 })
      return { data: { metadata: { uid: 'rs-uid' } } }
    }
    if (method === 'PATCH') cordoned = true
    return { data: url.includes('/nodes/') ? { metadata: { name: 'worker', resourceVersion: '1' } } : { items: [pod()] } }
  } })
  const result = await service.drainNode('worker', 'c')
  assert.equal(result.ok, false)
  assert.equal(result.cordoned, true)
  assert.equal(result.results[0].status, 404)
  assert.ok(calls.filter(call => call.method === 'POST').every(call => call.url.endsWith('dryRun=All')))
})

test('drain preserves DaemonSet and mirror exemptions without fetching or evicting their controllers', async () => {
  const daemon = pod(), mirror = pod()
  daemon.metadata.ownerReferences[0].kind = 'DaemonSet'
  mirror.metadata.annotations = { 'kubernetes.io/config.mirror': 'mirror-hash' }
  delete mirror.metadata.ownerReferences
  const calls = []
  const service = createOperations({ request: async (method, url) => {
    calls.push({ method, url })
    return { data: url.includes('/nodes/') ? { metadata: { name: 'worker', resourceVersion: '1' } } : { items: [daemon, mirror] } }
  } })
  const result = await service.nodeDrainPreflight('worker', 'c')
  assert.equal(result.canDrain, true)
  assert.ok(result.pods.every(item => item.exempt))
  assert.equal(calls.length, 2)
  assert.ok(calls.every(call => call.method === 'GET'))
})

test('drain stops mutations after its shared deadline and reports an incomplete result', async () => {
  let clock = 0
  const writes = []
  const service = createOperations({ now: () => clock, request: async (method, url, options) => {
    if (method !== 'GET') writes.push({ method, url })
    if (method === 'GET' && url.includes('/replicasets/')) return { data: { metadata: { uid: 'rs-uid' } } }
    if (method === 'PATCH') clock = 1001
    return { data: url.includes('/nodes/') ? { metadata: { name: 'worker', resourceVersion: '1' } } : { items: [pod()] } }
  } })
  const result = await service.drainNode('worker', 'c', { timeoutSeconds: 1 })
  assert.equal(result.ok, false)
  assert.equal(result.results[0].status, 408)
  assert.ok(writes.filter(x => x.method === 'POST').every(x => x.url.endsWith('dryRun=All')))
})

test('drain never claims completion if a new nonexempt Pod is present at final verification', async () => {
  let lists = 0
  const service = createOperations({ request: async (method, url) => {
    if (method === 'GET' && url.includes('/replicasets/')) return { data: { metadata: { uid: 'rs-uid' } } }
    if (method === 'GET' && url.includes('/nodes/')) return { data: { metadata: { name: 'worker', resourceVersion: '1' } } }
    if (method === 'GET' && url.includes('/pods?')) {
      const item = pod(); if (++lists > 1) { item.metadata.uid = 'new-uid'; item.metadata.name = 'new-pod' }
      return { data: { items: [item] } }
    }
    if (method === 'GET') throw Object.assign(new Error('gone'), { status: 404 })
    return { data: {} }
  } })
  const result = await service.drainNode('worker', 'c')
  assert.equal(result.ok, false)
  assert.equal(result.results.at(-1).name, 'new-pod')
  assert.equal(result.results.at(-1).status, 409)
})

test('history excludes ReplicaSets owned by another Deployment and rollback uses optimistic preconditions', async () => {
  const writes = []
  const rs = owner => ({ metadata: { name: 'rs', ownerReferences: [{ controller: true, uid: owner, kind: 'Deployment' }], annotations: { 'deployment.kubernetes.io/revision': '2' } }, spec: { template: { metadata: { labels: { 'pod-template-hash': 'hash', app: 'web' } }, spec: { containers: [{ name: 'web', image: 'old' }] } } } })
  const service = createOperations({ request: async (method, url, options) => {
    if (method === 'PATCH') { writes.push({ url, ...options }); return { data: {} } }
    return { data: url.endsWith('/replicasets') ? { items: [rs('other'), rs('dep')] } : { metadata: { uid: 'dep', resourceVersion: '23' } } }
  } })
  assert.equal((await service.workloadHistory('team', 'web', 'Deployment', 'c')).items.length, 1)
  await service.rollbackWorkload('team', 'web', 'Deployment', 2, 'c', { dryRun: true })
  assert.equal(writes[0].body[1].value, '23')
  assert.equal(writes[0].body[2].value.metadata.labels['pod-template-hash'], undefined)
  assert.match(writes[0].url, /dryRun=All/)
})

test('CronJob manual run is a real Job POST and suspend requires a boolean', async () => {
  const calls = []
  const service = createOperations({ request: async (method, url, options) => {
    calls.push({ method, url, ...options })
    return { data: method === 'GET' ? { metadata: { resourceVersion: '1' }, spec: { jobTemplate: { spec: { template: { spec: { containers: [{ name: 'job', image: 'image' }], restartPolicy: 'Never' } } } } } } : { metadata: { name: 'manual-job' } } }
  } })
  const result = await service.runCronJob('team', 'backup', 'c', { dryRun: true })
  assert.equal(result.job.metadata.name, 'manual-job')
  assert.match(calls[1].url, /\/jobs\?dryRun=All/)
  assert.equal(calls[1].body.kind, 'Job')
  await assert.rejects(service.suspendCronJob('team', 'backup', 'false', 'c'), /boolean|布尔/)
})
