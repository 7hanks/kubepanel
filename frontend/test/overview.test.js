import test from 'node:test'
import assert from 'node:assert/strict'
import { usagePresentation, overviewHealth, recentWarningCount } from '../src/utils/overview.js'

test('node usage displays cores and GiB and clamps only the visual bar', () => {
  assert.deepEqual(usagePresentation({ used: 1500, allocatable: 1000, percent: 150 }, 'cpu'), { value: '150%', percent: 100, detail: '1.5 / 1 核', available: true })
  assert.equal(usagePresentation({ used: 1024 ** 3, allocatable: 4 * 1024 ** 3, percent: 25 }, 'memory').detail, '1 / 4 GiB')
  assert.equal(usagePresentation(null, 'cpu').value, '—')
})

test('health never reports normal from missing or partial data', () => {
  assert.equal(overviewHealth({ loaded: true, partial: true, unhealthyPods: 0, nodes: 2 }).type, 'info')
  assert.equal(overviewHealth({ loaded: true, unhealthyPods: null, nodes: 2 }).type, 'info')
  assert.equal(overviewHealth({ loaded: true, unhealthyPods: 0, nodes: null }).type, 'info')
  assert.equal(overviewHealth({ loaded: true, unhealthyPods: 0, nodes: 2 }).type, 'success')
  assert.equal(overviewHealth({ loaded: true, partial: true, unhealthyPods: 1, nodes: null }).type, 'danger')
})

test('Warning card counts loaded event records, not recurrence totals, and keeps failures unknown', () => {
  const data = { events: [{ type: 'Warning', count: 500 }, { type: 'Normal' }, { type: 'Warning' }] }
  assert.equal(recentWarningCount(data, true), 2)
  assert.equal(recentWarningCount({ ...data, errors: { events: { status: 403 } } }, true), null)
  assert.equal(recentWarningCount({}, false), null)
})
