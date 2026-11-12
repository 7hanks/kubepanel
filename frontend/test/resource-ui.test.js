import test from 'node:test'
import assert from 'node:assert/strict'
const ui=await import('../src/utils/resource-ui.js').catch(()=>({}))
test('resource labels and scope-aware summaries use user-facing names',()=>{
 assert.equal(ui.resourceTitle({kind:'Service'}),'服务')
 assert.equal(ui.resourceTitle({kind:'ConfigMap'}),'配置字典')
 assert.equal(ui.resourceTitle({kind:'Widget',label:'My Widget'}),'My Widget')
})
test('service filters combine type and inclusive creation-day ranges on loaded rows',()=>{
 const rows=[['a','ClusterIP',12],['b','NodePort',12],['c','ClusterIP',11]].map(([name,type,day])=>({name,type,_raw:{metadata:{creationTimestamp:new Date(2026,10,day,13).toISOString()}}}))
 const range=[new Date(2026,10,12),new Date(2026,10,12)]
 assert.deepEqual(ui.filterResourceRows(rows,{type:'ClusterIP',createdRange:range}).map(row=>row.name),['a'])
 assert.equal(ui.filterResourceRows(rows,{}).length,3)
})
test('service port chips show named/numeric targets and node ports without losing details',()=>{
 assert.equal(ui.servicePortLabel({port:80,targetPort:'http',protocol:'TCP',nodePort:30080}),'80 → http / TCP · 30080')
 assert.equal(ui.servicePortLabel({port:53,protocol:'UDP'}),'53 → 53 / UDP')
})
