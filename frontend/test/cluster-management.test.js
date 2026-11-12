import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { reactive, ref, computed, effectScope, watch, nextTick } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createRouter, createMemoryHistory } from 'vue-router'
import {resourceTitle} from '../src/utils/resource-ui.js'
import { navGroups, metaFromRoute } from '../src/config/resources.js'
import { parseNavigationExpansion, visibleNavigationGroups, revealActiveNavigationGroup } from '../src/utils/navigation-groups.js'

const stripImports = text => text.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm, '')
const storage = () => {
  const items = new Map([['kp_cluster', 'old'], ['kp_ns', 'private']])
  return { getItem: key => items.get(key) || null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) }
}
function makeStore(api = {}) {
  const localStorage = storage()
  const source = stripImports(fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8')).replace('export const store =', 'return')
  return { store: Function('reactive', 'api', 'localStorage', source)(reactive, api, localStorage), localStorage }
}
async function makeRouter(clusters, remembered = 'old') {
  const { store, localStorage } = makeStore({ clusters: async () => clusters })
  store.currentClusterId = remembered
  const source = stripImports(fs.readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')).replace('export default router', 'return router')
  const stubViews = routes => routes.map(route => ({ ...route, ...(typeof route.component === 'function' ? { component: {} } : {}), ...(route.children ? { children: stubViews(route.children) } : {}) }))
  const router = Function('createRouter', 'createWebHistory', 'Layout', 'store', 'canAny', 'landingPath', 'refreshSession', 'clearSession', 'confirmContextChange', 'localStorage', source)(options => createRouter({ ...options, routes: stubViews(options.routes) }), createMemoryHistory, {}, store, () => true, () => '/clusters', async () => {}, () => {}, async () => true, localStorage)
  return { router, store, localStorage }
}
function clusterView({ clusters = [], embedded = true, current = 'old', loadError, apiOverrides = {} } = {}) {
  const calls = [], mounted = [], scope = effectScope()
  const { store } = makeStore({ clusters: async () => { if (loadError) throw loadError; return clusters } })
  store.currentClusterId = current
  const { descriptor } = parse(fs.readFileSync(new URL('../src/views/ClusterList.vue', import.meta.url), 'utf8'))
  const source = stripImports(compileScript(descriptor, { id: 'cluster-behavior' }).content).replace('export default', 'return')
  const bindings = { ref, reactive, computed, watch, onMounted: fn => mounted.push(fn), onUnmounted() {}, useRouter: () => ({ push: path => calls.push(path), replace: path => calls.push(path) }), ElMessage: { success() {}, error() {}, warning() {} }, ElMessageBox: { confirm: async () => {} }, Plus: {}, Refresh: {}, Delete: {}, Search: {}, OfficeBuilding: {}, api: { clusters: async () => clusters, removeCluster: async () => {}, addCluster: async () => ({ added: 1 }), ...apiOverrides }, store, can: () => true, cpath: (path, id = store.currentClusterId) => '/c/' + id + path, PlatformLayout: {} }
  const definition = Function(...Object.keys(bindings), source)(...Object.values(bindings))
  const state = scope.run(() => definition.setup({ embedded }, { expose() {} }))
  return { state, store, calls, mount: async () => { for (const fn of mounted) await fn() }, destroy: () => scope.stop() }
}

test('cluster landing uses authorized remembered cluster even when unreachable, else first accessible cluster', async () => {
  for (const [remembered, expected] of [['old', 'old'], ['revoked', 'first']]) {
    const { router, store } = await makeRouter([{ id: 'first', healthy: true }, { id: 'old', healthy: false }], remembered)
    await router.push('/clusters')
    assert.equal(router.currentRoute.value.path, '/c/' + expected + '/overview')
    assert.equal(store.currentClusterId, expected)
  }
})
test('empty accessible cluster list clears stale context and keeps first-import screen', async () => {
  const { router, store } = await makeRouter([])
  await router.push('/clusters')
  assert.equal(router.currentRoute.value.path, '/clusters')
  assert.equal(store.currentClusterId, '')
  assert.equal(store.namespace, 'all')
})
test('unavailable or removed deep-linked cluster falls back before mounting a resource page', async () => {
  const { router, store } = await makeRouter([{ id: 'allowed', healthy: false }])
  await router.push('/c/revoked/overview')
  assert.equal(router.currentRoute.value.path, '/c/allowed/overview')
  assert.equal(store.currentClusterId, 'allowed')
  assert.equal(store.namespace, 'all')
})
test('cluster management is a child route that can render before Kubernetes connects', async () => {
  const { router } = await makeRouter([{ id: 'old', healthy: false }])
  const route = router.resolve('/c/old/clusters')
  assert.equal(route.matched.length, 2)
  assert.equal(route.meta.clusterManagement, true)
  assert.equal(route.matched[1].props.default.embedded, true)
})
test('changing cluster clears namespace while same-cluster resource navigation retains it', () => {
  const { store, localStorage } = makeStore()
  store.setCluster('old')
  assert.equal(store.namespace, 'private')
  store.setCluster('new')
  assert.equal(store.namespace, 'all')
  assert.equal(localStorage.getItem('kp_ns'), 'all')
})
test('restoring a namespace absent from the current authorized namespace list resets to all', async () => {
  const { store } = makeStore({ cluster: async () => ({ namespaces: ['public'] }), discovery: async () => [] })
  await store.init()
  assert.equal(store.namespace, 'all')
})
test('deleting current cluster switches to remaining accessible cluster, deleting last returns onboarding', async () => {
  for (const [clusters, expected] of [[[{ id: 'next', name: 'Next' }], '/c/next/overview'], [[], '/clusters']]) {
    const view = clusterView({ clusters })
    try {
      await view.state.remove({ id: 'old', name: 'Old' })
      assert.deepEqual(view.calls, [expected])
      assert.equal(view.store.currentClusterId, clusters[0]?.id || '')
      assert.equal(view.store.namespace, 'all')
    } finally { view.destroy() }
  }
})
test('successful removal clears the deleted remembered ID even when refreshing the list fails', async () => {
  const view = clusterView({ loadError: new Error('offline') })
  try {
    await view.state.remove({ id: 'old', name: 'Old' })
    assert.equal(view.store.currentClusterId, '')
    assert.equal(view.store.namespace, 'all')
    assert.deepEqual(view.calls, ['/clusters'])
  } finally { view.destroy() }
})
test('first successful import enters overview and management search matches names and IDs', async () => {
  const view = clusterView({ clusters: [{ id: 'prod-id', name: 'Production' }], embedded: false, current: '' })
  try {
    view.state.form.name = 'Production'; view.state.form.kubeconfig = 'config'
    await view.state.submitAdd()
    assert.deepEqual(view.calls, ['/c/prod-id/overview'])
    view.state.search.value = 'PROD-ID'; assert.equal(view.state.filteredClusters.value.length, 1)
    view.state.search.value = 'production'; assert.equal(view.state.filteredClusters.value.length, 1)
    view.state.search.value = 'absent'; assert.equal(view.state.filteredClusters.value.length, 0)
  } finally { view.destroy() }
})
test('creation time displays known dates and an honest placeholder for legacy metadata', async () => {
  const view = clusterView()
  try {
    assert.equal(view.state.createdTime({}), '未记录')
    assert.equal(view.state.createdTime({createdAt:'invalid'}), '未记录')
    assert.equal(view.state.createdTime({createdAt:'2026-11-12T01:00:00Z'}), new Date('2026-11-12T01:00:00Z').toLocaleString('zh-CN', {hour12:false}))
    assert.equal(view.state.createdTime({clusterCreatedAt:'2023-04-05T06:07:08Z',createdAt:'2026-11-12T01:00:00Z'}), new Date('2023-04-05T06:07:08Z').toLocaleString('zh-CN', {hour12:false}))
    assert.equal(view.state.createdTime({clusterCreatedAt:'invalid',createdAt:'2026-11-12T01:00:00Z'}), new Date('2026-11-12T01:00:00Z').toLocaleString('zh-CN', {hour12:false}))
    assert.match(view.state.createdTimeSource({clusterCreatedAt:'2023-04-05T06:07:08Z'}), /kube-system/)
    assert.match(view.state.createdTimeSource({createdAt:'2026-11-12T01:00:00Z'}), /平台导入/)
  } finally { view.destroy() }
})

test('returning from management to an unreachable same-cluster overview or resource page retries and keeps reconnect error visible', async () => {
  for (const target of ['/overview', '/r/_core/v1/pods']) {
    let attempts = 0
    const { store, localStorage } = makeStore({ clusters: async () => [{ id: 'old', healthy: false }], cluster: async () => { attempts++; throw new Error('cluster offline') }, discovery: async () => [] })
    const route = reactive({ params: { clusterId: 'old' }, path: '/c/old/overview', name: 'overview', meta: {} })
    const mounted = [], unmounted = [], scope = effectScope()
    const { descriptor } = parse(fs.readFileSync(new URL('../src/layout/Layout.vue', import.meta.url), 'utf8'))
    const source = stripImports(compileScript(descriptor, { id: 'layout-recovery' }).content).replace('export default', 'return')
    const bindings = { ref, computed, watch, onMounted: fn => mounted.push(fn), onUnmounted: fn => unmounted.push(fn), useRoute: () => route, useRouter: () => ({}), ElMessage: {}, ElMessageBox: {}, Search: {}, OfficeBuilding: {}, Refresh: {}, Timer: {}, QuestionFilled: {}, UserFilled: {}, ArrowDown: {}, store, navGroups, metaFromRoute, resourceTitle, parseNavigationExpansion, visibleNavigationGroups, revealActiveNavigationGroup, confirmContextChange: async () => true, cpath: (path, id = store.currentClusterId) => '/c/' + id + path, api: {}, ChangePasswordDialog: {}, permitCluster: () => true, permitUsers: () => false, permitRegistry: () => false, permitMonitor: () => false, refreshSession: async () => ({}), clearSession() {}, roleName: () => '', can: () => true, canResource: () => true, localStorage }
    const definition = Function(...Object.keys(bindings), source)(...Object.values(bindings))
    scope.run(() => definition.setup({}, { expose() {} }))
    try {
      for (const fn of mounted) await fn()
      await nextTick(); await nextTick()
      assert.equal(store.error, 'cluster offline')
      store.setCluster('old')
      route.path = '/c/old/clusters'; route.meta = { clusterManagement: true }
      await nextTick(); await nextTick(); await nextTick()
      const previousAttempts = attempts
      store.setCluster('old')
      route.path = '/c/old' + target; route.meta = {}
      await nextTick(); await nextTick(); await nextTick()
      assert.ok(attempts > previousAttempts, 'same-ID navigation must retry initialization')
      assert.equal(store.ready, false)
      assert.equal(store.error, 'cluster offline', 'failed retry must retain the reconnect alert')
    } finally { unmounted.forEach(fn => fn()); scope.stop() }
  }
})

function pendingClusterRequests() {
  const requests = []
  const { store } = makeStore({ cluster: () => new Promise((resolve, reject) => requests.push({ resolve, reject })), discovery: async () => [] })
  return { store, requests }
}
test('a delayed earlier initialization failure cannot replace a newer successful forced refresh', async () => {
  const { store, requests } = pendingClusterRequests()
  const oldRequest = store.init()
  const refresh = store.init(true)
  await nextTick()
  requests[1].resolve({ name: 'fresh', namespaces: ['public'] })
  await refresh
  requests[0].reject(new Error('old offline failure'))
  await oldRequest.catch(() => {})
  assert.equal(store.ready, true)
  assert.equal(store.cluster.name, 'fresh')
  assert.equal(store.error, '')
})
test('a delayed earlier initialization success cannot hide the latest forced refresh failure', async () => {
  const { store, requests } = pendingClusterRequests()
  const oldRequest = store.init()
  const refresh = store.init(true)
  await nextTick()
  requests[1].reject(new Error('current offline failure'))
  await refresh.catch(() => {})
  requests[0].resolve({ name: 'stale', namespaces: ['private'] })
  await oldRequest
  assert.equal(store.ready, false)
  assert.equal(store.cluster, null)
  assert.equal(store.error, 'current offline failure')
})
test('same-cluster route initialization shares an ongoing request unless refresh is forced', async () => {
  const { store, requests } = pendingClusterRequests()
  const first = store.init()
  store.setCluster('old')
  const sameRoute = store.init()
  await nextTick()
  assert.equal(requests.length, 1)
  requests[0].resolve({ name: 'one request', namespaces: ['private'] })
  await Promise.all([first, sameRoute])
  assert.equal(store.ready, true)
})
test('switching away and back invalidates requests from the earlier visit to the same cluster ID', async () => {
  const { store, requests } = pendingClusterRequests()
  const earlierVisit = store.init()
  await nextTick()
  store.setCluster('other'); store.setCluster('old')
  requests[0].resolve({ name: 'earlier visit', namespaces: ['private'] })
  await earlierVisit
  assert.equal(store.ready, false)
  assert.equal(store.cluster, null)
})

test('editing a sibling context invalidates the active connection even if list refresh fails', async () => {
  const view = clusterView({loadError:new Error('offline'),apiOverrides:{updateCluster:async()=>({affectedIds:['other','old']})}})
  try {
    view.store.ready=true;view.store.cluster={name:'stale'};view.store.discovery=[{kind:'stale'}]
    view.state.openEdit({id:'other',name:'Other',removable:true})
    await view.state.submitEdit()
    assert.equal(view.store.ready,false)
    assert.equal(view.store.cluster,null)
    assert.deepEqual(view.store.discovery,[])
  } finally { view.destroy() }
})

test('a delayed cluster detail cannot replace the new detail action target', async () => {
  let finishA
  const view = clusterView({apiOverrides:{topPods:async()=>({items:[]}),clusterDetail:id=>id==='a'?new Promise(resolve=>{finishA=resolve}):Promise.resolve({id:'b',name:'B'})}})
  try {
    const old=view.state.openDetail({id:'a',name:'A',removable:true})
    view.state.detailVisible.value=false
    await view.state.openDetail({id:'b',name:'B',removable:true})
    finishA({id:'a',name:'A'})
    await old
    assert.equal(view.state.detail.value.id,'b')
    assert.equal(view.state.detailLoading.value,false)
  } finally { view.destroy() }
})

test('invalidating edited credentials prevents an earlier initialization from restoring stale connection data', async () => {
  const {store,requests}=pendingClusterRequests()
  const earlier=store.init()
  await nextTick()
  store.invalidateConnection()
  requests[0].resolve({name:'old credentials',namespaces:['private']})
  await earlier
  assert.equal(store.ready,false)
  assert.equal(store.cluster,null)
  const fresh=store.init()
  await nextTick()
  assert.equal(requests.length,2)
  requests[1].resolve({name:'fresh credentials',namespaces:['public']})
  await fresh
  assert.equal(store.cluster.name,'fresh credentials')
})
