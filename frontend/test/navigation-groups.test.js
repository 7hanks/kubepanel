import test from 'node:test'
import assert from 'node:assert/strict'
import { navGroups, resourceMap, metaFromRoute } from '../src/config/resources.js'
import * as navigation from '../src/utils/navigation-groups.js'

test('built-in resource labels preserve Kubernetes casing and route identities', () => {
  assert.equal(resourceMap['_core/v1/pods'].label, 'Pods')
  assert.equal(resourceMap['_core/v1/limitranges'].label, 'LimitRanges')
  assert.equal(resourceMap['_core/v1/persistentvolumeclaims'].label, 'PVCs')
  assert.equal(metaFromRoute({ group: '_core', version: 'v1', plural: 'configmaps' }, [
    { group: '', version: 'v1', plural: 'configmaps', kind: 'ConfigMap', namespaced: true },
  ]).label, 'ConfigMaps')
})

test('only workload and overview start open; secondary resources stay reachable in closed groups', () => {
  const visible = navigation.visibleNavigationGroups(navGroups, '', {}, () => true)
  assert.deepEqual(visible.filter(g => g.open).map(g => g.id), ['overview', 'workloads'])
  for (const plural of ['limitranges', 'resourcequotas', 'roles', 'replicasets', 'endpoints']) {
    assert.equal(visible.find(g => g.items.some(i => i.plural === plural)).open, false)
  }
})

test('search reveals Chinese aliases and kinds in saved closed groups without changing preferences', () => {
  const saved = { advanced: false, storage: false }
  const before = { ...saved }
  const quota = navigation.visibleNavigationGroups(navGroups, '限制范围', saved, () => true)
  assert.equal(quota[0].open, true)
  assert.equal(quota[0].items[0].kind, 'LimitRange')
  const pvc = navigation.visibleNavigationGroups(navGroups, 'PersistentVolumeClaim', saved, () => true)
  assert.equal(pvc[0].items[0].label, 'PVCs')
  assert.equal(navigation.visibleNavigationGroups(navGroups, 'configmaps', saved, () => true)[0].items[0].label, 'ConfigMaps')
  assert.deepEqual(saved, before)
  assert.equal(navigation.visibleNavigationGroups(navGroups, '', saved, () => true).find(g => g.id === 'advanced').open, false)
})

test('permission filtering runs before search and hides empty groups', () => {
  const result = navigation.visibleNavigationGroups(navGroups, '限制范围', {}, i => i.plural !== 'limitranges')
  assert.deepEqual(result, [])
})

test('active deep links open their group while retaining other saved preferences', () => {
  const saved = { workloads: false, advanced: false, network: true }
  const result = navigation.revealActiveNavigationGroup(navGroups, saved,
    item => '/r/_core/v1/limitranges/default/example'.startsWith(item.path + '/'))
  assert.deepEqual(result, { workloads: false, advanced: true, network: true })
  assert.equal(saved.advanced, false)
})

test('invalid saved expansion data falls back safely and only boolean preferences are retained', () => {
  assert.deepEqual(navigation.parseNavigationExpansion('{broken'), {})
  assert.deepEqual(navigation.parseNavigationExpansion('null'), {})
  assert.deepEqual(navigation.parseNavigationExpansion('[true]'), {})
  assert.deepEqual(navigation.parseNavigationExpansion('{"network":false,"tools":true,"cluster":"false"}'), { network: false, tools: true })
})
