import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createRouter, createMemoryHistory } from 'vue-router'
import {resourceTitle} from '../src/utils/resource-ui.js'
import { navGroups, metaFromRoute } from '../src/config/resources.js'
import * as navigationGroups from '../src/utils/navigation-groups.js'
import { createRequestGate } from '../src/utils/resource.js'
import { normalizePage } from '../src/utils/pagination.js'
import { parseScope } from '../src/utils/scope.js'
import {copyText} from '../src/utils/clipboard.js'

const pages = [
  ['audit', 'Audit', '操作审计', 'audit:list'],
  ['users', 'Users', '用户', 'user:list'],
  ['roles', 'Roles', '角色', 'user:list'],
  ['registries', 'Registries', '镜像仓库', 'registry:list'],
]
const read = file => fs.readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')
const stripImports = source => source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm, '')
function fixture({ permissions = ['*'], clusters = [{ id: 'dev', healthy: false }], landing = '/clusters' } = {}) {
  const values = new Map([['kp_cluster', 'dev'], ['kp_ns', 'team']])
  const localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const canAny = list => permissions.includes('*') || list.some(permission => permissions.includes(permission))
  const can = permission => canAny([permission])
  const api = { clusters: async () => clusters }
  const storeSource = stripImports(read('store.js')).replace('export const store =', 'return')
  const store = Function('reactive', 'api', 'localStorage', storeSource)(Vue.reactive, api, localStorage)
  const cpath = (path, id = store.currentClusterId) => '/c/' + encodeURIComponent(id) + path
  const source = stripImports(read('router/index.js')).replace('export default router', 'return router')
  const stubRoutes = routes => routes.map(route => ({ ...route, component: {}, ...(route.children ? { children: stubRoutes(route.children) } : {}) }))
  const router = Function('createRouter', 'createWebHistory', 'Layout', 'store', 'canAny', 'landingPath', 'refreshSession', 'clearSession', 'confirmContextChange', source)(options => createRouter({ ...options, routes: stubRoutes(options.routes) }), createMemoryHistory, {}, store, canAny, () => landing, async () => ({}), () => {}, async () => true)
  return { router, store, localStorage, cpath, can, canAny }
}

// Compile the real SFC render functions; substitute browser-only widgets and API boundaries.
function view(file, context, inlineTemplate = true) {
  const { descriptor } = parse(read(file))
  let source = compileScript(descriptor, { id: file, inlineTemplate }).content
  const empty = { render: () => null }
  const pass = { setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) }
  const permissions = { can: context.can, canCreate: () => false, canUpdate: () => false, canDelete: () => false, canResource: () => true, roleName: () => '', refreshSession: async () => ({}), clearSession() {}, canReadCluster: () => true, canReadUsers: () => true, canReadRegistry: () => true, canReadMonitor: () => true }
  const dependencies = {
    vue: inlineTemplate ? Vue : { ...Vue, onMounted() {}, onUnmounted() {} }, 'vue-router': { useRoute: () => context.route, useRouter: () => context.router },
    'element-plus': { ElMessage: {}, ElMessageBox: {} },
    '@element-plus/icons-vue': new Proxy({}, { get: () => empty }),
    '../store': { store: context.store }, '../api': { default: {} },
    '../utils/perm': permissions,
    '../utils/path': { cpath: context.cpath, CLUSTERS_PATH: '/clusters' },
    '../utils/navigation': { confirmContextChange: async () => true },
    '../utils/navigation-groups': navigationGroups,
    '../utils/resource': { createRequestGate },
    '../utils/pagination': { normalizePage },
    '../utils/scope': { parseScope },
    '../utils/clipboard': {copyText},
    '../config/resources': { navGroups, metaFromRoute },
    '../utils/resource-ui': { resourceTitle },
    '../layout/PlatformLayout.vue': { default: file.endsWith('PlatformLayout.vue') ? empty : view('layout/PlatformLayout.vue', context).component },
    '../components/ChangePasswordDialog.vue': { default: empty },
  }
  source = source.replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, names, name) => {
    if (names.trim().startsWith('{')) return 'const ' + names.replace(/\bas\b/g, ':') + ' = dependencies[' + JSON.stringify(name) + ']'
    return 'const ' + names.trim() + ' = dependencies[' + JSON.stringify(name) + '].default'
  }).replace('export default', 'return')
  const component = Function('dependencies', 'localStorage', source)(dependencies, context.localStorage)
  return { component, descriptor, pass, empty }
}
async function render(file, context, props = {}) {
  const { component, descriptor, pass, empty } = view(file, context)
  const app = Vue.createSSRApp(component, props)
  const templates = [descriptor.template.content, ...['layout/PlatformLayout.vue', ...pages.map(([, file]) => 'views/' + file + '.vue')].map(file => parse(read(file)).descriptor.template.content)]
  const tags = new Set(templates.flatMap(template => [...template.matchAll(/<(el-[\w-]+)/g)].map(match => match[1])))
  for (const tag of tags) app.component(tag, tag === 'el-table-column' || tag === 'el-dialog' ? empty : pass)
  app.component('router-link', { props: ['to'], setup: (props, { slots }) => () => Vue.h('a', { href: props.to }, slots.default?.()) })
  app.component('router-view', { setup: (_, { slots }) => () => slots.default?.({ Component: context.page }) })
  app.directive('loading', {})
  return renderToString(app)
}

test('platform console routes retain cluster and namespace, and standalone URLs remain usable', async () => {
  for (const [path] of pages) {
    const { router, store } = fixture()
    await router.push('/c/dev/' + path)
    assert.equal(router.currentRoute.value.path, '/c/dev/' + path)
    assert.equal(router.currentRoute.value.matched.length, 2)
    assert.equal(router.currentRoute.value.matched[1].props.default.embedded, true)
    assert.equal(store.currentClusterId, 'dev')
    assert.equal(store.namespace, 'team')
    await router.push('/' + path)
    assert.equal(router.currentRoute.value.path, '/' + path)
    assert.equal(router.currentRoute.value.matched.length, 1)
  }
})

test('platform console pages require both page and cluster access; global pages need only page access', async () => {
  for (const [path, , , permission] of pages) {
    const denied = fixture({ permissions: ['cluster:list'] })
    await denied.router.push('/c/dev/' + path)
    assert.equal(denied.router.currentRoute.value.path, '/c/dev/overview')
    const global = fixture({ permissions: [permission], landing: '/' + path })
    await global.router.push('/c/dev/' + path)
    assert.equal(global.router.currentRoute.value.path, '/' + path)
  }
})

test('stale cluster context keeps the requested global page and no-cluster accounts fall back without a redirect loop', async () => {
  for (const [path] of pages) {
    const replaced = fixture({ clusters: [{ id: 'allowed', healthy: false }] })
    await replaced.router.push('/c/removed/' + path + '?scope=global#entries')
    assert.equal(replaced.router.currentRoute.value.fullPath, '/c/allowed/' + path + '?scope=global#entries')
    const empty = fixture({ clusters: [] })
    await empty.router.push('/c/removed/' + path + '?scope=global#entries')
    assert.equal(empty.router.currentRoute.value.fullPath, '/' + path + '?scope=global#entries')
  }
})

test('embedded page content has one console shell and keeps refresh available; standalone pages keep their own shell', async () => {
  for (const [path, file, heading] of pages) {
    const context = fixture()
    context.route = { params: { clusterId: 'dev' }, meta: {}, path: '/c/dev/' + path }
    const embedded = await render('views/' + file + '.vue', context, { embedded: true })
    assert.ok(embedded.includes('<h1>' + heading + '</h1>'))
    assert.ok(!embedded.includes('plat-shell'), 'embedded ' + path + ' must not mount a second shell')
    assert.ok(embedded.includes('刷新'), 'embedded ' + path + ' needs a reachable refresh action')
    const standalone = await render('views/' + file + '.vue', context)
    assert.ok(standalone.includes('plat-shell'), 'standalone ' + path + ' keeps its shell')
  }
})

test('offline console renders platform pages and all platform menu links stay in its cluster', async () => {
  for (const [path, file, heading] of pages) {
    const context = fixture()
    context.route = context.router.resolve('/c/dev/' + path)
    context.store.error = 'Kubernetes offline'
    context.store.ready = false
    context.page = { render: () => Vue.h(view('views/' + file + '.vue', context).component, { embedded: true }) }
    const html = await render('layout/Layout.vue', context)
    assert.ok(html.includes('<h1>' + heading + '</h1>'), path + ' should render while Kubernetes is offline')
    assert.ok(!html.includes('plat-shell'))
    for (const [target] of pages) assert.ok(html.includes('href="/c/dev/' + target + '"'), target + ' must stay in console')
  }
})




test('switching clusters from a platform page keeps that page while namespace controls remain usable', async () => {
  for (const [path] of pages) {
    const context = fixture()
    context.route = context.router.resolve('/c/dev/' + path)
    const destinations = []
    context.router = { push: target => destinations.push(target) }
    const scope = Vue.effectScope()
    const state = scope.run(() => view('layout/Layout.vue', context, false).component.setup({}, { expose() {} }))
    try {
      state.switchCluster('prod')
      assert.deepEqual(destinations, ['/c/prod/' + path])
      assert.equal(state.isActive('/' + path), true)
      await state.changeNs('shared')
      assert.equal(context.store.namespace, 'shared')
    } finally { scope.stop() }
  }
})
