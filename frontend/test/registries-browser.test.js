import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { ref, reactive, computed, watch, effectScope, nextTick } from 'vue'
import { normalizePage } from '../src/utils/pagination.js'
import { createRequestGate } from '../src/utils/resource.js'
import { copyText } from '../src/utils/clipboard.js'

const registry = { id: 'harbor', name: 'Harbor', url: 'https://harbor.test', host: 'harbor.test', health: { ok: true, authenticated: true } }
const project = { name: 'library', repoCount: 1, public: true }
const repository = { name: 'library/app', shortName: 'app', artifactCount: 1, pullCount: 2, pullRef: 'harbor.test/library/app' }
const artifact = { digest: 'sha256:1234', shortDigest: '1234', tags: ['latest', 'v1'], size: 2048, pushTime: '2026-11-13T01:00:00Z', pullRefs: ['harbor.test/library/app:latest', 'harbor.test/library/app:v1'] }
const page = items => ({ items, total: items.length, page: 1, pageSize: 20 })

function fixture(overrides = {},options={}) {
  const scope = effectScope(), cleanup = [], tested = [],writes=[],confirmations=[]
  const api = {
    registries: async () => [registry],
    testRegistry: async id => { tested.push(id); return { ok: true, authenticated: true, ms: 1 } },
    registryProjects: async () => page([project]),
    registryRepositories: async () => page([repository]),
    registryArtifacts: async () => page([artifact]),
    createRegistryProject:async(id,body)=>{writes.push({action:'project',id,body});return {ok:true,project:body.name,public:body.public}},
    createRegistryTag:async(id,body)=>{writes.push({action:'tag',id,body});return {ok:true,...body}},
    removeRegistryTag:async(id,params)=>{writes.push({action:'removeTag',id,params});return {ok:true,...params}},
    removeRegistryArtifact:async(id,params)=>{writes.push({action:'removeArtifact',id,params});return {ok:true,...params}},
    ...overrides,
  }
  const { descriptor } = parse(fs.readFileSync(new URL('../src/views/Registries.vue', import.meta.url), 'utf8'))
  const source = compileScript(descriptor, { id: 'registries' }).content
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm, '')
    .replace('export default', 'return')
  const bindings = {
    ref, reactive, computed, watch, nextTick, normalizePage, createRequestGate, copyText,
    onMounted() {}, onUnmounted: fn => cleanup.push(fn), api,
    canCreate: () => options.write!==false, canUpdate: () => options.write!==false, canDelete: () => options.write!==false,
    ElMessage: { success() {}, error() {}, warning() {},info(){} }, ElMessageBox: {confirm:async(message,title,config)=>{confirmations.push({message,title,config});if(options.confirm)return options.confirm()}},
    useRoute:()=>options.route||{params:{}},useRouter:()=>({resolve:({params})=>({href:'/registries/workspace'+(params.registryId?'/'+encodeURIComponent(params.registryId):'')}),replace:async()=>{}}),
    PlatformLayout: {}, Plus: {}, Refresh: {}, Box: {}, CircleCheck: {}, Warning: {}, MagicStick: {},
  }
  const definition = Function(...Object.keys(bindings), source)(...Object.values(bindings))
  const state = scope.run(() => definition.setup(reactive({ embedded:true,workspace:false,...options.props }), { expose() {} }))
  return { state, tested,writes,confirmations, destroy() { cleanup.forEach(fn => fn()); scope.stop() } }
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

test('explicit tag action refreshes an already selected cached repository',async()=>{
 let reads=0
 const view=fixture({registryArtifacts:async()=>{reads++;return page([artifact])}})
 try{await view.state.browse(registry);assert.equal(reads,1);await view.state.selectRepository(repository,{reveal:true,refresh:true});assert.equal(reads,2)}finally{view.destroy()}
})

test('project creation is explicit, private by default, and selects the new project',async()=>{
 const view=fixture()
 try{await view.state.browse(registry);view.state.openCreateProject();assert.equal(view.state.projectDraft.public,false);assert.deepEqual(view.writes,[]);view.state.projectDraft.name='private-team';await view.state.submitProject();assert.deepEqual(view.writes,[{action:'project',id:'harbor',body:{name:'private-team',public:false,expectedUrl:registry.url}}]);assert.equal(view.state.project.value,'private-team');assert.equal(view.state.currentProject.value.public,false);view.state.openCreateProject();view.state.projectDraft.public=true;view.state.projectDraft.name='public-team';await view.state.submitProject();assert.equal(view.writes.at(-1).body.public,true);view.state.openCreateProject();assert.equal(view.state.projectDraft.public,false)}finally{view.destroy()}
})

test('tag forms pin registry/project/repository/digest and do not mutate before submit',async()=>{
 const view=fixture()
 try{await view.state.browse(registry);view.state.openTag(artifact);assert.deepEqual(view.writes,[]);assert.equal(view.state.tagTarget.value.digest,artifact.digest);view.state.tagDraft.name='release-2';await view.state.submitTag();assert.deepEqual(view.writes,[{action:'tag',id:'harbor',body:{project:'library',repository:'library/app',digest:'sha256:1234',tag:'release-2',expectedUrl:registry.url}}])}finally{view.destroy()}
})

test('read-only accounts cannot open or directly submit mutation controls',async()=>{
 const view=fixture({}, {write:false})
 try{await view.state.browse(registry);view.state.openCreateProject();view.state.openTag(artifact);await view.state.submitProject();await view.state.submitTag();await view.state.deleteArtifact(artifact);await view.state.deleteTag(artifact,'latest');assert.deepEqual(view.writes,[]);assert.equal(view.state.projectDialog.value,false);assert.equal(view.state.tagDialog.value,false);assert.deepEqual(view.confirmations,[])}finally{view.destroy()}
})

test('deleting a tag confirms its exact context and keeps artifact deletion separate',async()=>{
 const view=fixture()
 try{await view.state.browse(registry);await view.state.deleteTag(artifact,'v1');const confirmation=view.confirmations[0];for(const text of ['Harbor','harbor.test','library','library/app','sha256:1234','v1'])assert.ok(confirmation.message.includes(text));assert.notEqual(confirmation.config.dangerouslyUseHTMLString,true);assert.deepEqual(view.writes,[{action:'removeTag',id:'harbor',params:{project:'library',repository:'library/app',digest:'sha256:1234',tag:'v1',expectedUrl:registry.url}}]);await view.state.deleteArtifact(artifact);assert.equal(view.writes.at(-1).action,'removeArtifact');assert.equal(Object.hasOwn(view.writes.at(-1).params,'tag'),false)}finally{view.destroy()}
})

test('writes preserve canonical full names when project names repeat inside repository paths',async()=>{
 const view=fixture({registryRepositories:async()=>page([{...repository,name:'library/library/nested-app'}])})
 try{await view.state.browse(registry);view.state.openTag(artifact);view.state.tagDraft.name='nested';await view.state.submitTag();await view.state.deleteArtifact(artifact);assert.equal(view.writes[0].body.repository,'library/library/nested-app');assert.equal(view.writes[1].params.repository,'library/library/nested-app');assert.equal(view.writes[1].params.expectedUrl,registry.url)}finally{view.destroy()}
})

test('cancelled or context-stale delete confirmations never send destructive requests',async()=>{
 let confirm
 const view=fixture({}, {confirm:()=>new Promise(resolve=>{confirm=resolve})})
 try{await view.state.browse(registry);const pending=view.state.deleteArtifact(artifact);await view.state.browse({...registry,id:'other'});confirm();await pending;assert.deepEqual(view.writes,[])}finally{view.destroy()}
 const cancelled=fixture({}, {confirm:async()=>{throw 'cancel'}})
 try{await cancelled.state.browse(registry);await cancelled.state.deleteTag(artifact,'v1');assert.deepEqual(cancelled.writes,[])}finally{cancelled.destroy()}
})

test('late project creation cannot close or refresh another registry context',async()=>{
 let finish
 const view=fixture({createRegistryProject:()=>new Promise(resolve=>{finish=resolve})})
 try{await view.state.browse(registry);view.state.openCreateProject();view.state.projectDraft.name='new-project';const pending=view.state.submitProject();await view.state.browse({...registry,id:'other'});finish({ok:true,project:'new-project',public:false});await pending;assert.equal(view.state.browseRegistry.value.id,'other');assert.equal(view.state.project.value,'library');assert.equal(view.state.projects.value.some(p=>p.name==='new-project'),false);assert.equal(view.state.projectDialog.value,false)}finally{view.destroy()}
})

test('unknown mutation outcomes stay visible and do not automatically retry',async()=>{
 let calls=0
 const view=fixture({createRegistryTag:async()=>{calls++;throw {message:'connection lost'}}})
 try{await view.state.browse(registry);view.state.openTag(artifact);view.state.tagDraft.name='maybe-created';await view.state.submitTag();assert.equal(calls,1);assert.match(view.state.tagMutationError.value,/结果未确认/);await view.state.submitTag();assert.equal(calls,1);assert.equal(view.state.tagDialog.value,true)}finally{view.destroy()}
})

test('standalone workspace links are internal and explicitly select saved registries',async()=>{
 const view=fixture({}, {props:{workspace:true},route:{params:{registryId:'missing'}}})
 try{assert.equal(view.state.workspaceHref(registry),'/registries/workspace/harbor');assert.equal(view.state.workspaceHref({...registry,id:'a/b'}),'/registries/workspace/a%2Fb');await view.state.load({autoTest:false});await view.state.applyWorkspaceRoute();assert.equal(view.state.browseRegistry.value,null);assert.match(view.state.workspaceError.value,/不可用|不存在/)}finally{view.destroy()}
})

test('shared list/drawer/workspace template compiles',()=>{
 const {descriptor}=parse(fs.readFileSync(new URL('../src/views/Registries.vue',import.meta.url),'utf8'))
 assert.deepEqual(compileTemplate({source:descriptor.template.content,filename:'Registries.vue',id:'registry-workspace'}).errors,[])
})
