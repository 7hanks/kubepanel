import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kubepanel-operations-'))
process.env.DASHBOARD_SECRET = 'operations-test-secret-not-for-production'
const kube = await import('../src/kube.js')
const { applyYaml, overview } = await import('../src/actions.js')

async function fixture(handler, run) {
  const id = `test-${Math.random()}`
  kube.registerCluster({ id, request: async (method, url, options) => {
    const reply = await handler({ method, url }, options.body)
    const status = reply?.status || 200
    if (status >= 400) throw new kube.KubeError(status, reply.data?.message || 'failed')
    return { status, data: reply?.data ?? reply ?? {} }
  }, kc: {
    getCurrentCluster: () => ({ server: 'http://fixture.invalid' }),
    getCurrentContext: () => 'test', getCurrentUser: () => ({}),
    getClusters: () => [], getUsers: () => [], applyToHTTPSOptions: async () => {},
  } })
  try { await run(id) } finally { kube.unregisterCluster(id) }
}
const discovery = req => req.url === '/apis' ? { groups: [{ name: 'apps', preferredVersion: { version: 'v1' }, versions: [{ version: 'v1' }] }] }
  : req.url === '/apis/apps/v1' ? { resources: [{ name: 'deployments', kind: 'Deployment', namespaced: true, verbs: ['get', 'list', 'create', 'patch'] }] }
    : req.url === '/api/v1' ? { resources: [{ name: 'pods', kind: 'Pod', namespaced: true, verbs: ['get', 'list', 'create', 'patch'] }] } : null

test('apply defaults to non-force, sends server dry-run, and preserves partial failure', async () => {
  const changes = []
  await fixture((req, body) => {
    if (req.method === 'PATCH') { changes.push(req.url); return req.url.includes('/bad?') ? { status: 409, data: { message: 'conflict' } } : { data: { metadata: { name: 'good' } } } }
    return discovery(req)
  }, async id => {
    const result = await applyYaml('apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: good\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: bad', 'team', id, { dryRun: true })
    assert.equal(result.ok, false)
    assert.equal(result.dryRun, true)
    assert.equal(result.results[1].ok, false)
    assert.equal(changes.length, 2)
    assert.ok(changes.every(url => url.includes('dryRun=All') && !url.includes('force=true')))
  })
})

test('findResource never substitutes another apiVersion', async () => {
  await fixture(discovery, async id => assert.equal(await kube.findResource('apps/v9', 'Deployment', id), null))
  await assert.rejects(kube.findResource('apps/v1/surprise', 'Deployment', 'unused'), /apiVersion/)
})

test('API paths cannot smuggle a subresource or another route in GVR', () => {
  assert.throws(() => kube.apiPath({ group: 'apps', version: 'v1', plural: 'pods/log' }), /资源路径|resource/i)
  assert.throws(() => kube.apiPath({ plural: 'pods', namespace: '..' }), /资源路径/)
  assert.throws(() => kube.apiPath({ plural: 'pods', name: '../secrets' }), /资源路径/)
})

test('failed version discovery propagates permission errors instead of implying resource is absent', async () => {
  await fixture(req => req.url === '/apis/apps/v1' ? { status: 403, data: { message: 'discovery forbidden' } } : discovery(req), async id => {
    await assert.rejects(kube.findResource('apps/v1', 'Deployment', id), e => e.status === 403)
    assert.equal(kube.discoveryErrors(id)[0].status, 403)
  })
})

test('overview reports failures separately from zero and terminal pod history from active failures', async () => {
  await fixture(req => {
    if (discovery(req)) return discovery(req)
    if (req.url === '/api/v1/nodes') return { items: [{ metadata: { name: 'node1' }, spec: { taints: [{ key: 'disk' }] }, status: { allocatable: { pods: '10', cpu: '2' }, conditions: [{ type: 'Ready', status: 'True' }, { type: 'DiskPressure', status: 'True' }] } }] }
    if (req.url === '/api/v1/pods') return { items: [{ metadata: { name: 'old' }, spec: { nodeName: 'node1' }, status: { phase: 'Failed' } }, { metadata: { name: 'running' }, spec: { nodeName: 'node1' }, status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'False' }] } }] }
    if (req.url.includes('/deployments')) return { status: 403, data: { message: 'denied' } }
    return { items: [] }
  }, async id => {
    const result = await overview(id)
    assert.equal(result.stat.deployments, null)
    assert.equal(result.errors.deployments.status, 403, JSON.stringify(result.errors))
    assert.equal(result.stat.unhealthyPods, 1)
    assert.equal(result.stat.failedPods, 1)
    assert.equal(result.nodes[0].pods, 1)
    assert.equal(result.nodes[0].allocatable.pods, '10')
    assert.equal(result.nodes[0].diskPressure, true)
    assert.equal(result.nodeUsage.available, false)
    assert.equal(result.nodeUsage.reason, 'incomplete-metrics')
    assert.equal(result.nodes[0].cpu, null)
    assert.equal(result.metricsAvailable, false)
  })
})

test('overview exposes cluster node utilization and keeps an incomplete sample unavailable', async () => {
  let missing = false
  await fixture(req => {
    if (discovery(req)) return discovery(req)
    if (req.url === '/api/v1/nodes') return { items: ['a', 'b'].map(name => ({ metadata: { name }, status: { allocatable: { cpu: '2', memory: '4Gi' }, capacity: { cpu: '8', memory: '16Gi' } } })) }
    if (req.url === '/apis/metrics.k8s.io/v1beta1/nodes') return { items: (missing ? ['a'] : ['a', 'b']).map(name => ({ metadata: { name }, usage: { cpu: '500m', memory: '1Gi' } })) }
    return { items: [] }
  }, async id => {
    const complete = await overview(id)
    assert.equal(complete.nodeUsage.available, true)
    assert.equal(complete.nodeUsage.cpu.percent, 25)
    assert.equal(complete.nodeUsage.memory.percent, 25)
    assert.equal(complete.metricsAvailable, true)
    missing = true
    const incomplete = await overview(id)
    assert.equal(incomplete.nodeUsage.available, false)
    assert.equal(incomplete.nodeUsage.cpu, null)
    assert.equal(incomplete.errors.nodeMetrics.status, 206)
    assert.equal(incomplete.partial, true)
  })
})

test('kubeconfig text refuses executable and file-based credential sources before SDK loading', async () => {
  const { validateKubeconfigText } = await import('../src/kube.js')
  const base = user => `apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: https://example.invalid\ncontexts:\n- name: c\n  context: {cluster: c, user: u}\ncurrent-context: c\nusers:\n- name: u\n  user:\n${user}\n`
  for (const user of ['    exec: {command: whoami}', '    auth-provider: {name: gcp}', '    client-key: /tmp/key', '    tokenFile: /tmp/token']) {
    assert.throws(() => validateKubeconfigText(base(user)), /不允许|禁止/)
  }
  assert.doesNotThrow(() => validateKubeconfigText(base('    client-certificate-data: Y2VydA==\n    client-key-data: a2V5')))
  assert.throws(() => validateKubeconfigText(base('    token: test').replace('https://example.invalid', 'file:///tmp/x')), /http/)
  assert.throws(() => validateKubeconfigText(base('    token: test').replace('server: https://example.invalid', 'server: https://example.invalid\n    proxy-url: http://example.invalid')), /不允许|禁止/)
})
