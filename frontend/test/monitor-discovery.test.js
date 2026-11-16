import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

function fixture(overrides = {}, permissions = ['monitor:create'], params = { clusterId: 'selected' }) {
  const scope = Vue.effectScope(), cleanup = [], calls = []
  const store = Vue.reactive({ currentClusterId: 'selected', namespace: 'team', clusters: [{ id: 'selected', name: 'Test' }], loadClusters: async () => {} })
  const api = { discoverGrafanas: async (...args) => { calls.push(args); return { items: [], warnings: [] } }, ...overrides }
  const { descriptor } = parse(fs.readFileSync(new URL('../src/views/Monitor.vue', import.meta.url), 'utf8'))
  const source = compileScript(descriptor, { id: 'monitor' }).content.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm, '').replace('export default', 'return')
  const icons = Object.fromEntries(['Refresh', 'DataLine', 'TopRight', 'TrendCharts', 'Cpu', 'Coin', 'Odometer', 'Histogram', 'Plus', 'MoreFilled', 'CircleCheck', 'Monitor', 'Collection', 'Delete', 'EditPen', 'Connection', 'Search'].map(name => [name, {}]))
  const vueBindings = Object.fromEntries(Object.entries(Vue).filter(([name]) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)))
  const bindings = { ...vueBindings, ...icons, onMounted() {}, onUnmounted: fn => cleanup.push(fn), useRoute: () => ({ params }), api, store,
    can: permission => permissions.includes(permission), PlatformLayout: {}, ElMessage: { success() {}, warning() {}, error() {} }, ElMessageBox: {},
    localStorage: { getItem: () => '', setItem() {}, removeItem() {} }, window: { removeEventListener() {} },
  }
  const component = Function(...Object.keys(bindings), source)(...Object.values(bindings))
  const state = scope.run(() => component.setup({}, { expose() {} }))
  return { state, store, calls, destroy() { cleanup.forEach(fn => fn()); scope.stop() } }
}

test('Grafana scan uses selected cluster and namespace, and shows partial scan warnings', async () => {
  const view = fixture({ discoverGrafanas: async (clusterId, namespace) => { assert.equal(clusterId, 'selected'); assert.equal(namespace, 'team'); return { items: [{ name: 'grafana', namespace: 'team', url: '' }], warnings: ['Ingress 无权读取'] } } })
  try {
    await view.state.openDiscover()
    await view.state.runDiscover()
    assert.equal(view.state.candidates.value.length, 1)
    assert.deepEqual(view.state.discoverWarnings.value, ['Ingress 无权读取'])
  } finally { view.destroy() }
})

test('choosing a Grafana candidate opens an unsaved clean create form', () => {
  let saves = 0
  const view = fixture({ createMonitor: async () => { saves++ } })
  try {
    view.state.form.token = 'old-secret'
    view.state.editing.value = { id: 'old' }
    view.state.useCandidate({ name: 'team/grafana', namespace: 'team', service: 'grafana', url: 'https://grafana.test' })
    assert.equal(view.state.dialogVisible.value, true)
    assert.equal(view.state.editing.value, null)
    assert.equal(view.state.form.name, 'team/grafana')
    assert.equal(view.state.form.url, 'https://grafana.test')
    assert.equal(view.state.form.token, '')
    assert.equal(saves, 0)
  } finally { view.destroy() }
})

test('Grafana scan failures are visible and late responses cannot replace a closed dialog', async () => {
  let complete
  const view = fixture({ discoverGrafanas: () => new Promise(resolve => { complete = resolve }) })
  try {
    await view.state.openDiscover()
    const pending = view.state.runDiscover()
    view.state.discoverVisible.value = false
    await Vue.nextTick()
    complete({ items: [{ name: 'late' }], warnings: [] })
    await pending
    assert.deepEqual(view.state.candidates.value, [])
    assert.equal(view.state.discovering.value, false)
  } finally { view.destroy() }
  const failed = fixture({ discoverGrafanas: async () => { throw new Error('集群连接失败') } })
  try {
    await failed.state.openDiscover()
    await failed.state.runDiscover()
    assert.equal(failed.state.discoverError.value, '集群连接失败')
  } finally { failed.destroy() }
})

test('Grafana discovery actions cannot bypass missing create permission', async () => {
  const view = fixture({}, ['monitor:list'])
  try {
    await view.state.openDiscover()
    await view.state.runDiscover()
    view.state.useCandidate({ name: 'grafana', url: 'https://grafana.test' })
    assert.deepEqual(view.calls, [])
    assert.equal(view.state.dialogVisible.value, false)
  } finally { view.destroy() }
})

test('late cluster refresh failures cannot overlay a successful Grafana scan', async () => {
  let rejectRefresh
  const view = fixture({ discoverGrafanas: async () => ({ items: [{ name: 'team/grafana' }], warnings: [] }) }, ['monitor:create'], {})
  view.store.loadClusters = () => new Promise((_, reject) => { rejectRefresh = reject })
  try {
    const opening = view.state.openDiscover()
    await view.state.runDiscover()
    rejectRefresh(new Error('old cluster refresh failed'))
    await opening
    assert.equal(view.state.discoverError.value, '')
    assert.equal(view.state.discoverScanned.value, true)
    assert.equal(view.state.candidates.value[0].name, 'team/grafana')
  } finally { view.destroy() }
})

test('late cluster refresh failures cannot pollute a reopened Grafana discovery dialog', async () => {
  let rejectRefresh
  const view = fixture({}, ['monitor:create'], {})
  view.store.loadClusters = () => new Promise((_, reject) => { rejectRefresh = reject })
  try {
    const opening = view.state.openDiscover()
    view.state.discoverVisible.value = false
    view.store.loadClusters = async () => {}
    await view.state.openDiscover()
    rejectRefresh(new Error('old cluster refresh failed'))
    await opening
    assert.equal(view.state.discoverError.value, '')
    assert.equal(view.state.discoverVisible.value, true)
  } finally { view.destroy() }
})
