import test from 'node:test'
import assert from 'node:assert/strict'
import { phaseOf, normalizeRow } from '../src/config/columns.js'
import { statusTag, metaFromRoute } from '../src/config/resources.js'

test('negative health statuses cannot be marked successful', () => {
  assert.equal(statusTag('NotReady'), 'danger')
  assert.equal(statusTag('NotHealthy'), 'danger')
  assert.equal(statusTag('Ready'), 'success')
})
test('Pod reports eviction and init failure before generic phase', () => {
  assert.equal(phaseOf('Pod', {status:{phase:'Failed',reason:'Evicted'}}), 'Evicted')
  assert.equal(phaseOf('Pod', {status:{phase:'Pending',initContainerStatuses:[{state:{waiting:{reason:'CrashLoopBackOff'}}}]}}), 'Init:CrashLoopBackOff')
})
test('scaled-to-zero workloads are intentional and running unready pods are unhealthy', () => {
  assert.equal(phaseOf('Deployment', {spec:{replicas:0},status:{}}), 'ScaledToZero')
  assert.equal(phaseOf('Pod',{spec:{containers:[{name:'app'}]},status:{phase:'Running',containerStatuses:[{ready:false,state:{running:{}}}]}}), 'NotReady')
})
test('custom resource scope is discovered by exact group version plural', () => {
  const p = {group:'example.io',version:'v2',plural:'widgets'}
  assert.equal(metaFromRoute(p,[{group:'example.io',version:'v2',plural:'widgets',kind:'Widget',namespaced:false}]).namespaced,false)
})
test('rows expose owner and include init restarts', () => {
  const row=normalizeRow('Pod',{metadata:{ownerReferences:[{kind:'Job',name:'batch'}]},status:{initContainerStatuses:[{restartCount:3}],containerStatuses:[{restartCount:2}]}})
  assert.equal(row.restarts,5)
  assert.equal(row.owner,'Job/batch')
})
