// Every API response is intercepted. This smoke never reads or writes a real registry or cluster.
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createServer } from '../node_modules/vite/dist/node/index.js'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const frontendRoot = fileURLToPath(new URL('../', import.meta.url))
const qaRoot = fileURLToPath(new URL('../../.local/frontend-qa/', import.meta.url))
const baseURL = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5191').replace(/\/$/, '')
const screenshots = { desktop: path.join(qaRoot, 'registry-project-tags.png'), failure: path.join(qaRoot, 'registry-browser-failure.png') }
const errors = [], unhandledAPI = [], calls = [], navigations = []
let vite, browser, page, rejectProjects = false

const registries = [
  { id: 'team-harbor', name: '团队 Harbor', type: 'harbor', url: 'https://harbor.fixture.invalid:30003', host: 'harbor.fixture.invalid:30003', username: 'fixture-user', health: { ok: true, authenticated: true, authMode: 'basic', message: '连接正常，账号认证通过', ms: 12 } },
  { id: 'public-harbor', name: '公开 Harbor', type: 'harbor', url: 'https://public.fixture.invalid', host: 'public.fixture.invalid', username: '', health: { ok: true, authenticated: false, authMode: 'anonymous', message: '匿名连接正常，仅可访问公开项目', ms: 9 } },
  { id: 'broken-harbor', name: '异常 Harbor', type: 'harbor', url: 'https://broken.fixture.invalid', host: 'broken.fixture.invalid', username: 'fixture-user', health: { ok: false, authenticated: false, authMode: 'basic', message: 'Harbor 账号密码认证失败（401）', ms: 8 } },
]
const host = registries[0].host
const projects = [
  { name: 'library', repoCount: 21, public: true },
  { name: 'tools', repoCount: 1, public: false },
  ...Array.from({ length: 18 }, (_, index) => ({ name: `fixture-project-${index + 1}`, repoCount: 0, public: true })),
  { name: 'archived', repoCount: 1, public: false },
]
const repo = (project, name, artifactCount = 1) => ({ name: `${project}/${name}`, shortName: name, artifactCount, pullCount: 34, updatedAt: '2026-11-13T01:00:00Z', pullRef: `${host}/${project}/${name}` })
const repositories = {
  library: [repo('library', 'web-app', 21), repo('library', 'worker'), ...Array.from({ length: 18 }, (_, index) => repo('library', `service-${index + 1}`)), repo('library', 'archive')],
  tools: [repo('tools', 'builder')],
  archived: [repo('archived', 'snapshot')],
}
function artifact(repository, tags, digestCharacter, size = 48 * 1024 ** 2) {
  const digest = `sha256:${digestCharacter.repeat(Math.ceil(64 / digestCharacter.length)).slice(0, 64)}`
  return { digest, shortDigest: digestCharacter.repeat(12), tags, size, type: 'IMAGE', pushTime: '2026-11-13T01:02:03Z', pullRefs: tags.length ? tags.map(tag => `${host}/${repository}:${tag}`) : [`${host}/${repository}@${digest}`] }
}
const artifacts = {
  'library/web-app': [artifact('library/web-app', ['latest', 'v2.4.1'], 'a'), artifact('library/web-app', [], 'b', 2 * 1024 ** 3), ...Array.from({ length: 18 }, (_, index) => artifact('library/web-app', [`build-${index + 1}`], (index + 16).toString(16))), artifact('library/web-app', ['release-3'], 'c')],
  'library/worker': [artifact('library/worker', ['worker-stable'], 'd')],
  'library/archive': [artifact('library/archive', ['archive-stable'], 'e')],
  'tools/builder': [artifact('tools/builder', ['tools-stable'], 'f')],
  'archived/snapshot': [artifact('archived/snapshot', ['archived-lts'], '1')],
}
function paged(items, search) {
  // Match the real browser/API contract: pageSize=20, with 21 records to exercise page 2.
  const current = Number(search.get('page') || 1), pageSize = Number(search.get('pageSize') || 20)
  return { items: items.slice((current - 1) * pageSize, current * pageSize), total: items.length, page: current, pageSize }
}
async function waitTag(drawer, label) {
  await drawer.locator('.artifact-tags .el-tag').getByText(label, { exact: true }).waitFor()
}
async function clickPage(drawer, label, number) {
  await drawer.locator(`.el-pagination[aria-label="${label}"] .el-pager li.number`).filter({ hasText: new RegExp(`^\\s*${number}\\s*$`) }).click()
}
async function selectProject(label) {
  await page.locator('.project-selector .el-select').filter({ has: page.getByRole('combobox', { name: '选择项目', exact: true }) }).click()
  await page.getByRole('option', { name: label, exact: true }).click()
}
async function assertDrawerFits(drawer) {
  await page.waitForFunction(() => {
    const element = document.querySelector('.registry-drawer')
    if (!element) return false
    const box = element.getBoundingClientRect()
    return box.x >= -1 && box.right <= innerWidth + 1
  })
  const box = await drawer.boundingBox(), viewport = page.viewportSize()
  assert.ok(box.width <= viewport.width + 1, 'drawer must fit the viewport')
  assert.ok(await drawer.locator('.el-drawer__body').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'drawer content must not force horizontal scrolling')
  assert.ok(await drawer.locator('.artifact-item').first().evaluate(element => {
    const box = element.getBoundingClientRect()
    return box.left >= 0 && box.right <= innerWidth + 1
  }), 'artifact metadata and pull commands must fit on mobile')
}

try {
  await mkdir(qaRoot, { recursive: true })
  if (!process.env.SMOKE_BASE_URL) {
    vite = await createServer({ root: frontendRoot, server: { host: '127.0.0.1', port: 5191, strictPort: true } })
    await vite.listen()
  }
  browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const context = await browser.newContext({ viewport: { width: 1651, height: 1240 }, ignoreHTTPSErrors: true })
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    const endpoint = url.pathname.replace(/^\/api/, '')
    const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    calls.push({ method: request.method(), endpoint, params: Object.fromEntries(url.searchParams) })
    if (request.method() === 'GET' && endpoint === '/v1/auth/profile') return send({ username: 'fixture-admin', role: 'admin', permissions: ['registry:list', 'registry:detail', 'registry:create', 'registry:update', 'registry:delete'], csrfToken: 'fixture-csrf', scope: { clusters: ['*'], namespaces: ['*'], resources: ['*'] } })
    if (request.method() === 'GET' && endpoint === '/v1/registries') return send(registries)
    if (request.method() === 'GET' && endpoint === '/v1/registries/team-harbor/projects') {
      if (rejectProjects) return send({ message: 'Harbor 账号密码认证失败（401），请检查账号或机器人密钥', details: { source: 'harbor', upstreamStatus: 401 } }, 401)
      return send(paged(projects, url.searchParams))
    }
    if (request.method() === 'GET' && endpoint === '/v1/registries/team-harbor/repositories') return send(paged(repositories[url.searchParams.get('project')] || [], url.searchParams))
    if (request.method() === 'GET' && endpoint === '/v1/registries/team-harbor/artifacts') return send(paged(artifacts[url.searchParams.get('repository')] || [], url.searchParams))
    unhandledAPI.push(`${request.method()} ${endpoint}`)
    return send({ message: `Unhandled smoke API: ${request.method()} ${endpoint}` }, 500)
  })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(new URL(frame.url()).pathname) })
  await page.goto(`${baseURL}/registries`)
  await page.getByRole('heading', { name: '镜像仓库', exact: true }).waitFor()
  await page.getByRole('button', { name: '团队 Harbor', exact: true }).waitFor()
  const registryNames = page.locator('.registry-name')
  assert.equal(await registryNames.count(), 3)
  await page.locator('.registry-stat').filter({ hasText: '连接异常' }).click()
  await page.getByRole('button', { name: '异常 Harbor', exact: true }).waitFor()
  assert.equal(await registryNames.count(), 1)
  await page.locator('.registry-stat').filter({ hasText: '连接正常' }).click()
  await page.getByRole('button', { name: '公开 Harbor', exact: true }).waitFor()
  assert.equal(await registryNames.count(), 2)
  await page.getByText('匿名访问可用', { exact: true }).waitFor()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await page.getByRole('button', { name: '异常 Harbor', exact: true }).waitFor()
  assert.equal(await registryNames.count(), 3)
  await page.locator('.registry-stat').filter({ hasText: '已配置仓库' }).click()

  await page.getByRole('button', { name: '团队 Harbor', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: '浏览 · 团队 Harbor', exact: true })
  await drawer.waitFor()
  await waitTag(drawer, 'latest')
  await waitTag(drawer, 'v2.4.1')
  assert.equal(await drawer.locator('.artifact-item').count(), 20)
  await drawer.getByText(`sha256:${'a'.repeat(64)}`, { exact: true }).waitFor()
  await drawer.getByText(`docker pull ${host}/library/web-app:latest`, { exact: true }).waitFor()
  await drawer.getByText(`docker pull ${host}/library/web-app:v2.4.1`, { exact: true }).waitFor()
  await drawer.getByText(`docker pull ${host}/library/web-app@sha256:${'b'.repeat(64)}`, { exact: true }).waitFor()
  await drawer.getByText('无标签，可通过 digest 拉取', { exact: true }).waitFor()
  await drawer.locator('.artifact-item').first().getByText('48.0 MiB', { exact: true }).waitFor()
  await drawer.getByText('2.00 GiB', { exact: true }).waitFor()
  assert.ok((await drawer.locator('.artifact-metadata').first().innerText()).includes('2026/11/13'), 'push time is rendered with image metadata')
  // Use the real current-page filter to keep project, repository and image details together in the QA capture.
  const repositoryFilter = drawer.getByRole('textbox', { name: '筛选当前页仓库名', exact: true })
  await repositoryFilter.fill('web-app')
  await page.screenshot({ path: screenshots.desktop, fullPage: true, animations: 'disabled', style: '.el-message{visibility:hidden}' })
  await repositoryFilter.fill('')

  await clickPage(drawer, 'library/web-app 制品分页', 2)
  await waitTag(drawer, 'release-3')
  assert.equal(await drawer.locator('.artifact-tags .el-tag').getByText('latest', { exact: true }).count(), 0)
  await drawer.locator('.el-table__body-wrapper tbody tr').filter({ hasText: 'library/worker' }).getByRole('button', { name: '查看标签', exact: true }).click()
  await waitTag(drawer, 'worker-stable')
  await drawer.getByRole('button', { name: 'library/web-app', exact: true }).click()
  await waitTag(drawer, 'release-3')
  await clickPage(drawer, '仓库分页', 2)
  await waitTag(drawer, 'archive-stable')
  await drawer.getByRole('button', { name: 'library/archive', exact: true }).waitFor()
  assert.equal(await drawer.getByRole('button', { name: 'library/web-app', exact: true }).count(), 0)

  await selectProject('tools（1 个仓库）')
  await waitTag(drawer, 'tools-stable')
  await drawer.getByText('私有项目', { exact: true }).waitFor()
  assert.equal(await drawer.getByRole('button', { name: 'library/archive', exact: true }).count(), 0)
  await clickPage(drawer, '项目分页', 2)
  await waitTag(drawer, 'archived-lts')
  await drawer.getByRole('button', { name: 'archived/snapshot', exact: true }).waitFor()
  await clickPage(drawer, '项目分页', 1)
  await waitTag(drawer, 'latest')

  rejectProjects = true
  await drawer.getByRole('button', { name: '刷新项目', exact: true }).click()
  const projectFailure = drawer.locator('.el-alert').filter({ hasText: 'Harbor 账号密码认证失败（401）' })
  await projectFailure.waitFor()
  assert.equal(await drawer.locator('.artifact-item').count(), 0, 'a failed project refresh clears old image details')
  assert.equal(await drawer.locator('.browser-empty').count(), 0, 'upstream failure must not be shown as an empty success')
  assert.equal(new URL(page.url()).pathname, '/registries')
  assert.ok(!navigations.some(url => url.startsWith('/login')), 'Harbor 401 must not redirect the platform session to login')
  assert.equal(await page.evaluate(() => localStorage.getItem('kp_authenticated')), '1')
  assert.equal(await page.evaluate(() => sessionStorage.getItem('kp_csrf')), 'fixture-csrf')
  rejectProjects = false
  await projectFailure.getByRole('button', { name: '重试', exact: true }).click()
  await waitTag(drawer, 'latest')

  await page.setViewportSize({ width: 430, height: 932 })
  await assertDrawerFits(drawer)
  await drawer.locator('.artifact-item').first().scrollIntoViewIfNeeded()
  await assertDrawerFits(drawer)
  assert.ok(calls.some(call => call.endpoint.endsWith('/projects') && call.params.page === '2'))
  assert.ok(calls.some(call => call.endpoint.endsWith('/repositories') && call.params.project === 'library' && call.params.page === '2'))
  assert.ok(calls.some(call => call.endpoint.endsWith('/artifacts') && call.params.repository === 'library/web-app' && call.params.page === '2'))
  assert.deepEqual(unhandledAPI, [])
  assert.deepEqual(errors, [])
  console.log(`PASS: registry filters, named browsing, initial artifacts, all tags/digests/pull refs, repository and project switching, three pagination levels, isolated Harbor 401 and mobile drawer. Screenshot: ${screenshots.desktop}. API fixtures only.`)
} catch (error) {
  if (page) {
    await page.screenshot({ path: screenshots.failure, fullPage: true, animations: 'disabled' }).catch(() => {})
    console.error('URL:', page.url())
    console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 5000))
  }
  console.error('Browser errors:', errors, 'Unhandled API:', unhandledAPI)
  throw error
} finally {
  await browser?.close()
  await vite?.close()
}
