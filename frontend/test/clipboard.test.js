import test from 'node:test'
import assert from 'node:assert/strict'
const utils = await import('../src/utils/clipboard.js').catch(() => ({}))
function mockGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { configurable: true, value })
  t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name])
}

test('YAML copy works on an HTTP page without the secure-context Clipboard API', async t => {
  assert.equal(typeof utils.copyText, 'function')
  let copied = '', focused = false
  const editor = { value: '', style: {}, setAttribute() {}, select() {}, remove() {} }
  mockGlobal(t, 'navigator', { clipboard: undefined })
  mockGlobal(t, 'document', { activeElement: { focus() { focused = true } },
    createElement: () => editor, body: { appendChild() {} }, execCommand: command => { assert.equal(command, 'copy'); copied = editor.value; return true } })
  await utils.copyText('apiVersion: v1\nkind: Pod\n')
  assert.equal(copied, 'apiVersion: v1\nkind: Pod\n')
  assert.equal(focused, true)
})

test('copy reports failure when neither browser clipboard mechanism is available', async t => {
  assert.equal(typeof utils.copyText, 'function')
  const editor = { value: '', style: {}, setAttribute() {}, select() {}, remove() {} }
  mockGlobal(t, 'navigator', {})
  mockGlobal(t, 'document', { createElement: () => editor, body: { appendChild() {} }, execCommand: () => false })
  await assert.rejects(utils.copyText('draft'), /复制失败/)
})
