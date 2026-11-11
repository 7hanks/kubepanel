import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'

fs.mkdirSync('.local', { recursive: true })
const dir = fs.mkdtempSync(path.resolve('.local/integrations-'))
process.env.DATA_DIR = dir
process.env.DASHBOARD_SECRET = 'test-secret-only-abcdefghijklmnopqrstuvwxyz'
process.env.DASHBOARD_PASSWORD = 'test-password-only'
const registry = await import('../src/registryService.js')
const monitor = await import('../src/monitorService.js')
test.after(() => fs.rmSync(dir, { recursive: true, force: true }))

test('integration TLS verifies certificates unless explicitly disabled and accepts a private CA', () => {
  for (const options of [registry.registryTlsOptions, monitor.monitorTlsOptions]) {
    assert.equal(typeof options, 'function')
    assert.deepEqual(options({}), { rejectUnauthorized: true })
    assert.deepEqual(options({ insecure: true }), { rejectUnauthorized: false })
    assert.deepEqual(options({ ca: 'private PEM' }), { rejectUnauthorized: true, ca: 'private PEM' })
  }
})

test('corrupt registry or monitor JSON fails closed and cannot be overwritten by adding an entry', async () => {
  for (const [filename, add] of [
    ['registries.json', () => registry.addRegistry({ url: 'https://example.test' })],
    ['monitor.json', () => monitor.createMonitor({ name: 'test', url: 'https://example.test' })],
  ]) {
    const file = path.join(dir, filename)
    fs.writeFileSync(file, '{corrupt')
    await assert.rejects(async () => add(), /配置.*损坏|配置.*读取失败/)
    assert.equal(fs.readFileSync(file, 'utf8'), '{corrupt')
    fs.unlinkSync(file)
  }
})

test('Harbor sends requested pagination and preserves totals while legacy callers receive arrays', async () => {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push(req.url)
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('X-Total-Count', '250')
    res.end(JSON.stringify([{ name: 'library/test', tags: [{ name: 'latest' }] }]))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const r = await registry.addRegistry({ url: `http://127.0.0.1:${server.address().port}` })
    assert.equal(r.insecure, false)
    const projects = await registry.listProjects(r.id, { page: '3', pageSize: '20' })
    assert.equal(projects.total, 250)
    assert.equal(projects.page, 3)
    assert.equal(projects.pageSize, 20)
    assert.equal(projects.items.length, 1)
    await registry.listRepositories(r.id, 'library', { page: 2, pageSize: 10 })
    await registry.listArtifacts(r.id, 'library', 'library/test', { page: 4, pageSize: 5 })
    assert.ok(seen[0].includes('page=3&page_size=20'))
    assert.ok(seen[1].includes('page=2&page_size=10'))
    assert.ok(seen[2].includes('page=4&page_size=5'))
    assert.ok(Array.isArray(await registry.listProjects(r.id)))
    await assert.rejects(registry.listProjects(r.id, { page: 0 }), /分页/)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('Grafana stores explicit TLS configuration and rejects unsafe URL schemes', () => {
  const view = monitor.createMonitor({ name: 'internal', url: 'grafana.example.test', ca: 'PEM' })
  assert.equal(view.instances[0].url, 'https://grafana.example.test')
  assert.equal(view.instances[0].insecure, false)
  assert.equal(view.instances[0].hasCa, true)
  assert.throws(() => monitor.createMonitor({ name: 'unsafe', url: 'file:///secret' }), /地址/)
})

test('integration credentials are encrypted on disk and readable by their server clients', async () => {
  const r = await registry.addRegistry({ url: 'https://private.example.test:8443', password: 'private-password' })
  monitor.createMonitor({ name: 'private', url: 'https://private-grafana.test', token: 'private-token' })
  assert.ok(!fs.readFileSync(path.join(dir, 'registries.json'), 'utf8').includes('private-password'))
  assert.ok(!fs.readFileSync(path.join(dir, 'monitor.json'), 'utf8').includes('private-token'))
  assert.equal(registry.getRegistry(r.id).password, 'private-password')
})

test('Harbor discovery rejects namespace scope escapes before any upstream request', async () => {
  const account = { permissions: ['cluster:list'], scope: { clusters: ['dev'], namespaces: ['team-a'], resources: ['_core/services'] } }
  await assert.rejects(registry.discoverRegistries('dev', 'team-b', { account }), { status: 403 })
})

test('Grafana test connection rejects a bogus service-account token even when Grafana allows anonymous access', async () => {
  const VALID = 'glsa_valid_token'
  // 模拟线上 Grafana：/api/health 公开；/api/search 无论 Token 是否有效都回退到匿名视图返回仪表盘；
  // /api/user 只对有效 Token 返回 200。旧逻辑正是被 health + search 的「假成功」蒙骗。
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization || ''
    res.setHeader('Content-Type', 'application/json')
    if (req.url.startsWith('/api/health')) return res.end(JSON.stringify({ version: '13.3.0', database: 'ok' }))
    if (req.url.startsWith('/api/user')) {
      if (auth === `Bearer ${VALID}`) return res.end(JSON.stringify({ id: 1, login: 'sa-kubepanel' }))
      res.statusCode = 401
      return res.end(JSON.stringify({ message: 'Unauthorized' }))
    }
    if (req.url.startsWith('/api/search')) {
      return res.end(JSON.stringify([{ uid: 'a', title: 'A' }, { uid: 'b', title: 'B' }]))
    }
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    // 随便填的 Token 必须失败，且不能再带出「28 个仪表盘」这类假数据
    const bogus = await monitor.testMonitor({ url, token: '12312asfdadasd' })
    assert.equal(bogus.ok, false)
    assert.match(bogus.message, /Token/)

    // 有效 Token 仍能正常连接并读到仪表盘
    const good = await monitor.testMonitor({ url, token: VALID })
    assert.equal(good.ok, true)
    assert.equal(good.dashboards, 2)
    assert.equal(good.authMode, 'token')

    // 不配置 Token（匿名访问）依旧可用，但明确标注为匿名
    const anon = await monitor.testMonitor({ url })
    assert.equal(anon.ok, true)
    assert.equal(anon.dashboards, 2)
    assert.equal(anon.authMode, 'anonymous')

    // 编辑已保存实例：表单里填了假 Token 要失败，留空沿用已保存的有效 Token 要成功
    const view = monitor.createMonitor({ name: 'edit-case', url, token: VALID })
    const id = view.instances[0].id
    assert.equal((await monitor.testMonitor({ id, url, token: 'garbage' })).ok, false)
    assert.equal((await monitor.testMonitor({ id, url })).ok, true)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
