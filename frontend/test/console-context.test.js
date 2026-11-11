import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parse,compileScript} from '@vue/compiler-sfc'
import {ref,reactive,computed,watch,nextTick,effectScope} from 'vue'
import {createRouter,createMemoryHistory} from 'vue-router'

const stripImports=text=>text.replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*\r?\n/gm,'')
const storage=()=>{const values=new Map([['kp_cluster','dev']]);return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}}
function component(file,bindings={}) {
 const mounted=[],unmounted=[],scope=effectScope()
 const {descriptor}=parse(fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8'))
 const source=stripImports(compileScript(descriptor,{id:'behavior-test'}).content).replace('export default','return')
 const imports={ref,reactive,computed,watch,nextTick,onMounted:fn=>mounted.push(fn),onUnmounted:fn=>unmounted.push(fn),localStorage:storage(),...bindings}
 const definition=Function(...Object.keys(imports),source)(...Object.values(imports))
 const state=scope.run(()=>definition.setup({}, {expose(){}}))
 return {state,mount:async()=>{for(const fn of mounted)await fn()},destroy(){unmounted.forEach(fn=>fn());scope.stop()}}
}
function terminal({getPod,ticket,grant=()=>true}={}) {
 const sockets=[],tickets=[]
 class Socket {static OPEN=1;constructor(url){this.url=url;this.readyState=0;sockets.push(this)}close(){this.readyState=3;this.onclose?.()}send(){} }
 class Term {cols=80;rows=24;loadAddon(){}open(){}focus(){}write(){}onData(){}onResize(){}dispose(){} }
 class Fit {fit(){} }
 const route=reactive({params:{clusterId:'dev',namespace:'team',name:'web'},query:{container:'sidecar',shell:'/bin/bash'}})
 const pod={metadata:{uid:'pod1'},spec:{containers:[{name:'app'},{name:'sidecar'}]}}
 const instance=component('views/PodTerminal.vue',{useRoute:()=>route,useRouter:()=>({back(){}}),can:grant,ArrowLeft:{},Terminal:Term,FitAddon:Fit,ResizeObserver:class{observe(){}disconnect(){}},WebSocket:Socket,ElMessage:{error(){},warning(){}},api:{get:getPod||(async()=>pod),streamTicket:async body=>{tickets.push(body);return ticket?ticket(body):{ticket:'ticket-'+tickets.length}}},execWsUrl:target=>'ws://test/'+JSON.stringify(target)})
 return {...instance,sockets,tickets,route}
}

test('terminal automatically connects once to the validated selection and reconnects dropdown changes',async()=>{
 const terminalView=terminal();try{
  await terminalView.mount();await nextTick()
  assert.equal(terminalView.sockets.length,1)
  assert.match(terminalView.sockets[0].url,/sidecar/)
  assert.match(terminalView.sockets[0].url,/bash/)
  terminalView.sockets[0].readyState=1;terminalView.sockets[0].onopen()
  terminalView.state.shell.value='/bin/sh';await nextTick();await nextTick()
  assert.equal(terminalView.sockets.length,2)
  terminalView.state.disconnect();await nextTick()
  assert.equal(terminalView.sockets.length,2,'manual disconnect must not automatically retry')
 }finally{terminalView.destroy()}
})

test('terminal discards revoked or superseded tickets and callbacks from old sockets',async()=>{
 let allowed=true;const pending=[]
 const terminalView=terminal({grant:()=>allowed,ticket:()=>new Promise(resolve=>pending.push(resolve))})
 try{
  await terminalView.mount();assert.equal(pending.length,1)
  terminalView.state.container.value='app';await nextTick();assert.equal(pending.length,2)
  pending[0]({ticket:'old'});await nextTick();await nextTick();assert.equal(terminalView.sockets.length,0)
  pending[1]({ticket:'current'});await nextTick();await nextTick();assert.equal(terminalView.sockets.length,1)
  const old=terminalView.sockets[0];old.readyState=1;old.onopen()
  terminalView.state.shell.value='/bin/sh';await nextTick();assert.equal(pending.length,3)
  allowed=false;pending[2]({ticket:'revoked'});await nextTick();await nextTick()
  assert.equal(terminalView.sockets.length,1)
  old.onopen();assert.notEqual(terminalView.state.status.value,'open')
 }finally{terminalView.destroy()}
})

test('terminal never opens a socket after unmounting while Pod lookup is pending',async()=>{
 let resolvePod;const terminalView=terminal({getPod:()=>new Promise(resolve=>{resolvePod=resolve})})
 const mounting=terminalView.mount();await nextTick();terminalView.destroy()
 resolvePod({metadata:{uid:'pod1'},spec:{containers:[{name:'sidecar'}]}});await mounting;await nextTick()
 assert.equal(terminalView.tickets.length,0)
 assert.equal(terminalView.sockets.length,0)
})

test('cluster monitor route keeps its cluster layout and requires both monitoring and cluster read permission',async()=>{
 const source=stripImports(fs.readFileSync(new URL('../src/router/index.js',import.meta.url),'utf8')).replace('export default router','return router')
 let permissions=['cluster:list','monitor:list'];const store={setCluster(id){this.currentClusterId=id}}
 const withViewStubs=routes=>routes.map(route=>({...route,...(typeof route.component==='function'?{component:{}}:{}),...(route.children?{children:withViewStubs(route.children)}:{})}))
 const routerFactory=options=>createRouter({...options,routes:withViewStubs(options.routes)})
 const router=Function('createRouter','createWebHistory','Layout','store','canAny','landingPath','refreshSession','clearSession','confirmContextChange','localStorage',source)(routerFactory,createMemoryHistory,{},store,list=>list.some(permission=>permissions.includes(permission)),()=>'/clusters',async()=>{},()=>{},async()=>true,storage())
 const target=router.resolve('/c/dev/monitor')
 assert.equal(target.name,'cluster-monitor')
 assert.equal(target.matched.length,2)
 await router.push('/c/dev/monitor');assert.equal(router.currentRoute.value.path,'/c/dev/monitor');assert.equal(store.currentClusterId,'dev')
 permissions=['monitor:list'];await router.push('/monitor');await router.push('/c/dev/monitor');assert.notEqual(router.currentRoute.value.path,'/c/dev/monitor')
})

test('cluster monitor scopes metrics to the retained namespace and registers one removable refresh listener',async()=>{
 const calls=[],events=new Map(),store=reactive({namespace:'team',currentClusterId:'dev'})
 const route={params:{clusterId:'dev'}}
 const instance=component('views/Monitor.vue',{useRoute:()=>route,store,can:()=>true,PlatformLayout:{},ElMessage:{},ElMessageBox:{},Refresh:{},DataLine:{},TopRight:{},TrendCharts:{},Cpu:{},Coin:{},Odometer:{},Histogram:{},Plus:{},MoreFilled:{},CircleCheck:{},Monitor:{},Collection:{},Delete:{},EditPen:{},Connection:{},window:{addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name,fn)=>{if(events.get(name)===fn)events.delete(name)}},api:{monitor:async()=>({instances:[]}),nodeMetrics:async()=>({items:[]}),podMetrics:async namespace=>{calls.push(namespace);return {items:[]}}}})
 try{
  await instance.mount();assert.equal(instance.state.clusterContext.value,true);assert.deepEqual(calls,['team']);assert.equal(events.size,1)
  store.namespace='qa';await nextTick();await nextTick();assert.deepEqual(calls,['team','qa'])
  await events.get('kp:refresh')();assert.deepEqual(calls,['team','qa','qa'])
 }finally{instance.destroy()}
 assert.equal(events.size,0)
})
