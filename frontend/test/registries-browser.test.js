import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { ref, reactive, computed, watch, effectScope, nextTick } from 'vue'
import { normalizePage } from '../src/utils/pagination.js'
import { createRequestGate } from '../src/utils/resource.js'
import { copyText } from '../src/utils/clipboard.js'

const registry = { id: 'harbor', name: 'Harbor', url: 'https://harbor.test', host: 'harbor.test', health: { ok: true, authenticated: true } }
const project = { name: 'library', repoCount: 1, public: true }
const repository = { name: 'library/app', shortName: 'app', artifactCount: 1, pullCount: 2, pullRef: 'harbor.test/library/app' }
const artifact = { digest: 'sha256:1234', shortDigest: '1234', tags: ['latest', 'v1'], size: 2048, pushTime: '2026-11-13T01:00:00Z', pullRefs: ['harbor.test/library/app:latest', 'harbor.test/library/app:v1'] }
const page = items => ({ items, total: items.length, page: 1, pageSize: 20 })

function fixture(overrides = {}) {
  const scope = effectScope(), cleanup = [], tested = []
  const api = {
    registries: async () => [registry],
    testRegistry: async id => { tested.push(id); return { ok: true, authenticated: true, ms: 1 } },
    registryProjects: async () => page([project]),
    registryRepositories: async () => page([repository]),
    registryArtifacts: async () => page([artifact]),
    ...overrides,
  }
  const { descriptor } = parse(fs.readFileSync(new URL('../src/views/Registries.vue', import.meta.url), 'utf8'))
  const source = compileScript(descriptor, { id: 'registries' }).content
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm, '')
    .replace('export default', 'return')
  const bindings = {
    ref, reactive, computed, watch, normalizePage, createRequestGate, copyText,
    onMounted() {}, onUnmounted: fn => cleanup.push(fn), api,
    canCreate: () => true, canUpdate: () => true, canDelete: () => true,
    ElMessage: { success() {}, error() {}, warning() {} }, ElMessageBox: {},
    PlatformLayout: {}, Plus: {}, Refresh: {}, Box: {}, CircleCheck: {}, Warning: {}, MagicStick: {},
  }
  const definition = Function(...Object.keys(bindings), source)(...Object.values(bindings))
  const state = scope.run(() => definition.setup({ embedded: true }, { expose() {} }))
  return { state, tested, destroy() { cleanup.forEach(fn => fn()); scope.stop() } }
}

test('saving duplicate registry URLs tests the record returned by the save', async () => {
  const view = fixture({
    addRegistry: async () => ({ ...registry, id: 'new-registry' }),
    registries: async () => [{ ...registry, id: 'old-registry' }, { ...registry, id: 'new-registry' }],
  })
  try {
    view.state.form.url = registry.url
    await view.state.submitForm()
    assert.deepEqual(view.tested, ['new-registry'])
  } finally { view.destroy() }
})

test('opening a registry loads the first repository artifacts without a hidden expand action', async () => {
  const view = fixture()
  try {
    await view.state.browse(registry)
    assert.equal(view.state.selectedRepository.value.name, 'library/app')
    assert.deepEqual(view.state.artifacts['library/app'][0].pullRefs, ['harbor.test/library/app:latest', 'harbor.test/library/app:v1'])
    assert.equal(view.state.artifactPages['library/app'].total, 1)
  } finally { view.destroy() }
})

test('closing the browser clears hierarchy and rejects late project responses', async () => {
  let resolveProjects
  let repositoryCalls = 0
  const view = fixture({
    registryProjects: () => new Promise(resolve => { resolveProjects = resolve }),
    registryRepositories: async () => { repositoryCalls++; return page([repository]) },
  })
  try {
    const pending = view.state.browse(registry)
    view.state.browseVisible.value = false
    await nextTick()
    resolveProjects(page([project]))
    await pending
    assert.equal(view.state.browseRegistry.value, null)
    assert.deepEqual(view.state.projects.value, [])
    assert.equal(repositoryCalls, 0)
  } finally { view.destroy() }
})

test('a repository load failure preserves projects and clears previously shown image details', async () => {
  const view = fixture({ registryRepositories: async (_, name) => {
    if (name === 'private') throw new Error('当前账号无权访问此项目')
    return page([repository])
  } })
  try {
    await view.state.browse(registry)
    view.state.project.value = 'private'
    await view.state.changeProject()
    assert.equal(view.state.repoError.value, '当前账号无权访问此项目')
    assert.equal(view.state.projectError.value, '')
    assert.equal(view.state.projects.value[0].name, 'library')
    assert.equal(view.state.selectedRepository.value, null)
    assert.deepEqual(Object.keys(view.state.artifacts), [])
  } finally { view.destroy() }
})

test('health count filters select configured registry records and can show all records again', () => {
  const view = fixture()
  try {
    view.state.registries.value = [registry, { ...registry, id: 'bad', health: { ok: false } }, { ...registry, id: 'untested', health: null }]
    view.state.registryFilter.value = 'bad'
    assert.deepEqual(view.state.filteredRegistries.value.map(row => row.id), ['bad'])
    view.state.registryFilter.value = 'ok'
    assert.deepEqual(view.state.filteredRegistries.value.map(row => row.id), ['harbor'])
    view.state.registryFilter.value = 'all'
    assert.equal(view.state.filteredRegistries.value.length, 3)
  } finally { view.destroy() }
})

test('late artifact responses cannot replace another registry with the same repository name', async () => {
  let finishArtifact, signalStarted
  const started = new Promise(resolve => { signalStarted = resolve })
  const view = fixture({ registryArtifacts: id => {
    if (id === 'harbor') return new Promise(resolve => { finishArtifact = resolve; signalStarted() })
    return Promise.resolve(page([{ ...artifact, digest: 'sha256:other' }]))
  } })
  try {
    const oldBrowse = view.state.browse(registry)
    await started
    await view.state.browse({ ...registry, id: 'other' })
    finishArtifact(page([artifact]))
    await oldBrowse
    assert.equal(view.state.browseRegistry.value.id, 'other')
    assert.deepEqual(view.state.currentArtifacts.value.map(row => row.digest), ['sha256:other'])
  } finally { view.destroy() }
})

test('pull commands can be copied from an HTTP page without navigator.clipboard', async t => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let copied = ''
  const editor = { value: '', style: {}, setAttribute() {}, select() {}, remove() {} }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => editor, body: { appendChild() {} }, execCommand: () => { copied = editor.value; return true } } })
  t.after(() => {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
    else delete globalThis.navigator
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else delete globalThis.document
  })
  const view = fixture()
  try {
    await view.state.copy('docker pull harbor.test/library/app:v1')
    assert.equal(copied, 'docker pull harbor.test/library/app:v1')
  } finally { view.destroy() }
})
