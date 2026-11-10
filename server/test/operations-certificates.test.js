import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { X509Certificate } from 'node:crypto'
import { rootCertificates } from 'node:tls'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kubepanel-certificates-'))
process.env.DASHBOARD_SECRET = 'certificate-test-secret-not-for-production'
const { certificateExpiry, clusterSummaries, clusterDetail } = await import('../src/clusterService.js')
const { registerCluster, unregisterCluster } = await import('../src/kube.js')
const now = Date.parse('2026-11-09T00:00:00Z')
const day = 24 * 60 * 60 * 1000
const user = { certData: Buffer.from('public certificate fixture').toString('base64') }
const parser = days => bytes => {
  assert.equal(bytes.toString('utf8'), 'public certificate fixture')
  return { validTo: new Date(now + days * day).toUTCString() }
}

test('client certificate expiration reports ISO date and remaining complete days', () => {
  assert.deepEqual(certificateExpiry(user, now, parser(60)), { notAfter: '2027-01-08T00:00:00.000Z', daysRemaining: 60, status: 'valid' })
})

test('client certificate alerts at exactly 30 days and expires at notAfter', () => {
  assert.equal(certificateExpiry(user, now, parser(30)).status, 'expiring')
  assert.equal(certificateExpiry(user, now, parser(30 + 1 / 24)).status, 'valid')
  assert.equal(certificateExpiry(user, now, parser(1 / 24)).daysRemaining, 0)
  assert.equal(certificateExpiry(user, now, parser(0)).status, 'expired')
  const expired = certificateExpiry(user, now, parser(-1 / 24))
  assert.equal(expired.status, 'expired')
  assert.equal(expired.daysRemaining, -1)
})

test('Token, malformed certificate and unparseable expiry all remain unknown without sensitive values', () => {
  const unknown = { notAfter: null, daysRemaining: null, status: 'unknown' }
  assert.deepEqual(certificateExpiry({ token: 'secret token' }, now), unknown)
  assert.deepEqual(certificateExpiry({ certData: 'invalid certificate', keyData: 'secret private key' }, now), unknown)
  assert.deepEqual(certificateExpiry(user, now, () => ({ validTo: 'invalid' })), unknown)
  assert.ok(!JSON.stringify(certificateExpiry(user, now, parser(60))).includes('certificate fixture'))
})

test('default parser reads a real public X509 certificate without file or key access', () => {
  const pem = rootCertificates[0]
  const actual = new X509Certificate(pem)
  const expires = Date.parse(actual.validTo)
  const summary = certificateExpiry({ certData: Buffer.from(pem).toString('base64') }, expires - 31 * day)
  assert.deepEqual(summary, { notAfter: new Date(expires).toISOString(), daysRemaining: 31, status: 'valid' })
})

test('cluster list and detail expose only the certificate summary, including unknown Token mode', async () => {
  const id = 'certificate-summary-fixture'
  registerCluster({ id, name: 'Certificate fixture', request: async () => ({ data: { items: [], resources: [], groups: [] } }), kc: {
    getCurrentCluster: () => ({ server: 'https://fixture.invalid' }), getClusters: () => [], getUsers: () => [],
    getCurrentUser: () => ({ token: 'sensitive token' }), getCurrentContext: () => 'test',
  } })
  try {
    const unknown = { notAfter: null, daysRemaining: null, status: 'unknown' }
    const list = await clusterSummaries(true)
    assert.deepEqual(list.find(c => c.id === id).credentialExpiry, unknown)
    const detail = await clusterDetail(id)
    assert.deepEqual(detail.credentialExpiry, unknown)
    assert.ok(!JSON.stringify(detail).includes('sensitive token'))
  } finally { unregisterCluster(id) }
})
