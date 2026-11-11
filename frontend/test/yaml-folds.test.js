import test from 'node:test'
import assert from 'node:assert/strict'
const {yamlFoldRanges}=await import('../src/utils/yaml-folds.js').catch(()=>({}))
test('field hiding folds only root status and metadata managedFields without rewriting the draft',()=>{
 assert.equal(typeof yamlFoldRanges,'function')
 const text='apiVersion: v1\nmetadata:\n  name: app\n  managedFields:\n    - manager: api\ndata:\n  status: user-value\nstatus:\n  phase: Running\n'
 const ranges=yamlFoldRanges(text,{managed:true,status:true})
 assert.equal(ranges.length,2)
 assert.match(text.slice(ranges[0].from,ranges[0].to),/managedFields:/)
 assert.match(text.slice(ranges[1].from,ranges[1].to),/^status:/)
 assert.equal(yamlFoldRanges(text,{managed:false,status:false}).length,0)
 assert.match(text,/status: user-value/)
})
