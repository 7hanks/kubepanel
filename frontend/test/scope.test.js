import test from 'node:test'
import assert from 'node:assert/strict'
const u=await import('../src/utils/scope.js').catch(()=>({}))
test('scope fields accept comma separated tags and preserve empty deny-all scope',()=>{
 assert.equal(typeof u.parseScope,'function')
 assert.deepEqual(u.parseScope({clusters:['east, west'],namespaces:[],resources:['_core/pods, apps/deployments']}),{clusters:['east','west'],namespaces:[],resources:['_core/pods','apps/deployments']})
 assert.throws(()=>u.parseScope({resources:['pods']}),/group\/plural/)
})
test('scope preview protects cluster resources and does not turn empty scope into wildcard',()=>{
 assert.equal(typeof u.scopeAllows,'function')
 const scope={clusters:['east'],namespaces:['app'],resources:['_core/pods']}
 assert.equal(u.scopeAllows(scope,{clusterId:'west',group:'',plural:'pods',namespace:'app',namespaced:true}),false)
 assert.equal(u.scopeAllows(scope,{clusterId:'east',group:'',plural:'pods',namespace:'other',namespaced:true}),false)
 assert.equal(u.scopeAllows(scope,{clusterId:'east',group:'',plural:'pods',namespace:'all',namespaced:true}),true)
 assert.equal(u.scopeAllows({...scope,namespaces:[]},{clusterId:'east',group:'',plural:'pods',namespace:'all',namespaced:true}),false)
 assert.equal(u.scopeAllows(scope,{clusterId:'east',group:'',plural:'nodes',namespaced:false}),false)
})
