import test from 'node:test'
import assert from 'node:assert/strict'
const guards=await import('../src/utils/navigation.js').catch(()=>({}))
test('dirty guards can cancel a context change and unregister safely',async()=>{
 assert.equal(typeof guards.registerUnsavedGuard,'function')
 const remove=guards.registerUnsavedGuard(async()=>false)
 assert.equal(await guards.confirmContextChange(),false)
 remove()
 assert.equal(await guards.confirmContextChange(),true)
})
