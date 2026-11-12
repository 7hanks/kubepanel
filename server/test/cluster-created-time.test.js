import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kubepanel-created-time-'))
process.env.DASHBOARD_SECRET = 'creation-time-test-secret-not-for-production'
const { clusterSummaries } = await import('../src/clusterService.js')
const { registerCluster, unregisterCluster, getCluster } = await import('../src/kube.js')
const initialized = '2023-04-05T06:07:08Z'
const imported = '2026-11-12T01:00:00Z'
const namespace = (name, creationTimestamp) => ({ apiVersion: 'v1', kind: 'Namespace', metadata: { name, creationTimestamp } })

async function fixture({ items = [], createdAt, namespaceError = false } = {}, run) {
  const id = 'created-time-fixture', calls = []
  registerCluster({ id, name: 'Legacy mount', createdAt, request: async (method, url) => {
    calls.push(url)
    if (url === '/version') return { data: { gitVersion: 'v1.30.0' } }
    if (url === '/api/v1/nodes') return { data: { items: [{ metadata: { name: 'old-node', creationTimestamp: '1999-01-01T00:00:00Z' } }] } }
    if (url.startsWith('/api/v1/namespaces')) {
      if (namespaceError) throw Object.assign(new Error('forbidden'), { status: 403 })
      if (url === '/api/v1/namespaces') return { data: { items } }
      return { data: items.find(item => item.metadata.name === url.split('/').at(-1)) }
    }
    return { data: { items: [] } }
  }, kc: {
    getCurrentCluster: () => ({ server: 'https://fixture.invalid' }), getClusters: () => [], getUsers: () => [],
    getCurrentUser: () => ({}), getCurrentContext: () => 'test',
  } })
  try { await run(id, calls) } finally { unregisterCluster(id) }
}
const reader = namespaces => ({ username: 'reader', permissions: ['cluster:list'], scope: { clusters: ['created-time-fixture'], namespaces, resources: ['*'] } })

test('legacy creation uses kube-system metadata consistently, never an older node or another namespace', async () => {
  await fixture({ items: [namespace('default', '2000-01-01T00:00:00Z'), namespace('kube-system', initialized)] }, async (id, calls) => {
    for (let i = 0; i < 2; i++) {
      const [row] = await clusterSummaries(true)
      assert.equal(row.clusterCreatedAt, initialized)
      assert.equal(row.createdAt, null)
      assert.equal(row.createdAtSource, 'kube-system')
    }
    assert.equal(getCluster(id).createdAt, undefined, 'reading cluster metadata must not manufacture a registration time')
    assert.equal(calls.filter(url => url === '/api/v1/namespaces').length, 2)
    assert.ok(!calls.includes('/api/v1/namespaces/kube-system'), 'reuse the existing authorized namespace list')
  })
})

test('actual initialization and platform import dates remain separate', async () => {
  await fixture({ createdAt: imported, items: [namespace('kube-system', initialized)] }, async () => {
    const [row] = await clusterSummaries(true)
    assert.equal(row.clusterCreatedAt, initialized)
    assert.equal(row.createdAt, imported)
    assert.equal(row.createdAtSource, 'kube-system')
  })
})

test('an unrestricted cached timestamp never leaks into a scoped namespace summary', async () => {
  await fixture({ items: [namespace('team', '2025-01-01T00:00:00Z'), namespace('kube-system', initialized)] }, async (id, calls) => {
    await clusterSummaries(true)
    calls.length = 0
    const [row] = await clusterSummaries(false, reader(['team']))
    assert.equal(row.clusterCreatedAt, null)
    assert.equal(row.createdAt, null)
    assert.equal(row.createdAtSource, null)
    assert.deepEqual(calls.filter(url => url.startsWith('/api/v1/namespaces')), ['/api/v1/namespaces/team'])
    const [authorized] = await clusterSummaries(true, reader(['kube-system']))
    assert.equal(authorized.clusterCreatedAt, initialized)
  })
})

test('missing, invalid or inaccessible namespace timestamps remain unknown, with only a known import fallback', async () => {
  for (const options of [{}, { items: [namespace('kube-system', 'invalid')] }, { namespaceError: true }]) {
    await fixture(options, async () => {
      const [row] = await clusterSummaries(true)
      assert.equal(row.clusterCreatedAt, null)
      assert.equal(row.createdAt, null)
      assert.equal(row.createdAtSource, null)
    })
    await fixture({ ...options, createdAt: imported }, async () => {
      const [row] = await clusterSummaries(true)
      assert.equal(row.clusterCreatedAt, null)
      assert.equal(row.createdAt, imported)
      assert.equal(row.createdAtSource, 'platform-import')
    })
  }
})
