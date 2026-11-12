import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
const testRoot = path.resolve('.local/tests')
fs.mkdirSync(testRoot, { recursive: true })
process.env.DATA_DIR = fs.mkdtempSync(path.join(testRoot, 'kp-cluster-edit-'))
process.env.KUBE_CLUSTERS_DIR = path.join(process.env.DATA_DIR, 'clusters')
process.env.DASHBOARD_SECRET = 'cluster-edit-test-secret-32-characters'
const service = await import('../src/clusterService.js')
const kube = await import('../src/kube.js')
const configText = server => `apiVersion: v1
kind: Config
clusters:
- name: fixture
  cluster:
    server: ${server}
users:
- name: fixture
  user:
    token: fixture-token
contexts:
- name: fixture
  context:
    cluster: fixture
    user: fixture
current-context: fixture
`
test('editing persists the name and creation date across reloads with the same identity', () => {
  const { ids: [id] } = service.addCluster('Original', configText('https://fixture.invalid'))
  const createdAt = kube.getCluster(id).createdAt
  assert.ok(Number.isFinite(Date.parse(createdAt)))
  service.updateCluster(id, { name: 'Renamed', kubeconfig: configText('https://updated.invalid') })
  assert.equal(kube.getCluster(id).name, 'Renamed')
  assert.equal(kube.getCluster(id).server, 'https://updated.invalid')
  kube.unregisterCluster(id)
  service.initClusters()
  assert.equal(kube.getCluster(id).name, 'Renamed')
  assert.equal(kube.getCluster(id).createdAt, createdAt)
  assert.equal(kube.getCluster(id).server, 'https://updated.invalid')
  service.removeCluster(id)
})
test('invalid replacement or missing context leaves the existing configuration unchanged', () => {
  const { ids: [id] } = service.addCluster('Protected', configText('https://fixture.invalid'))
  const before = fs.readFileSync(kube.getCluster(id).file, 'utf8')
  const metadata = fs.readFileSync(path.join(process.env.DATA_DIR, 'cluster-metadata.json'), 'utf8')
  assert.throws(() => service.updateCluster(id, { name: 'Wrong', kubeconfig: 'invalid' }))
  assert.throws(() => service.updateCluster(id, { name: 'Wrong', kubeconfig: configText('https://updated.invalid').replaceAll('fixture', 'other') }))
  assert.throws(() => service.updateCluster(id, { name: 'Wrong', kubeconfig: configText('https://updated.invalid').replace('    cluster: fixture', '    cluster: missing') }), { status: 400 })
  assert.equal(kube.getCluster(id).name, 'Protected')
  assert.equal(fs.readFileSync(kube.getCluster(id).file, 'utf8'), before)
  assert.equal(fs.readFileSync(path.join(process.env.DATA_DIR, 'cluster-metadata.json'), 'utf8'), metadata)
  service.removeCluster(id)
})

test('credential replacement checks access to every context in the shared file', () => {
  const multi = server => configText(server).replace('current-context: fixture', '- name: sibling\n  context:\n    cluster: fixture\n    user: fixture\ncurrent-context: fixture')
  const { ids } = service.addCluster('Shared', multi('https://fixture.invalid'))
  const account = { username: 'limited', permissions: ['cluster:list','cluster:import'], scope: { clusters: [ids[0]], namespaces: ['*'], resources: ['*'] } }
  assert.throws(() => service.updateCluster(ids[0], { name: 'Changed', kubeconfig: multi('https://updated.invalid') }, account), { status: 403 })
  assert.equal(kube.getCluster(ids[1]).server, 'https://fixture.invalid')
  account.scope.clusters = ids
  const result = service.updateCluster(ids[0], { name: 'Changed', kubeconfig: multi('https://updated.invalid') }, account)
  assert.deepEqual(result.affectedIds, ids)
  assert.equal(kube.getCluster(ids[1]).server, 'https://updated.invalid')
  service.removeCluster(ids[0])
})
