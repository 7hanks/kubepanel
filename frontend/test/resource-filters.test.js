import test from 'node:test'
import assert from 'node:assert/strict'
import { filterRows } from '../src/utils/resource.js'
const filters = await import('../src/utils/resource-filters.js').catch(() => ({}))

test('resource kind limits filter fields instead of retaining Pod criteria on ConfigMaps', () => {
  assert.equal(typeof filters.normalizeFilters, 'function')
  const f = filters.normalizeFilters('ConfigMap', {state:'NotReady', node:'worker-1', minRestarts:'3', labels:'env in (prod,qa)', q:'settings'})
  assert.deepEqual(f, {keyword:'settings', labels:'env in (prod,qa)', createdFrom:'', createdTo:'', state:'', phase:'', reason:'', node:'', owner:'', minRestarts:0, image:'', ready:''})
  assert.equal(filters.filterCapabilities('LimitRange').state, false)
  assert.equal(filters.filterCapabilities('Pod').node, true)
})

test('filter URL roundtrip preserves Kubernetes set selectors and normalizes query arrays', () => {
  assert.equal(typeof filters.filterQuery, 'function')
  const f = filters.normalizeFilters('Pod', {labels:['tier in (api,worker),!debug'], node:'worker-1', minRestarts:'4', ready:'not-ready', q:'demo'})
  assert.deepEqual(filters.normalizeFilters('Pod', filters.filterQuery(f)), f)
  assert.equal(filters.activeFilterCount(f), 4)
  assert.equal(filters.normalizeFilters('Pod', {minRestarts:'NaN',ready:'invented'}).minRestarts, 0)
})

test('selected node matches exactly and image searches include init container images', () => {
  const rows = [{name:'one',node:'worker-1',_raw:{spec:{initContainers:[{image:'registry/setup:v2'}]}}},{name:'ten',node:'worker-10',_raw:{spec:{containers:[{image:'nginx:latest'}]}}}]
  assert.deepEqual(filterRows(rows,{node:'worker-1'}).map(r=>r.name), ['one'])
  assert.deepEqual(filterRows(rows,{image:'SETUP:v2'}).map(r=>r.name), ['one'])
})

test('Pod ready filter uses Ready condition instead of Running phase or historical restarts', () => {
  const rows = [{name:'healthy',status:'Running',restarts:5,_raw:{status:{conditions:[{type:'Ready',status:'True'}]}}},{name:'unready',status:'NotReady',_raw:{status:{phase:'Running',conditions:[{type:'Ready',status:'False'}]}}}]
  assert.deepEqual(filterRows(rows,{ready:'ready'}).map(r=>r.name), ['healthy'])
  assert.deepEqual(filterRows(rows,{ready:'not-ready'}).map(r=>r.name), ['unready'])
})

test('event abnormal status excludes Normal events and retains Warning events', () => {
  assert.deepEqual(filterRows([{name:'normal',status:'Normal'},{name:'warning',status:'Warning'}],{state:'abnormal'}).map(r=>r.name), ['warning'])
})

test('creation date bounds filter timestamp inclusively and survive resource query roundtrip', () => {
  const f = filters.normalizeFilters('ConfigMap', {createdFrom:'2026-11-01T00:00:00.000Z', createdTo:'2026-11-02T00:00:00.000Z'})
  assert.equal(f.createdFrom, '2026-11-01T00:00:00.000Z')
  assert.equal(f.createdTo, '2026-11-02T00:00:00.000Z')
  assert.deepEqual(filters.normalizeFilters('ConfigMap', filters.filterQuery(f)), f)
  const rows = [
    {name:'before',_raw:{metadata:{creationTimestamp:'2026-10-31T23:59:59Z'}}},
    {name:'start',_raw:{metadata:{creationTimestamp:'2026-11-01T00:00:00Z'}}},
    {name:'end',_raw:{metadata:{creationTimestamp:'2026-11-02T00:00:00Z'}}},
    {name:'after',_raw:{metadata:{creationTimestamp:'2026-11-02T00:00:01Z'}}},
    {name:'missing',_raw:{metadata:{}}},
  ]
  assert.deepEqual(filterRows(rows, f).map(r=>r.name), ['start','end'])
  assert.deepEqual(filterRows(rows, {createdTo:f.createdTo}).map(r=>r.name), ['before','start','end'])
  assert.equal(filters.normalizeFilters('Pod', {createdFrom:'invalid'}).createdFrom, '')
  assert.ok(filters.filterQueryKeys.includes('createdFrom'))
  assert.ok(filters.filterQueryKeys.includes('createdTo'))
})
