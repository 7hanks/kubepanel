import test from 'node:test'
import assert from 'node:assert/strict'
import * as yaml from 'js-yaml'
const { importYamlDraft } = await import('../src/utils/yaml-import.js').catch(() => ({}))
const baseline = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: app\n  namespace: team\n  resourceVersion: "42"\nspec:\n  containers:\n    - name: app\n      image: nginx:1\n'
const manifest = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: app\nspec:\n  containers:\n    - name: app\n      image: nginx:2\n'

test('import keeps the edited target and current optimistic version with newer local configuration', () => {
  assert.equal(typeof importYamlDraft, 'function')
  const result = yaml.load(importYamlDraft(manifest, baseline))
  assert.equal(result.metadata.namespace, 'team')
  assert.equal(result.metadata.resourceVersion, '42')
  assert.equal(result.spec.containers[0].image, 'nginx:2')
  assert.equal(yaml.load(baseline).spec.containers[0].image, 'nginx:1')
})
test('import cannot change kind, name or namespace of an existing resource', () => {
  assert.equal(typeof importYamlDraft, 'function')
  for (const candidate of [manifest.replace('kind: Pod','kind: Service'), manifest.replace('name: app','name: other'), manifest.replace('name: app','name: app\n  namespace: other')]) {
    assert.throws(() => importYamlDraft(candidate, baseline), /目标|名称|命名空间/)
  }
})
test('create import permits a new name and preserves labels and encoded Secret payload', () => {
  assert.equal(typeof importYamlDraft, 'function')
  const current='apiVersion: v1\nkind: Secret\nmetadata:\n  name: example\n  namespace: team\n'
  const source='apiVersion: v1\nkind: Secret\nmetadata:\n  name: imported\n  labels:\n    env: dev\ndata:\n  password: c2VjcmV0\n'
  const result=yaml.load(importYamlDraft(source,current,{creating:true}))
  assert.equal(result.metadata.name,'imported')
  assert.equal(result.metadata.namespace,'team')
  assert.equal(result.data.password,'c2VjcmV0')
  assert.equal(result.metadata.labels.env,'dev')
})
test('malformed, empty, multi-resource and oversized imports fail without a replacement draft', () => {
  assert.equal(typeof importYamlDraft, 'function')
  for (const source of ['', 'apiVersion: [', 'hello', '[]', manifest+'\n---\n'+manifest, 'x'.repeat(2*1024*1024+1)]) {
    assert.throws(() => importYamlDraft(source,baseline))
  }
})

test('alias expansion and cycles are bounded before serializing an imported draft', () => {
  const bomb = manifest + 'data:\n  a: &a [x,x,x,x,x,x,x,x]\n  b: &b [*a,*a,*a,*a,*a,*a,*a,*a]\n  c: &c [*b,*b,*b,*b,*b,*b,*b,*b]\n  d: &d [*c,*c,*c,*c,*c,*c,*c,*c]\n  e: &e [*d,*d,*d,*d,*d,*d,*d,*d]\n  f: &f [*e,*e,*e,*e,*e,*e,*e,*e]\n'
  assert.throws(() => importYamlDraft(bomb, baseline), /复杂|过大/)
  assert.throws(() => importYamlDraft(manifest+'data: &a [*a]\n', baseline), /复杂|循环/)
  const normal=yaml.load(importYamlDraft(manifest+'data:\n  first: &normal {key: value}\n  second: *normal\n', baseline))
  assert.deepEqual(normal.data.second,{key:'value'})
})
