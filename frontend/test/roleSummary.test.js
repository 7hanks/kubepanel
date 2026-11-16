import test from 'node:test'
import assert from 'node:assert/strict'

const summary = await import('../src/utils/roleSummary.js').catch(() => ({}))
const objects = [
  { key: 'cluster', label: '集群对象' },
  { key: 'registry', label: '镜像仓库对象' },
]
const actions = [
  { key: 'list', label: '列表' },
  { key: 'detail', label: '详情' },
  { key: 'create', label: '创建' },
  { key: 'update', label: '编辑' },
  { key: 'delete', label: '删除' },
]

test('permission summaries distinguish read access, full management and partial writes', () => {
  assert.equal(typeof summary.permissionGroups, 'function')
  const groups = summary.permissionGroups([
    'cluster:list', 'cluster:detail',
    'registry:list', 'registry:detail', 'registry:create', 'registry:update', 'registry:delete',
  ], objects, actions)
  assert.deepEqual(groups.map(group => [group.label, group.access, group.permissions.map(permission => permission.key)]), [
    ['集群', 'read', ['cluster:list', 'cluster:detail']],
    ['镜像仓库', 'manage', ['registry:list', 'registry:detail', 'registry:create', 'registry:update', 'registry:delete']],
  ])
  assert.equal(summary.permissionGroups(['cluster:update'], objects, actions)[0].access, 'custom')
})

test('permission details retain sensitive codes and unrecognized permissions without duplicate grants', () => {
  assert.equal(typeof summary.permissionGroups, 'function')
  const groups = summary.permissionGroups([
    'cluster:list', 'pod:files:read', 'pod:files:read', 'future:inspect',
  ], objects, actions, [{ key: 'pod:files:read', label: '浏览与下载容器文件' }])
  assert.deepEqual(groups.map(group => [group.key, group.permissions]), [
    ['cluster', [{ key: 'cluster:list', label: '列表' }]],
    ['sensitive', [{ key: 'pod:files:read', label: '浏览与下载容器文件' }]],
    ['other', [{ key: 'future:inspect', label: 'future:inspect' }]],
  ])
  assert.deepEqual(summary.permissionGroups([], objects, actions), [])
})

test('scope summaries keep deny-all distinct from legacy unrestricted scopes and retain every value', () => {
  assert.equal(typeof summary.scopeSummary, 'function')
  assert.deepEqual(summary.scopeSummary().map(field => field.summary), ['全部集群', '全部命名空间', '全部资源'])
  const fields = summary.scopeSummary({ clusters: ['east', 'west'], namespaces: [], resources: ['_core/pods'] })
  assert.deepEqual(fields.map(field => [field.summary, field.values]), [
    ['2 个集群', ['east', 'west']],
    ['无命名空间授权', []],
    ['1 类资源', ['_core/pods']],
  ])
  assert.equal(summary.scopeSummary({ clusters: ['*', 'east'] })[0].summary, '全部集群')
})
