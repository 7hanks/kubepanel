import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const testRoot = path.resolve(import.meta.dirname, '../../.local/tests')
fs.mkdirSync(testRoot, { recursive: true })
const data = fs.mkdtempSync(path.join(testRoot, 'security-'))
process.env.DATA_DIR = data
process.env.DASHBOARD_SECRET = 'fixture-secret-at-least-thirty-two-characters'
process.env.DASHBOARD_PASSWORD = 'Fixture-Password-2026'
const access = await import('../src/access.js')
const sessions = await import('../src/sessionService.js')
const { sealSecret, openSecret } = await import('../src/secretStore.js')
const { writeAudit, listAudit } = await import('../src/auditService.js')
const {apiPath}=await import('../src/kube.js')

test.after(() => fs.rmSync(data, { recursive: true, force: true }))
const viewer = {username:'dev', permissions:['cluster:list','cluster:detail','cluster:create'], scope:{clusters:['dev'],namespaces:['team-a'],resources:['_core/pods','apps/deployments']}}

test('resource access applies cluster, namespace, GVR and verb conjunctively', () => {
  assert.doesNotThrow(() => access.assertResourceAccess(viewer,{clusterId:'dev',namespace:'team-a',group:'apps',plural:'deployments',verb:'create'}))
  for (const change of [{clusterId:'prod'},{namespace:'team-b'},{namespace:undefined},{plural:'statefulsets'},{verb:'delete'}]) {
    assert.throws(() => access.assertResourceAccess(viewer,{clusterId:'dev',namespace:'team-a',group:'apps',plural:'deployments',verb:'create',...change}), {status:403})
  }
})
test('empty explicit scope denies access and read does not grant Secret visibility', () => {
  assert.throws(() => access.assertClusterAccess({...viewer,scope:{...viewer.scope,clusters:[]}},'dev'), {status:403})
  assert.throws(() => access.assertResourceAccess({...viewer,scope:undefined},{clusterId:'dev',namespace:'default',group:'',plural:'secrets',verb:'get'}), {status:403})
  assert.equal(access.resourceAllowed(viewer,{group:'',plural:'pods'}),true)
  assert.equal(access.resourceAllowed(viewer,{group:'',plural:'secrets'}),false)
})
test('RBAC writes require a distinct sensitive grant', () => {
  const account={permissions:['cluster:update'],scope:undefined}
  const target={clusterId:'dev',namespace:'team-a',group:'rbac.authorization.k8s.io',plural:'rolebindings',verb:'patch'}
  assert.throws(()=>access.assertResourceAccess(account,target),{status:403})
  assert.doesNotThrow(()=>access.assertResourceAccess({...account,permissions:[...account.permissions,'rbac:write']},target))
})
test('generic Node mutations cannot bypass node maintenance permission',()=>{
  const account={permissions:['cluster:update'],scope:{clusters:['dev'],namespaces:['*'],resources:['_core/nodes']}}
  const target={clusterId:'dev',group:'',plural:'nodes',verb:'patch'}
  assert.throws(()=>access.assertResourceAccess(account,target),{status:403})
  assert.doesNotThrow(()=>access.assertResourceAccess({...account,permissions:[...account.permissions,'node:maintain']},target))
})
test('namespace filtering never returns ungranted namespace objects or resources', () => {
  assert.deepEqual(access.filterNamespaces(viewer,[{metadata:{namespace:'team-a'}},{metadata:{namespace:'team-b'}}]),[{metadata:{namespace:'team-a'}}])
  assert.deepEqual(access.filterNamespaces(viewer,['team-a','team-b']),['team-a'])
  assert.throws(()=>access.normalizeScope({namespaces:'*'}),{status:400})
})
test('a real namespace named all cannot be expanded to a cluster-wide API path',()=>{
  assert.equal(apiPath({group:'',version:'v1',plural:'pods',namespace:'all'}),'/api/v1/namespaces/all/pods')
})
test('sessions have persistent revocation, credential binding and exact stream targets', () => {
  const record=sessions.createSession('dev','stamp-a',Date.now()+120000)
  assert.equal(sessions.getSession(record.id,'dev','stamp-a').id,record.id)
  assert.equal(sessions.getSession(record.id,'dev','stamp-b'),null)
  const target={purpose:'exec',clusterId:'dev',namespace:'team-a',pod:'app-1'}
  const ticket=sessions.createStreamTicket(record.id,target)
  assert.equal(sessions.consumeStreamTicket(ticket,{...target,pod:'other'}),null)
  assert.equal(sessions.consumeStreamTicket(ticket,target).id,record.id)
  assert.equal(sessions.consumeStreamTicket(ticket,target),null)
  sessions.revokeSession(record.id)
  assert.equal(sessions.getSession(record.id,'dev','stamp-a'),null)
})
test('encrypted integration credentials roundtrip and plaintext is never written in ciphertext', () => {
  const encrypted=sealSecret('review-secret-value')
  assert.notEqual(encrypted,'review-secret-value')
  assert.equal(encrypted.includes('review-secret-value'),false)
  assert.equal(openSecret(encrypted),'review-secret-value')
  assert.equal(openSecret('legacy-value'),'legacy-value')
  assert.throws(()=>openSecret(encrypted.slice(0,-3)+'bad'))
})
test('audit stores allowed metadata only and paginates newest first', () => {
  writeAudit({username:'dev',action:'update',clusterId:'dev',namespace:'team-a',resource:'secrets',name:'test',status:200,password:'DO-NOT-STORE',body:{data:{token:'DO-NOT-STORE'}}})
  writeAudit({username:'admin',action:'login',status:200})
  const page=listAudit({limit:1})
  assert.equal(page.items.length,1)
  assert.equal(page.items[0].action,'login')
  assert.ok(page.nextCursor)
  assert.equal(listAudit({limit:1,cursor:page.nextCursor}).items[0].action,'update')
  assert.equal(fs.readFileSync(path.join(data,'audit.jsonl'),'utf8').includes('DO-NOT-STORE'),false)
})
