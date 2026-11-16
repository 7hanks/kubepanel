import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kubepanel-monitor-discovery-'))
process.env.DATA_DIR = dataDir
process.env.DASHBOARD_SECRET = 'monitor-discovery-fixture-secret-only'
const monitor = await import('../src/monitorService.js')
const { registerCluster, unregisterCluster } = await import('../src/kube.js')
const { default: router } = await import('../src/routes.js')
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

const account = { permissions: ['monitor:create', 'cluster:list'], scope: { clusters: ['test'], namespaces: ['team'], resources: ['_core/services', 'networking.k8s.io/ingresses'] } }
const service = (name, spec = {}, labels = {}) => ({ metadata: { name, namespace: 'team', labels }, spec: { type: 'ClusterIP', ports: [{ name: 'http-web', port: 80, targetPort: 3000 }], ...spec } })
async function fixture(handler, run, server = 'https://203.0.113.10:6443', entry = {}) {
  const calls = []
  registerCluster({ ...entry, id: 'test', request: async (method, url, options) => { calls.push({ method, url }); return { data: await handler(url, options) } }, kc: {
    getCurrentCluster: () => ({ server }), getClusters: () => [], getUsers: () => [], getCurrentUser: () => ({}), getCurrentContext: () => 'test',
  } })
  try { await run(calls) } finally { unregisterCluster('test') }
}
async function route(req) {
  const layer = router.stack.find(l => l.route?.path === '/v1/monitor/discover' && l.route.methods.post)
  assert.ok(layer, 'monitor discovery route is registered')
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(n) { this.statusCode = n; return this }, json(body) { resolve({ status: this.statusCode, body }) } }
    let index = 0
    const next = error => {
      if (error) return reject(error)
      const fn = layer.route.stack[index++]?.handle
      if (!fn) return reject(new Error('route did not respond'))
      try { Promise.resolve(fn({ account, body: {}, query: {}, ...req }, res, next)).catch(reject) } catch (e) { reject(e) }
    }
    next()
  })
}

test('Grafana discovery identifies labels and names while ClusterIP never becomes a browser URL', async () => {
  assert.equal(typeof monitor.discoverGrafanas, 'function')
  await fixture(async url => ({ items: url.endsWith('/services') ? [
    service('dashboards', { type: 'NodePort', ports: [{ port: 80, targetPort: 3000, nodePort: 32000 }] }, { 'app.kubernetes.io/name': 'grafana' }),
    service('team-grafana'), service('prometheus', { ports: [{ port: 9090 }] }), service('grafana-renderer', { ports: [{ port: 8081 }] }),
  ] : [] }), async calls => {
    const result = await monitor.discoverGrafanas('test', '', { account })
    assert.equal(result.items.length, 2)
    assert.equal(result.items.find(x => x.service === 'dashboards').url, 'http://203.0.113.10:32000')
    const internal = result.items.find(x => x.service === 'team-grafana')
    assert.equal(internal.url, '')
    assert.match(internal.hint, /ClusterIP|集群内/)
    assert.deepEqual(calls.map(x => x.url).sort(), ['/api/v1/namespaces/team/services', '/apis/networking.k8s.io/v1/namespaces/team/ingresses'])
    assert.ok(!fs.existsSync(path.join(dataDir, 'monitor.json')))
  })
})

test('Grafana LoadBalancer and external IP URLs use service ports and support IPv6', async () => {
  await fixture(async url => ({ items: url.endsWith('/services') ? [{ ...service('grafana', { type: 'LoadBalancer', externalIPs: ['198.51.100.20'], ports: [{ name: 'https', port: 443, targetPort: 3000 }] }), status: { loadBalancer: { ingress: [{ ip: '2001:db8::10' }] } } }] : [] }), async () => {
    const result = await monitor.discoverGrafanas('test', 'team', { account })
    assert.deepEqual(result.items.map(x => x.url).sort(), ['https://198.51.100.20', 'https://[2001:db8::10]'])
  })
})

test('in-cluster numeric Kubernetes Service VIP never becomes a NodePort browser address', async () => {
  await fixture(async url => ({ items: url.endsWith('/services') ? [service('grafana', { type: 'NodePort', ports: [{ port: 80, targetPort: 3000, nodePort: 32000 }] })] : [] }), async () => {
    const result = await monitor.discoverGrafanas('test', 'team', { account })
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].url, '')
    assert.match(result.items[0].hint, /填写|手动/)
  }, 'https://10.96.0.1:443', { mode: 'in-cluster-serviceaccount', source: 'serviceaccount' })
})

test('3000-port fallback cannot reinclude Grafana renderer or agent services', async () => {
  await fixture(async url => ({ items: url.endsWith('/services') ? [service('grafana-renderer'), service('grafana-agent'), service('rendering', {}, { 'app.kubernetes.io/component': 'renderer' })] : [] }), async () => {
    const result = await monitor.discoverGrafanas('test', 'team', { account })
    assert.deepEqual(result.items, [])
  })
})

test('Ingress discovery follows an authorized Grafana backend and preserves HTTPS subpaths', async () => {
  await fixture(async url => ({ items: url.endsWith('/services') ? [service('dashboards', {}, { app: 'grafana' })] : [{
    metadata: { name: 'web', namespace: 'team' }, spec: { tls: [{ hosts: ['metrics.example.test'] }], rules: [{ host: 'metrics.example.test', http: { paths: [{ path: '/grafana', backend: { service: { name: 'dashboards', port: { number: 80 } } } }] } }] },
  }] }), async () => {
    const result = await monitor.discoverGrafanas('test', 'team', { account })
    assert.equal(result.items.find(x => x.source === 'Ingress').url, 'https://metrics.example.test/grafana')
  })
})

test('discovery rejects wildcard and malformed hosts instead of generating misleading candidate links', async () => {
  await fixture(async url => ({ items: url.endsWith('/services') ? [] : ['*.example.test', 'user@evil.test', 'host.test/other'].map(host => ({ metadata: { name: 'grafana', namespace: 'team' }, spec: { rules: [{ host, http: { paths: [{ path: '/', backend: { service: { name: 'grafana', port: { number: 80 } } } }] } }] } })) }), async () => {
    const result = await monitor.discoverGrafanas('test', 'team', { account })
    assert.ok(result.items.every(x => x.url === ''))
  })
})

test('partial discovery retains candidates with warnings and complete scan failures are errors', async () => {
  await fixture(async url => {
    if (url.includes('/ingresses')) throw Object.assign(new Error('Ingress denied'), { status: 403 })
    return { items: [service('grafana')] }
  }, async () => {
    const result = await monitor.discoverGrafanas('test', '', { account })
    assert.equal(result.items.length, 1)
    assert.match(result.warnings.join(' '), /Ingress.*denied/)
  })
  await fixture(async () => { throw Object.assign(new Error('upstream denied'), { status: 403 }) }, async () => {
    await assert.rejects(monitor.discoverGrafanas('test', 'team', { account }), { status: 403 })
  })
})

test('cluster and namespace scope escapes issue no upstream reads', async () => {
  await fixture(async () => ({ items: [] }), async calls => {
    await assert.rejects(monitor.discoverGrafanas('test', 'outside', { account }), { status: 403 })
    await assert.rejects(monitor.discoverGrafanas('test', 'team', { account: { ...account, scope: { ...account.scope, clusters: ['other'] } } }), { status: 403 })
    assert.deepEqual(calls, [])
  })
})

test('discovery route requires monitor create permission and an explicit valid selected cluster', async () => {
  await fixture(async () => ({ items: [] }), async calls => {
    assert.equal((await route({ account: { ...account, permissions: ['monitor:list', 'cluster:list'] }, body: { clusterId: 'test' } })).status, 403)
    await assert.rejects(route({ body: {} }), { status: 400 })
    await assert.rejects(route({ body: { clusterId: 'missing' } }), { status: 403 })
    assert.deepEqual(calls, [])
    const response = await route({ body: { clusterId: 'test', namespace: 'team' } })
    assert.equal(response.status, 200)
    assert.deepEqual(response.body.items, [])
  })
})
