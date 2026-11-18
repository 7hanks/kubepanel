import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRouter,createMemoryHistory} from 'vue-router'

function apiFixture(){
 const calls=[]
 const http={interceptors:{request:{use(){}},response:{use(){}}}}
 for(const method of ['get','post','patch','delete'])http[method]=(...args)=>{calls.push({method,args});return Promise.resolve({ok:true})}
 const source=fs.readFileSync(new URL('../src/api/index.js',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replace(/export default api\s*$/,'return api').replaceAll('export ','')
 const api=Function('axios','ElMessage','uploadFile',source)({create:()=>http},{},()=>{})
 return {api,calls}
}
test('registry mutation API wrappers retain canonical full paths and expected URL guards',async()=>{
 const {api,calls}=apiFixture(),expectedUrl='https://saved.test:30003',target={project:'team',repository:'team/team/nested-app',digest:'sha256:abc',tag:'v2',expectedUrl}
 await api.createRegistryProject('a/b',{name:'private',public:false,expectedUrl},{silent:true})
 await api.createRegistryTag('a/b',target,{silent:true})
 await api.removeRegistryTag('a/b',target,{silent:true})
 const {tag,...artifact}=target;await api.removeRegistryArtifact('a/b',artifact,{silent:true})
 assert.deepEqual(calls,[
  {method:'post',args:['/v1/registries/a%2Fb/projects',{name:'private',public:false,expectedUrl},{silent:true}]},
  {method:'post',args:['/v1/registries/a%2Fb/tags',target,{silent:true}]},
  {method:'delete',args:['/v1/registries/a%2Fb/tags',{silent:true,params:target}]},
  {method:'delete',args:['/v1/registries/a%2Fb/artifacts',{silent:true,params:artifact}]},
 ])
})

function routerFixture(permissions){
 let clusterReads=0
 const source=fs.readFileSync(new URL('../src/router/index.js',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replace('export default router','return router')
 const stub=routes=>routes.map(route=>({...route,component:{},...(route.children?{children:stub(route.children)}:{})}))
 const router=Function('createRouter','createWebHistory','Layout','store','canAny','landingPath','refreshSession','clearSession','confirmContextChange',source)(
  options=>createRouter({...options,routes:stub(options.routes)}),createMemoryHistory,{},
  {loadClusters:async()=>{clusterReads++;return []},setCluster(){}},list=>list.some(permission=>permissions.includes(permission)),()=>'/login',async()=>({}),()=>{},async()=>true,
 )
 return {router,clusterReads:()=>clusterReads}
}
test('standalone registry workspace requires registry read access and no cluster access',async()=>{
 for(const permission of ['registry:list','registry:detail']){
  const view=routerFixture([permission]);await view.router.push('/registries/workspace/saved-harbor')
  assert.equal(view.router.currentRoute.value.name,'registry-workspace');assert.equal(view.router.currentRoute.value.matched.length,1);assert.equal(view.router.currentRoute.value.matched[0].props.default.workspace,true);assert.equal(view.clusterReads(),0)
 }
 const denied=routerFixture(['registry:update']);await denied.router.push('/registries/workspace/saved-harbor');assert.equal(denied.router.currentRoute.value.path,'/login')
})
