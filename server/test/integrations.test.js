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
