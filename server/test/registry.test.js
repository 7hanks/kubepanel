import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'

fs.mkdirSync('.local', { recursive: true })
const dir = fs.mkdtempSync(path.resolve('.local/registry-'))
process.env.DATA_DIR = dir
process.env.DASHBOARD_SECRET = 'registry-test-secret-only-abcdefghijklmnopqrstuvwxyz'
process.env.DASHBOARD_PASSWORD = 'registry-test-password-only'
const registry = await import('../src/registryService.js')
test.after(() => fs.rmSync(dir, { recursive: true, force: true }))

const basic = (username, password) => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
const validAuth = basic('reader', 'test-only-password')
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}
async function withHarbor(handler, run) {
  const requests = []
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization })
    if (handler?.(req, res, server) === true) return
    const pathname = new URL(req.url, 'http://localhost').pathname
    if (pathname === '/api/v2.0/ping') return res.end('Pong')
    if (pathname === '/api/v2.0/systeminfo') return json(res, { harbor_version: 'v2.12.0', registry_url: 'registry.test' })
    if (pathname === '/api/v2.0/users/current/permissions') {
      return req.headers.authorization === validAuth
        ? json(res, [{ resource: '/project/1/repository', action: 'list' }])
        : json(res, { errors: [{ code: 'UNAUTHORIZED', message: 'unauthorized' }] }, 401)
    }
    return json(res, [])
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  try { return await run(`http://127.0.0.1:${server.address().port}`, requests) }
  finally { await new Promise(resolve => server.close(resolve)) }
}

test('Harbor rejects saved wrong credentials even when public connectivity endpoints succeed', async () => {
  await withHarbor(null, async (url, requests) => {
    const r = await registry.addRegistry({ url, username: 'reader', password: 'wrong-test-password' })
    const result = await registry.testRegistry(r.id)
    assert.equal(result.ok, false)
    assert.equal(result.authMode, 'basic')
    assert.equal(result.authenticated, false)
    assert.match(result.message, /账号|密码|认证/)
    assert.equal(registry.listRegistries().find(item => item.id === r.id).health.ok, false)
    assert.ok(requests.some(request => request.url === '/api/v2.0/users/current/permissions'))
    assert.ok(requests.every(request => request.authorization === basic('reader', 'wrong-test-password')))
  })
})

test('Harbor verifies authenticated credentials and keeps a saved secret when editing with a blank password', async () => {
  await withHarbor(null, async url => {
    const r = await registry.addRegistry({ url, username: 'reader', password: 'test-only-password' })
    assert.equal(r.hasPassword, true)
    assert.equal('password' in r, false)
    await registry.updateRegistry(r.id, { name: 'Renamed', password: '' })
    const result = await registry.testRegistry(r.id)
    assert.equal(result.ok, true)
    assert.equal(result.authMode, 'basic')
    assert.equal(result.authenticated, true)
    assert.equal(result.version, 'v2.12.0')
    assert.ok(!fs.readFileSync(path.join(dir, 'registries.json'), 'utf8').includes('test-only-password'))
    await registry.updateRegistry(r.id, { clearPassword: true })
    assert.equal((await registry.testRegistry(r.id)).ok, false)
  })
})

test('Harbor authentication supports a robot account with an empty permission response', async () => {
  await withHarbor((req, res) => {
    if (req.url !== '/api/v2.0/users/current/permissions') return
    json(res, null)
    return true
  }, async url => {
    const r = await registry.addRegistry({ url, username: 'robot$reader', password: 'robot-test-secret' })
    const result = await registry.testRegistry(r.id)
    assert.equal(result.ok, true)
    assert.equal(result.authenticated, true)
  })
})

test('Harbor marks public connectivity without credentials as anonymous', async () => {
  await withHarbor(null, async (url, requests) => {
    const r = await registry.addRegistry({ url })
    const result = await registry.testRegistry(r.id)
    assert.equal(result.ok, true)
    assert.equal(result.authMode, 'anonymous')
    assert.equal(result.authenticated, false)
    assert.match(result.message, /匿名/)
    assert.ok(requests.every(request => request.authorization === undefined))
  })
})

test('Harbor does not browse public data when the saved Basic credentials are invalid', async () => {
  await withHarbor(null, async (url, requests) => {
    const r = await registry.addRegistry({ url, username: 'reader', password: 'wrong-test-password' })
    for (const read of [
      () => registry.listProjects(r.id),
      () => registry.listRepositories(r.id, 'library'),
      () => registry.listArtifacts(r.id, 'library', 'image'),
    ]) await assert.rejects(read(), { status: 401, details: { source: 'harbor', upstreamStatus: 401 } })
    assert.equal(requests.filter(request => !request.url.startsWith('/api/v2.0/users/current/permissions')).length, 0)
  })
})

test('Harbor permission errors retain their upstream identity without exposing the response body', async () => {
  await withHarbor((req, res) => {
    if (!req.url.startsWith('/api/v2.0/projects?')) return
    json(res, { errors: [{ code: 'FORBIDDEN', message: 'private upstream details' }] }, 403)
    return true
  }, async url => {
    const r = await registry.addRegistry({ url, username: 'reader', password: 'test-only-password' })
    await assert.rejects(registry.listProjects(r.id), error => {
      assert.equal(error.status, 403)
      assert.deepEqual(error.details, { source: 'harbor', upstreamStatus: 403 })
      assert.ok(!error.message.includes('private upstream details'))
      return true
    })
  })
})

for (const [name, body, contentType] of [
  ['HTML login page', '<!doctype html><html><body>Login</body></html>', 'text/html'],
  ['malformed JSON', '{not json', 'application/json'],
  ['unexpected JSON object', JSON.stringify({ errors: [{ code: 'UNKNOWN', message: 'unexpected' }] }), 'application/json'],
]) {
  test(`Harbor rejects a ${name} instead of reporting a healthy empty registry`, async () => {
    await withHarbor((req, res) => {
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(body)
      return true
    }, async url => {
      const r = await registry.addRegistry({ url })
      const result = await registry.testRegistry(r.id)
      assert.equal(result.ok, false)
      assert.match(result.message, /Harbor|JSON|响应/)
      for (const read of [
        () => registry.listProjects(r.id),
        () => registry.listRepositories(r.id, 'library'),
        () => registry.listArtifacts(r.id, 'library', 'image'),
      ]) await assert.rejects(read(), { status: 502 })
    })
  })
}

test('Harbor follows bounded same-origin redirects for connectivity and paginated data', async () => {
  await withHarbor((req, res) => {
    if (req.url.startsWith('/prefix/')) {
      res.writeHead(301, { Location: req.url.replace('/prefix', '') })
      res.end('<html>Moved</html>')
      return true
    }
    if (req.url.startsWith('/api/v2.0/projects?')) {
      res.setHeader('X-Total-Count', '21')
      json(res, [{ name: 'library', repo_count: 2, metadata: { public: 'true' } }])
      return true
    }
  }, async (url, requests) => {
    const r = await registry.addRegistry({ url: `${url}/prefix`, username: 'reader', password: 'test-only-password' })
    assert.equal((await registry.testRegistry(r.id)).authenticated, true)
    const result = await registry.listProjects(r.id, { page: 2, pageSize: 10 })
    assert.equal(result.total, 21)
    assert.equal(result.items[0].name, 'library')
    assert.ok(requests.some(request => request.url === '/api/v2.0/projects?page=2&page_size=10&with_detail=true'))
    assert.ok(requests.every(request => request.authorization === validAuth))
  })
})

test('Harbor rejects cross-origin redirects without forwarding credentials', async () => {
  await withHarbor(null, async (destination, received) => {
    await withHarbor((req, res) => {
      res.writeHead(301, { Location: `${destination}/api/v2.0/systeminfo` })
      res.end('<html>Moved</html>')
      return true
    }, async url => {
      const r = await registry.addRegistry({ url, username: 'reader', password: 'test-only-password' })
      const result = await registry.testRegistry(r.id)
      assert.equal(result.ok, false)
      assert.match(result.message, /重定向.*地址|地址.*重定向/)
      await assert.rejects(registry.listProjects(r.id), { status: 502 })
      assert.equal(received.length, 0)
    })
  })
})

test('Harbor rejects redirect loops instead of reporting a successful connection', async () => {
  await withHarbor((req, res) => {
    res.writeHead(302, { Location: req.url })
    res.end()
    return true
  }, async (url, requests) => {
    const r = await registry.addRegistry({ url })
    const result = await registry.testRegistry(r.id)
    assert.equal(result.ok, false)
    assert.match(result.message, /重定向/)
    assert.ok(requests.length <= 5)
  })
})

test('Harbor maps project metadata visibility without treating the string false as public', async () => {
  await withHarbor((req, res) => {
    json(res, [
      { name: 'shared', repo_count: 2, metadata: { public: 'true' } },
      { name: 'private', repo_count: 3, metadata: { public: 'false' } },
      { name: 'legacy-private', public: 'false' },
      { name: 'legacy-public', public: true },
    ])
    return true
  }, async url => {
    const r = await registry.addRegistry({ url })
    const result = await registry.listProjects(r.id)
    assert.deepEqual(result.map(item => [item.name, item.public, item.repoCount]), [
      ['shared', true, 2], ['private', false, 3], ['legacy-private', false, 0], ['legacy-public', true, 0],
    ])
  })
})

test('Harbor preserves nested repository encoding, tags, digest references, and pagination', async () => {
  await withHarbor((req, res) => {
    res.setHeader('X-Total-Count', '3')
    if (req.url.includes('/artifacts?')) {
      json(res, [
        { digest: 'sha256:1234567890abcdef', size: 1024, tags: [{ name: 'latest' }], type: 'IMAGE' },
        { digest: 'sha256:abcdef1234567890', size: 2048, tags: null, type: 'IMAGE' },
      ])
      return true
    }
    json(res, [{ name: 'library/team/image', artifact_count: 2, pull_count: 4 }])
    return true
  }, async (url, requests) => {
    const r = await registry.addRegistry({ url })
    const repositories = await registry.listRepositories(r.id, 'library', { page: 2, pageSize: 10 })
    assert.equal(repositories.items[0].shortName, 'team/image')
    assert.equal(repositories.items[0].artifactCount, 2)
    const artifacts = await registry.listArtifacts(r.id, 'library', 'library/team/image', { page: 2, pageSize: 10 })
    assert.equal(artifacts.total, 3)
    assert.deepEqual(artifacts.items[0].tags, ['latest'])
    assert.deepEqual(artifacts.items[1].tags, [])
    assert.equal(artifacts.items[0].pullRefs[0], `${new URL(url).host}/library/team/image:latest`)
    assert.equal(artifacts.items[1].pullRefs[0], `${new URL(url).host}/library/team/image@sha256:abcdef1234567890`)
    assert.equal(requests[1].url, '/api/v2.0/projects/library/repositories/team%252Fimage/artifacts?page=2&page_size=10&with_tag=true&with_label=false&with_scan_overview=false')
  })
})
