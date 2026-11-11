import test from 'node:test'
import assert from 'node:assert/strict'
import * as yaml from 'js-yaml'

const utils = await import('../src/utils/yaml-preview.js').catch(() => ({}))

test('compact YAML removes runtime metadata and status without changing the source', () => {
  assert.equal(typeof utils.yamlPreview, 'function')
  const resource = {
    apiVersion: 'v1', kind: 'Pod',
    metadata: { name: 'demo', namespace: 'default', uid: 'uid-1', resourceVersion: '42', generation: 3,
      creationTimestamp: '2026-11-11T01:33:14Z', deletionTimestamp: null, deletionGracePeriodSeconds: 30,
      selfLink: '/api/v1/pods/demo', managedFields: [{ manager: 'kubelet' }],
      labels: { app: 'demo' }, annotations: { 'example.com/owner': 'ops', 'kubectl.kubernetes.io/last-applied-configuration': 'old manifest' },
      ownerReferences: [{ uid: 'controller', controller: true }], finalizers: ['example.com/protect'] },
    spec: { nodeName: 'worker-1', containers: [{ name: 'app', image: 'nginx:1.27' }], tolerations: [{ operator: 'Exists' }] },
    status: { phase: 'Running' },
  }
  const source = yaml.dump(resource)
  const preview = utils.yamlPreview(source, true)
  assert.equal(preview.error, '')
  const compact = yaml.load(preview.text)
  assert.deepEqual(compact.metadata, { name: 'demo', namespace: 'default', labels: { app: 'demo' },
    annotations: { 'example.com/owner': 'ops' }, ownerReferences: resource.metadata.ownerReferences, finalizers: resource.metadata.finalizers })
  assert.deepEqual(compact.spec, resource.spec)
  assert.equal('status' in compact, false)
  assert.equal(utils.yamlPreview(source, false).text, source, 'Full view must retain original formatting and optimistic lock')
  assert.deepEqual(yaml.load(source), resource)
})

test('compact YAML preserves configuration keys named status or metadata inside user data', () => {
  assert.equal(typeof utils.yamlPreview, 'function')
  const resource = { apiVersion: 'example.com/v1', kind: 'Widget', metadata: { name: 'widget' },
    spec: { status: { managedFields: 'business setting' }, metadata: { uid: 'business id' } },
    data: { status: 'enabled', metadata: 'keep', manifest: 'status:\n  phase: configured\n' }, status: { ready: true } }
  const compact = yaml.load(utils.yamlPreview(yaml.dump(resource), true).text)
  assert.deepEqual(compact.spec, resource.spec)
  assert.deepEqual(compact.data, resource.data)
})

test('known workload template metadata is cleaned without changing labels, annotations, or container configuration', () => {
  assert.equal(typeof utils.yamlPreview, 'function')
  const template = { metadata: { creationTimestamp: null, labels: { app: 'job' }, annotations: { 'example.com/inject': 'true' } },
    spec: { containers: [{ name: 'worker', image: 'job:1' }], restartPolicy: 'Never' } }
  const resource = { apiVersion: 'batch/v1', kind: 'CronJob', metadata: { name: 'job' },
    spec: { schedule: '0 * * * *', jobTemplate: { metadata: { creationTimestamp: null }, spec: { template } } } }
  const compact = yaml.load(utils.yamlPreview(yaml.dump(resource), true).text)
  assert.equal('creationTimestamp' in compact.spec.jobTemplate.metadata, false)
  assert.deepEqual(compact.spec.jobTemplate.spec.template.metadata, { labels: { app: 'job' }, annotations: { 'example.com/inject': 'true' } })
  assert.deepEqual(compact.spec.jobTemplate.spec.template.spec, template.spec)
})

test('multi-document YAML and Kubernetes List items are compacted individually', () => {
  assert.equal(typeof utils.yamlPreview, 'function')
  const item = { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'settings', uid: 'uid' }, data: { enabled: 'true' } }
  const source = yaml.dump({ apiVersion: 'v1', kind: 'List', metadata: { resourceVersion: '42' }, items: [item] }) + '\n---\n' + yaml.dump(item)
  const documents = yaml.loadAll(utils.yamlPreview(source, true).text)
  assert.equal(documents.length, 2)
  assert.deepEqual(documents[0].items[0].metadata, { name: 'settings' })
  assert.deepEqual(documents[1].data, item.data)
})

test('incomplete YAML reports a preview error while the original draft remains available', () => {
  assert.equal(typeof utils.yamlPreview, 'function')
  const source = 'apiVersion: v1\nspec: [\n'
  assert.ok(utils.yamlPreview(source, true).error)
  assert.equal(utils.yamlPreview(source, true).text, '')
  assert.equal(utils.yamlPreview(source, false).text, source)
})

test('compact YAML retains Secret payloads as encoded strings without decoding or changing access', () => {
  assert.equal(typeof utils.yamlPreview, 'function')
  const resource = { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'secret', managedFields: [] }, type: 'Opaque', data: { password: 'ZmFrZQ==' } }
  const compact = yaml.load(utils.yamlPreview(yaml.dump(resource), true).text)
  assert.deepEqual(compact.data, resource.data)
  assert.equal(compact.type, 'Opaque')
})

test('YAML aliases referencing metadata do not cause user configuration to lose fields', () => {
  const source = 'apiVersion: example.com/v1\nkind: Widget\nmetadata: &shared\n  name: example\n  uid: business-copy\nspec:\n  originalMetadata: *shared\n'
  const compact = yaml.load(utils.yamlPreview(source, true).text)
  assert.equal(compact.metadata.uid, undefined)
  assert.equal(compact.spec.originalMetadata.uid, 'business-copy')
})
