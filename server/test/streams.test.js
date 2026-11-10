import test from 'node:test'
import assert from 'node:assert/strict'
process.env.DASHBOARD_SECRET='fixture-streams-secret-32-characters'
process.env.DASHBOARD_PASSWORD='Fixture-Stream-2026'
const {authorizeStream}=await import('../src/streamSecurity.js')
const account={permissions:['cluster:list','pod:logs'],scope:{clusters:['dev'],namespaces:['team-a'],resources:['_core/pods']}}
const target={clusterId:'dev',namespace:'team-a',pod:'nginx'}
test('logs and terminal require independent grant and exact authorized target',()=>{
  assert.doesNotThrow(()=>authorizeStream(account,'logs',target))
  assert.throws(()=>authorizeStream(account,'exec',target),{status:403})
  assert.throws(()=>authorizeStream(account,'logs',{...target,clusterId:'prod'}),{status:403})
  assert.throws(()=>authorizeStream(account,'logs',{...target,namespace:'other'}),{status:403})
  assert.throws(()=>authorizeStream(account,'logs',{...target,pod:''}),{status:400})
})
