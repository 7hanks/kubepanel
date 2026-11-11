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
      selfLink: '/api/v1/pods/demo', managedFields: [{ manager: 'kubectl-create', fieldsV1: { 'f:spec': { 'f:nodeName': {} } } }],
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

const originalTomcat = { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'demo-pod', namespace: 'default', labels: { app: 'myapp', env: 'dev' } },
  spec: { containers: [{ name: 'tomcat-pod-java', ports: [{ containerPort: 8080 }], image: 'tomcat:8.5-jre8-alpine', imagePullPolicy: 'IfNotPresent' }] } }
const apiVolume = { name: 'kube-api-access-abc12', projected: { sources: [
  { serviceAccountToken: { expirationSeconds: 3607, path: 'token' } },
  { configMap: { name: 'kube-root-ca.crt', items: [{ key: 'ca.crt', path: 'ca.crt' }] } },
  { downwardAPI: { items: [{ path: 'namespace', fieldRef: { apiVersion: 'v1', fieldPath: 'metadata.namespace' } }] } },
], defaultMode: 420 } }
const automaticTolerations = ['not-ready', 'unreachable'].map(key => ({ key: `node.kubernetes.io/${key}`, operator: 'Exists', effect: 'NoExecute', tolerationSeconds: 300 }))
function liveTomcat() {
  const pod = structuredClone(originalTomcat)
  Object.assign(pod.metadata, { uid: 'pod-uid', resourceVersion: '42', managedFields: [{ manager: 'unknown', operation: 'Update', fieldsV1: { 'f:spec': { 'f:containers': {}, 'f:dnsPolicy': {} } } }],
    annotations: { 'cni.projectcalico.org/containerID': 'runtime-id', 'cni.projectcalico.org/podIP': '10.0.0.4/32', 'cni.projectcalico.org/podIPs': '10.0.0.4/32' } })
  Object.assign(pod.spec, { volumes: [structuredClone(apiVolume)], restartPolicy: 'Always', terminationGracePeriodSeconds: 30, dnsPolicy: 'ClusterFirst',
    serviceAccountName: 'default', serviceAccount: 'default', nodeName: 'worker-1', securityContext: {}, schedulerName: 'default-scheduler',
    tolerations: structuredClone(automaticTolerations), priority: 0, enableServiceLinks: true, preemptionPolicy: 'PreemptLowerPriority' })
  Object.assign(pod.spec.containers[0], { ports: [{ containerPort: 8080, protocol: 'TCP' }], resources: {},
    volumeMounts: [{ name: apiVolume.name, readOnly: true, mountPath: '/var/run/secrets/kubernetes.io/serviceaccount' }],
    terminationMessagePath: '/dev/termination-log', terminationMessagePolicy: 'File' })
  pod.status = { phase: 'Running' }
  return pod
}

test('the reported live Tomcat Pod reduces to its declarative example rather than injected defaults', () => {
  const preview = utils.yamlPreview(yaml.dump(liveTomcat()), true)
  assert.deepEqual(yaml.load(preview.text), originalTomcat)
  assert.match(preview.notice, /未保存原始/)
})

test('custom mounts, service account, CNI configuration and non-default options survive deeper compaction', () => {
  const pod = liveTomcat()
  pod.metadata.annotations['k8s.v1.cni.cncf.io/networks'] = 'custom-network'
  pod.metadata.annotations['example.com/owner'] = 'ops'
  pod.spec.serviceAccountName = 'job-runner'; pod.spec.serviceAccount = 'job-runner'
  pod.spec.volumes.push({ name: 'kube-api-access-custom', secret: { secretName: 'application-secret' } })
  pod.spec.containers[0].volumeMounts.push({ name: 'kube-api-access-custom', mountPath: '/custom' })
  pod.spec.containers[0].resources = { requests: { cpu: '100m' } }
  pod.spec.containers[0].ports[0].protocol = 'UDP'
  pod.spec.restartPolicy = 'Never'; pod.spec.dnsPolicy = 'ClusterFirstWithHostNet'; pod.spec.terminationGracePeriodSeconds = 60
  pod.spec.enableServiceLinks = false; pod.spec.preemptionPolicy = 'Never'
  pod.spec.tolerations.push({ key: 'dedicated', operator: 'Equal', value: 'batch', effect: 'NoSchedule' })
  const compact = yaml.load(utils.yamlPreview(yaml.dump(pod), true).text)
  assert.deepEqual(compact.spec.volumes, [pod.spec.volumes[1]])
  assert.deepEqual(compact.spec.containers[0].volumeMounts, [pod.spec.containers[0].volumeMounts[1]])
  for (const field of ['serviceAccountName', 'restartPolicy', 'dnsPolicy', 'terminationGracePeriodSeconds', 'enableServiceLinks', 'preemptionPolicy']) assert.deepEqual(compact.spec[field], pod.spec[field])
  assert.deepEqual(compact.spec.containers[0].resources, pod.spec.containers[0].resources)
  assert.equal(compact.spec.containers[0].ports[0].protocol, 'UDP')
  assert.deepEqual(compact.spec.tolerations, [pod.spec.tolerations[2]])
  assert.deepEqual(compact.metadata.annotations, { 'k8s.v1.cni.cncf.io/networks': 'custom-network', 'example.com/owner': 'ops' })
})

test('a generated-looking API volume is retained if its payload or mounts have custom configuration', () => {
  const pod = liveTomcat()
  pod.spec.volumes[0].projected.sources[0].serviceAccountToken.audience = 'custom-audience'
  const compact = yaml.load(utils.yamlPreview(yaml.dump(pod), true).text)
  assert.deepEqual(compact.spec.volumes, pod.spec.volumes)
  assert.deepEqual(compact.spec.containers[0].volumeMounts, pod.spec.containers[0].volumeMounts)
})

test('last-applied identifies explicitly configured defaults but never replaces newer draft values', () => {
  const pod = liveTomcat()
  const original = structuredClone(originalTomcat)
  original.spec.restartPolicy = 'Always'; original.spec.nodeName = 'worker-1'; original.spec.tolerations = automaticTolerations
  original.spec.containers[0].ports[0].protocol = 'TCP'
  pod.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'] = JSON.stringify(original)
  pod.spec.containers[0].image = 'tomcat:changed-locally'
  const preview = utils.yamlPreview(yaml.dump(pod), true)
  const compact = yaml.load(preview.text)
  assert.equal(compact.spec.restartPolicy, 'Always')
  assert.equal(compact.spec.nodeName, 'worker-1')
  assert.equal(compact.spec.containers[0].ports[0].protocol, 'TCP')
  assert.deepEqual(compact.spec.tolerations, automaticTolerations)
  assert.equal(compact.spec.containers[0].image, 'tomcat:changed-locally')
  assert.match(preview.notice, /上次应用配置/)
})

test('explicit node pinning is retained when field ownership records it', () => {
  const pod = liveTomcat()
  pod.metadata.managedFields[0].fieldsV1['f:spec']['f:nodeName'] = {}
  const compact = yaml.load(utils.yamlPreview(yaml.dump(pod), true).text)
  assert.equal(compact.spec.nodeName, 'worker-1')
})

test('custom token automount and priority-class choices are retained', () => {
  const pod = liveTomcat()
  pod.spec.automountServiceAccountToken = false
  pod.spec.priorityClassName = 'custom-priority'
  const compact = yaml.load(utils.yamlPreview(yaml.dump(pod), true).text)
  assert.deepEqual(compact.spec.volumes, pod.spec.volumes)
  assert.equal(compact.spec.automountServiceAccountToken, false)
  assert.equal(compact.spec.priorityClassName, 'custom-priority')
  assert.equal(compact.spec.preemptionPolicy, 'PreemptLowerPriority')
})
