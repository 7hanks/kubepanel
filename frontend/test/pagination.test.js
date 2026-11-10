import test from 'node:test'
import assert from 'node:assert/strict'
const u=await import('../src/utils/pagination.js').catch(()=>({}))
test('Harbor paged objects unwrap items and preserve server totals and page information',()=>{
 assert.equal(typeof u.normalizePage,'function')
 assert.deepEqual(u.normalizePage({items:[{name:'app'}],total:81,page:2,pageSize:20}),{items:[{name:'app'}],total:81,page:2,pageSize:20})
 assert.deepEqual(u.normalizePage([{name:'legacy'}]),{items:[{name:'legacy'}],total:1,page:1,pageSize:20})
 assert.throws(()=>u.normalizePage({message:'bad response'}),/分页响应/)
})
