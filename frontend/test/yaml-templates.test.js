import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from 'js-yaml'
import { yamlTemplate } from '../src/config/columns.js'
import { resourceMap } from '../src/config/resources.js'

function draft(kind, namespace = 'team-a') {
  const meta = Object.values(resourceMap).find(item => item.kind === kind)
  assert.ok(meta, `navigation metadata exists for ${kind}`)
  const result = load(yamlTemplate(meta, namespace))
  assert.equal(result.kind, kind)
  assert.equal(result.apiVersion, meta.group ? `${meta.group}/${meta.version}` : meta.version)
  assert.equal(result.metadata.namespace, meta.namespaced ? namespace : undefined)
  return result
}

test('storage YAML drafts include provisioning fields without using host storage or deleting volumes by default', () => {
  const pv = draft('PersistentVolume')
  assert.ok(pv.spec?.capacity?.storage)
  assert.ok(pv.spec.accessModes.length)
  assert.equal(pv.spec.persistentVolumeReclaimPolicy, 'Retain')
  assert.ok(pv.spec.csi?.driver)
  assert.ok(pv.spec.csi.volumeHandle)
  assert.equal(pv.spec.hostPath, undefined)
  assert.equal(pv.spec.claimRef, undefined)
  const storageClass = draft('StorageClass')
  assert.ok(storageClass.provisioner)
  assert.equal(storageClass.reclaimPolicy, 'Retain')
  assert.equal(storageClass.metadata.annotations?.['storageclass.kubernetes.io/is-default-class'], undefined)
})

test('binding YAML drafts identify a role and a namespaced service account without broad default grants', () => {
  for (const kind of ['RoleBinding', 'ClusterRoleBinding']) {
    const binding = draft(kind)
    assert.equal(binding.roleRef?.apiGroup, 'rbac.authorization.k8s.io')
    assert.equal(binding.roleRef.kind, kind === 'RoleBinding' ? 'Role' : 'ClusterRole')
    assert.match(binding.roleRef.name, /replace/)
    assert.equal(binding.subjects?.[0]?.kind, 'ServiceAccount')
    assert.equal(binding.subjects[0].namespace, 'team-a')
    assert.match(binding.subjects[0].name, /replace/)
  }
})

test('HPA and LimitRange drafts include typed configuration needed for creation', () => {
  const hpa = draft('HorizontalPodAutoscaler')
  assert.equal(hpa.spec?.scaleTargetRef?.apiVersion, 'apps/v1')
  assert.equal(hpa.spec.scaleTargetRef.kind, 'Deployment')
  assert.match(hpa.spec.scaleTargetRef.name, /replace/)
  assert.ok(Number.isInteger(hpa.spec.maxReplicas) && hpa.spec.maxReplicas >= hpa.spec.minReplicas)
  assert.equal(hpa.spec.metrics?.[0]?.resource?.target?.type, 'Utilization')
  const limit = draft('LimitRange').spec?.limits?.[0]
  assert.equal(limit?.type, 'Container')
  assert.ok(limit.default?.cpu)
  assert.ok(limit.defaultRequest?.cpu)
})

test('CRD and EndpointSlice drafts supply schema and addressing structure with matching identities', () => {
  const crd = draft('CustomResourceDefinition')
  assert.ok(crd.spec?.group)
  assert.equal(crd.metadata.name, `${crd.spec.names.plural}.${crd.spec.group}`)
  assert.ok(crd.spec.names.kind)
  assert.equal(crd.spec.scope, 'Namespaced')
  assert.equal(crd.spec.versions.filter(version => version.storage).length, 1)
  assert.equal(crd.spec.versions[0].served, true)
  assert.equal(crd.spec.versions[0].schema.openAPIV3Schema.type, 'object')
  const slice = draft('EndpointSlice')
  assert.equal(slice.addressType, 'IPv4')
  assert.ok(slice.metadata.labels?.['kubernetes.io/service-name'])
  assert.ok(slice.metadata.labels?.['endpointslice.kubernetes.io/managed-by'])
  assert.ok(Array.isArray(slice.endpoints))
  assert.ok(Array.isArray(slice.ports))
})

test('other networking and quota drafts expose their configuration without selecting every pod', () => {
  const policy = draft('NetworkPolicy')
  assert.match(policy.spec?.podSelector?.matchLabels?.app, /replace/)
  assert.ok(Array.isArray(policy.spec.ingress))
  const endpoints = draft('Endpoints')
  assert.equal(endpoints.subsets?.[0]?.addresses?.[0]?.ip, '192.0.2.10')
  assert.ok(endpoints.subsets[0].ports[0].port)
  assert.ok(Number(draft('ResourceQuota').spec?.hard?.pods) > 0)
  assert.deepEqual(draft('Role').rules, [])
  assert.deepEqual(draft('ClusterRole').rules, [])
})
