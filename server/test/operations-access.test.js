import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kubepanel-boundaries-'))
process.env.DASHBOARD_SECRET = 'boundary-test-secret-not-for-production'
const { registerCluster, unregisterCluster } = await import('../src/kube.js')
const { scopedList } = await import('../src/resourceScope.js')
const { overview, applyYaml } = await import('../src/actions.js')
const { assertResourceAccess } = await import('../src/access.js')
const { default: router } = await import('../src/routes.js')
const account = { username: 'reader', permissions: ['cluster:list', 'cluster:detail', 'cluster:create', 'cluster:update'], scope: { clusters: ['test'], namespaces: ['team'], resources: ['*'] } }
const podMeta = { group: '', version: 'v1', plural: 'pods', namespaced: true }
async function fixture(handler, run) {
  const calls = []
  registerCluster({ id: 'test', request: async (method, url, options) => { calls.push({ method, url, ...options }); return { data: await handler(method, url, options) } }, kc: {
    getCurrentCluster: () => ({ server: 'https://fixture.invalid' }), getClusters: () => [], getUsers: () => [], getCurrentUser: () => ({}), getCurrentContext: () => 'test',
  } })
  try { await run(calls) } finally { unregisterCluster('test') }
}
async function route(method, pattern, req) {
  const layer = router.stack.find(l => l.route?.path === pattern && l.route.methods[method.toLowerCase()])
  assert.ok(layer, pattern)
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(n) { this.statusCode = n; return this }, json(body) { resolve({ status: this.statusCode, body }); return this } }
    let i = 0
    const next = error => {
      if (error) { reject(error); return }
      const fn = layer.route.stack[i++]?.handle
      if (!fn) return reject(new Error('no response'))
      try { Promise.resolve(fn(req, res, next)).catch(reject) } catch (e) { reject(e) }
    }
    next()
  })
}
const request = patch => ({ account, clusterId: 'test', params: {}, query: {}, body: {}, ...patch })

test('namespace aggregation makes only authorized namespace upstream requests and refuses explicit escape', async () => {
  await fixture(async () => ({ items: [{ metadata: { namespace: 'team', name: 'p' } }] }), async calls => {
    const result = await scopedList(account, podMeta, { clusterId: 'test' })
    assert.equal(result.items.length, 1)
    assert.equal(calls[0].url, '/api/v1/namespaces/team/pods')
    await assert.rejects(scopedList(account, podMeta, { clusterId: 'test', namespace: 'outside' }), e => e.status === 403)
    assert.equal(calls.length, 1)
    await assert.rejects(scopedList(account, { ...podMeta, plural: 'secrets' }, { clusterId: 'test' }), e => e.status === 403)
    await assert.rejects(scopedList(account, { ...podMeta, plural: 'nodes', namespaced: false }, { clusterId: 'test' }), e => e.status === 403)
  })
})

test('overview scope guards cluster nodes and only queries allowed namespaces', async () => {
  await fixture(async () => ({ items: [], resources: [], groups: [] }), async calls => {
    const result = await overview('test', undefined, account)
    assert.equal(result.stat.nodes, null)
    assert.equal(result.errors.nodes.status, 403)
    assert.ok(!calls.some(c => c.url === '/api/v1/pods' || c.url === '/api/v1/nodes' || c.url === '/api/v1/namespaces'))
  })
})

test('apply namespace and RBAC scope failures never mutate upstream', async () => {
  await fixture(async (method, url) => url === '/apis' ? { groups: [] } : { resources: [{ name: 'pods', kind: 'Pod', namespaced: true, verbs: ['patch'] }] }, async calls => {
    const result = await applyYaml('apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\n  namespace: outside', 'team', 'test', { authorize: meta => assertResourceAccess(account, { ...meta, clusterId: 'test' }) })
    assert.equal(result.ok, false)
    assert.ok(!calls.some(c => c.method !== 'GET'))
  })
})

test('Apply requires both create/update; forced apply requires separate elevated permission', async () => {
  for (const permissions of [['cluster:create'], ['cluster:update']]) {
    const result = await route('POST', '/v1/apply', request({ account: { ...account, permissions }, body: { yaml: 'test' } }))
    assert.equal(result.status, 403)
  }
  await assert.rejects(route('POST', '/v1/apply', request({ body: { yaml: 'test', force: true } })), e => e.status === 403)
})

test('resource create is POST with server dry-run, validates body and resource scope', async () => {
  await fixture(async (method, url, options) => url === '/apis' ? { groups: [] } : url === '/api/v1' ? { resources: [{ name: 'pods', kind: 'Pod', namespaced: true, verbs: ['create'] }] } : options.body, async calls => {
    const result = await route('POST', '/v1/resources/:group/:version/:plural', request({ params: { group: '_core', version: 'v1', plural: 'pods' }, query: { namespace: 'team', dryRun: 'true' }, body: { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'p', namespace: 'team' } } }))
    assert.equal(result.status, 201)
    assert.equal(calls.at(-1).method, 'POST')
    assert.match(calls.at(-1).url, /namespaces\/team\/pods\?dryRun=All/)
    await assert.rejects(route('POST', '/v1/resources/:group/:version/:plural', request({ params: { group: '_core', version: 'v1', plural: 'pods' }, query: { namespace: 'outside' }, body: { metadata: { name: 'p' } } })), e => e.status === 403)
  })
})

test('Secret mutation responses never disclose values without secret:read', async () => {
  await fixture(async (method, url) => url === '/apis' ? { groups: [] } : url === '/api/v1' ? { resources: [{ name: 'secrets', kind: 'Secret', namespaced: true, verbs: ['create'] }] }
    : { apiVersion: 'v1', kind: 'Secret', metadata: { name: 's', namespace: 'team', annotations: { 'kubectl.kubernetes.io/last-applied-configuration': 'sensitive' } }, data: { generated: 'sensitive' } }, async () => {
    const result = await route('POST', '/v1/resources/:group/:version/:plural', request({ params: { group: '_core', version: 'v1', plural: 'secrets' }, query: { namespace: 'team' }, body: { apiVersion: 'v1', kind: 'Secret', metadata: { name: 's', namespace: 'team' } } }))
    assert.equal(result.status, 201)
    assert.equal(result.body.data, undefined)
    assert.equal(result.body.metadata.annotations, undefined)
    assert.equal(result.body.redacted, true)
  })
})
