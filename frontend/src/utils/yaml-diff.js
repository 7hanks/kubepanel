const MAX_CHARACTERS = 1_000_000
const MAX_LINES = 12_000
const MAX_LCS_CELLS = 1_000_000
const MAX_VISIBLE_ROWS = 2_000

function splitLines(text) {
  if (!text) return []
  let count = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 && ++count > MAX_LINES) return null
  }
  return text.split('\n')
}

/** Literal line comparison; never parses, normalizes, or executes YAML. */
export function yamlLineDiff(before = '', after = '') {
  const unchanged = before === after
  const tooLarge = () => ({
    rows: [], additions: unchanged ? 0 : null, deletions: unchanged ? 0 : null,
    unchanged, approximate: false, truncated: true,
    notice: '内容过大，未展开差异；请缩小 YAML 后核对。',
  })
  if (before.length > MAX_CHARACTERS || after.length > MAX_CHARACTERS) return tooLarge()
  const left = splitLines(before), right = splitLines(after)
  if (!left || !right) return tooLarge()

  let start = 0, leftEnd = left.length, rightEnd = right.length
  while (start < leftEnd && start < rightEnd && left[start] === right[start]) start++
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd--; rightEnd--
  }

  const operations = []
  const equal = (a, b) => operations.push({ kind: 'equal', a, b })
  const remove = a => operations.push({ kind: 'removed', a })
  const add = b => operations.push({ kind: 'added', b })
  for (let i = 0; i < start; i++) equal(i, i)

  const n = leftEnd - start, m = rightEnd - start
  const approximate = n * m > MAX_LCS_CELLS
  if (!n || !m || approximate) {
    for (let i = start; i < leftEnd; i++) remove(i)
    for (let j = start; j < rightEnd; j++) add(j)
  } else {
    // Intern each line once so bounded LCS compares integers even for long lines.
    const ids = new Map()
    const intern = line => {
      if (!ids.has(line)) ids.set(line, ids.size)
      return ids.get(line)
    }
    const a = left.slice(start, leftEnd).map(intern)
    const b = right.slice(start, rightEnd).map(intern)
    const width = m + 1
    const lcs = new Uint16Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        const at = i * width + j
        lcs[at] = a[i] === b[j]
          ? lcs[at + width + 1] + 1
          : Math.max(lcs[at + width], lcs[at + 1])
      }
    }
    let i = 0, j = 0
    while (i < n && j < m) {
      if (a[i] === b[j]) { equal(start + i++, start + j++) }
      else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) remove(start + i++)
      else add(start + j++)
    }
    while (i < n) remove(start + i++)
    while (j < m) add(start + j++)
  }
  for (let a = leftEnd, b = rightEnd; a < left.length; a++, b++) equal(a, b)

  const rows = []
  let additions = 0, deletions = 0
  const cell = (lines, index, kind) => ({ number: index + 1, text: lines[index], kind })
  for (let i = 0; i < operations.length;) {
    const op = operations[i]
    if (op.kind === 'equal') {
      rows.push({ before: cell(left, op.a, 'equal'), after: cell(right, op.b, 'equal') })
      i++
      continue
    }
    const removed = [], added = []
    while (i < operations.length && operations[i].kind !== 'equal') {
      const change = operations[i++]
      if (change.kind === 'removed') { removed.push(change.a); deletions++ }
      else { added.push(change.b); additions++ }
    }
    for (let j = 0; j < Math.max(removed.length, added.length); j++) {
      rows.push({
        before: j < removed.length ? cell(left, removed[j], 'removed') : null,
        after: j < added.length ? cell(right, added[j], 'added') : null,
      })
    }
  }

  const notices = []
  if (approximate) notices.push('差异较大，中间区段按整段新增与删除标记。')
  const truncated = rows.length > MAX_VISIBLE_ROWS
  let visible = rows
  if (truncated) {
    const firstChange = rows.findIndex(row => row.before?.kind === 'removed' || row.after?.kind === 'added')
    const from = Math.max(0, firstChange - 20)
    const to = Math.min(rows.length, from + MAX_VISIBLE_ROWS)
    visible = rows.slice(from, to)
    if (from) visible.unshift({ omitted: from })
    if (to < rows.length) visible.push({ omitted: rows.length - to })
    notices.push(`仅展示 ${to - from} 行，另有 ${rows.length - (to - from)} 行已省略；统计包含全部差异。`)
  }
  return { rows: visible, additions, deletions, unchanged, approximate, truncated, notice: notices.join(' ') }
}
