import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateNodeUsage } from '../src/overviewMetrics.js'

const node = (name, cpu = '2', memory = '4Gi') => ({ metadata: { name }, status: { allocatable: { cpu, memory }, capacity: { cpu: '8', memory: '16Gi' } } })
const metric = (name, cpu = '500m', memory = '1Gi') => ({ metadata: { name }, usage: { cpu, memory } })
const list = items => ({ items })

test('cluster usage sums node metrics against allocatable, never pod requests or capacity', () => {
  const result = aggregateNodeUsage(list([node('a'), node('b')]), list([metric('a'), metric('b', '1500000000n', '2Gi')]))
  assert.equal(result.available, true)
  assert.deepEqual(result.cpu, { used: 2000, allocatable: 4000, percent: 50 })
  assert.deepEqual(result.memory, { used: 3 * 1024 ** 3, allocatable: 8 * 1024 ** 3, percent: 37.5 })
  assert.equal(result.sampled, 2)
})

test('missing, forbidden, incomplete and paginated node metrics stay unavailable', () => {
  const nodes = list([node('a'), node('b')])
  for (const [n, m] of [[null, list([])], [nodes, null], [nodes, list([metric('a')])], [nodes, { items: [metric('a'), metric('b')], metadata: { continue: 'more' } }], [{ ...nodes, metadata: { continue: 'more' } }, list([metric('a'), metric('b')])], [list([]), list([])]]) {
    const result = aggregateNodeUsage(n, m)
    assert.equal(result.available, false)
    assert.equal(result.cpu, null)
    assert.equal(result.memory, null)
  }
})

test('unknown quantities and absent allocatable never become measured zero or use capacity', () => {
  for (const [n, m] of [[node('a', '0'), metric('a')], [node('a', 'bogus'), metric('a')], [node('a'), metric('a', 'broken')], [node('a'), metric('a', '1', 'bogus')], [{ metadata: { name: 'a' }, status: { capacity: { cpu: '8', memory: '16Gi' } } }, metric('a')], [node('a'), { metadata: { name: 'a' }, usage: { cpu: '0' } }]]) {
    assert.equal(aggregateNodeUsage(list([n]), list([m])).available, false)
  }
  assert.equal(aggregateNodeUsage(list([node('a')]), list([{ metadata: { name: 'a' }, usage: { memory: '1Gi' } }])).available, false)
})

test('real zero usage remains available and usage above allocatable is not capped', () => {
  assert.equal(aggregateNodeUsage(list([node('a')]), list([metric('a', '0', '0')])).cpu.percent, 0)
  assert.equal(aggregateNodeUsage(list([node('a')]), list([metric('a', '3', '1Gi')])).cpu.percent, 150)
})
