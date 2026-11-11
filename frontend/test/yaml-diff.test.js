import test from 'node:test'
import assert from 'node:assert/strict'

const utils = await import('../src/utils/yaml-diff.js').catch(() => ({}))
function diff(before, after) {
  assert.equal(typeof utils.yamlLineDiff, 'function', 'a YAML line comparison is available')
  return utils.yamlLineDiff(before, after)
}
function reconstruct(result, side) {
  return result.rows.filter(row => row[side]).map(row => row[side].text).join('\n')
}

test('equal YAML keeps line numbers with no reported changes', () => {
  const result = diff('kind: Pod\nmetadata:\n  name: demo\n', 'kind: Pod\nmetadata:\n  name: demo\n')
  assert.equal(result.unchanged, true)
  assert.equal(result.additions, 0)
  assert.equal(result.deletions, 0)
  assert.deepEqual(result.rows.map(row => [row.before.number, row.after.number]), [[1, 1], [2, 2], [3, 3], [4, 4]])
  assert.ok(result.rows.every(row => row.before.kind === 'equal' && row.after.kind === 'equal'))
})

test('inserted lines occupy added rows without shifting the unchanged comparison', () => {
  const result = diff('kind: Pod\nspec:', 'kind: Pod\nmetadata:\n  name: demo\nspec:')
  assert.equal(result.additions, 2)
  assert.equal(result.deletions, 0)
  assert.deepEqual(result.rows.map(row => [row.before?.number ?? null, row.after?.number ?? null]), [[1, 1], [null, 2], [null, 3], [2, 4]])
  assert.equal(result.rows[1].after.kind, 'added')
})

test('deleted lines keep their original numbers and have no after cell', () => {
  const result = diff('a\nold\nz', 'a\nz')
  assert.equal(result.additions, 0)
  assert.equal(result.deletions, 1)
  assert.deepEqual(result.rows[1], { before: { number: 2, text: 'old', kind: 'removed' }, after: null })
  assert.equal(result.rows[2].after.number, 2)
})

test('replaced blocks align removed and added lines next to each other', () => {
  const result = diff('image: old\nreplicas: 1\nend', 'image: new\nend')
  assert.equal(result.additions, 1)
  assert.equal(result.deletions, 2)
  assert.deepEqual(result.rows[0], { before: { number: 1, text: 'image: old', kind: 'removed' }, after: { number: 1, text: 'image: new', kind: 'added' } })
  assert.equal(result.rows[1].after, null)
  assert.equal(result.rows[2].before.text, 'end')
})

test('repeated YAML lines preserve the best unchanged alignment', () => {
  const result = diff('a\nb\na\nc', 'a\na\nb\nc')
  assert.equal(result.additions, 1)
  assert.equal(result.deletions, 1)
  assert.equal(reconstruct(result, 'before'), 'a\nb\na\nc')
  assert.equal(reconstruct(result, 'after'), 'a\na\nb\nc')
})

test('blank lines and trailing newlines remain part of the comparison', () => {
  const result = diff('a\n\nb\n', 'a\nb\n\n')
  assert.equal(result.additions, 1)
  assert.equal(result.deletions, 1)
  assert.equal(reconstruct(result, 'before'), 'a\n\nb\n')
  assert.equal(reconstruct(result, 'after'), 'a\nb\n\n')
})

test('empty documents and adding or removing their first line have correct counts', () => {
  assert.deepEqual(diff('', '').rows, [])
  assert.equal(diff('', '').unchanged, true)
  assert.equal(diff('', 'kind: Pod').additions, 1)
  assert.equal(diff('kind: Pod', '').deletions, 1)
  assert.equal(diff('', '\n').additions, 2)
})

test('line endings and markup remain literal content rather than parsed YAML', () => {
  const result = diff('<script>\r\nx: [', '<script>\nx: [')
  assert.equal(result.additions, 1)
  assert.equal(result.deletions, 1)
  assert.equal(reconstruct(result, 'before'), '<script>\r\nx: [')
  assert.equal(reconstruct(result, 'after'), '<script>\nx: [')
})

test('reconstructing either side retains ordering across varied repeated-line inputs', () => {
  const fixtures = [
    ['a\na\nb\na', 'b\na\na\na'],
    ['x\ny\nz', 'z\ny\nx'],
    ['\n\na\n', '\na\n\n'],
    ['one\ntwo\nthree\nfour', 'zero\none\nthree\nfive'],
  ]
  for (const [before, after] of fixtures) {
    const result = diff(before, after)
    assert.equal(reconstruct(result, 'before'), before)
    assert.equal(reconstruct(result, 'after'), after)
    for (const side of ['before', 'after']) {
      const numbers = result.rows.flatMap(row => row[side] ? [row[side].number] : [])
      assert.deepEqual(numbers, Array.from({ length: before && side === 'before' ? before.split('\n').length : after.split('\n').length }, (_, i) => i + 1))
    }
  }
})

test('large unrelated blocks use an explicit bounded fallback and preserve both documents', { timeout: 2000 }, () => {
  const before = Array.from({ length: 1200 }, (_, i) => `old-${i}`).join('\n')
  const after = Array.from({ length: 1200 }, (_, i) => `new-${i}`).join('\n')
  const result = diff(before, after)
  assert.equal(result.approximate, true)
  assert.ok(result.notice)
  assert.equal(result.additions, 1200)
  assert.equal(result.deletions, 1200)
  assert.equal(reconstruct(result, 'before'), before)
  assert.equal(reconstruct(result, 'after'), after)
})

test('long files render a bounded window around the first edit and disclose omissions', { timeout: 2000 }, () => {
  const lines = Array.from({ length: 6000 }, (_, i) => `key-${i}: value`)
  const before = lines.join('\n')
  lines[4000] = 'key-4000: changed'
  const result = diff(before, lines.join('\n'))
  assert.equal(result.approximate, false)
  assert.equal(result.additions, 1)
  assert.equal(result.deletions, 1)
  assert.equal(result.truncated, true)
  assert.ok(result.rows.length <= 2002)
  assert.ok(result.rows.some(row => row.after?.text === 'key-4000: changed'))
  assert.equal(result.rows.reduce((total, row) => total + (row.omitted || 0), 0) + result.rows.filter(row => !row.omitted).length, 6000)
  assert.ok(result.notice)
})

test('oversized input explicitly declines comparison instead of reporting zero changes', { timeout: 2000 }, () => {
  for (const [before, after] of [['x'.repeat(1_100_000), 'changed'], ['x\n'.repeat(13_000), 'changed']]) {
    const result = diff(before, after)
    assert.equal(result.unchanged, false)
    assert.equal(result.truncated, true)
    assert.equal(result.additions, null)
    assert.equal(result.deletions, null)
    assert.ok(result.notice)
    assert.deepEqual(result.rows, [])
  }
})
