// Entirely intercepted API fixtures. This never writes to a real cluster.
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
import {load,dump} from 'js-yaml'
import {createServer} from '../node_modules/vite/dist/node/index.js'
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const baseURL=process.env.SMOKE_BASE_URL||'http://127.0.0.1:5188'
const vite=process.env.SMOKE_BASE_URL?null:await createServer({root:new URL('../',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),server:{host:'127.0.0.1',port:5188,strictPort:true}})
await vite?.listen()
const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext({viewport:{width:1651,height:871}}),page=await context.newPage()
page.setDefaultTimeout(12000)
const errors=[],writes=[];let conflict=false,permissions=['*']
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
const deployment={
 apiVersion:'apps/v1',kind:'Deployment',
 metadata:{name:'complex-web',namespace:'team',uid:'d1',resourceVersion:'18',labels:{app:'web'},annotations:{'custom.example/keep':'preserved'}},
 spec:{
  replicas:2,selector:{matchLabels:{app:'web'}},strategy:{type:'RollingUpdate',rollingUpdate:{maxSurge:'40%',maxUnavailable:0}},
  template:{metadata:{labels:{app:'web'}},spec:{
   securityContext:{supplementalGroups:[2000],seccompProfile:{type:'RuntimeDefault'}},
   containers:[{name:'nginx',image:'nginx:1.25-alpine',ports:[{name:'http',containerPort:80,protocol:'TCP'}],livenessProbe:{httpGet:{path:'/health',port:80}},env:[{name:'TOKEN',valueFrom:{secretKeyRef:{name:'credentials',key:'token'}}}],securityContext:{runAsNonRoot:true},resources:{requests:{cpu:'100m',memory:'128Mi','example.com/device':'1'}}}],
   volumes:[{name:'settings',configMap:{name:'settings'}}],
   affinity:{nodeAffinity:{requiredDuringSchedulingIgnoredDuringExecution:{nodeSelectorTerms:[{matchExpressions:[{key:'zone',operator:'In',values:['east']}]}]}}}
  }}
 },status:{readyReplicas:2}
}
let resources={deployments:[structuredClone(deployment)],configmaps:[{apiVersion:'v1',kind:'ConfigMap',metadata:{name:'settings',namespace:'team',uid:'c1',resourceVersion:'21',labels:{},annotations:{'custom.example/keep':'preserved'}},data:{'app.conf':'listen=80\nmode=production\n',empty:''},binaryData:{image:'AAEC'}}],pods:[{apiVersion:'v1',kind:'Pod',metadata:{name:'demo',namespace:'team',uid:'p1',resourceVersion:'3'},spec:{containers:[{name:'app',image:'nginx:1.25'}]},status:{phase:'Running',containerStatuses:[{name:'app',ready:true,restartCount:0,state:{running:{}}}]}}]}
const discovery=[['apps','deployments','Deployment'],['','configmaps','ConfigMap'],['','pods','Pod']].map(([group,plural,kind])=>({group,version:'v1',plural,kind,namespaced:true,verbs:['get','list','create','update','delete']}))
await page.route('**/api/**',async route=>{
 const req=route.request(),url=new URL(req.url()),path=url.pathname.replace(/^\/api/,''),body=req.postDataJSON?.()
 if(!url.pathname.startsWith('/api/'))return route.continue()
 const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
 if(path==='/v1/auth/profile')return send({username:'admin',role:'admin',permissions,csrfToken:'fixture-csrf',scope:{clusters:['*'],namespaces:['*'],resources:['*']}})
 if(path==='/v1/clusters')return send([{id:'test',name:'开发集群',healthy:true}])
 if(path==='/v1/cluster')return send({name:'开发集群',version:'v1.33.7',namespaces:['team','default']})
 if(path==='/v1/resources')return send(discovery)
 if(path.startsWith('/v1/resources/')){
  const parts=path.split('/'),plural=parts[5],name=parts[7]
  if(req.method()==='GET')return send(name?resources[plural]?.find(item=>item.metadata.name===decodeURIComponent(name))||{}:{items:resources[plural]||[]})
  writes.push({method:req.method(),path,body:structuredClone(body),params:Object.fromEntries(url.searchParams)})
  if(req.method()==='PUT'&&conflict&&url.searchParams.get('dryRun')==='false')return send({message:'fixture resource version conflict'},409)
  if(url.searchParams.get('dryRun')==='false'){
   const saved={...body,metadata:{...body.metadata,uid:body.metadata.uid||'created',resourceVersion:'22'}}
   if(req.method()==='POST')resources[plural].push(saved);else resources[plural]=resources[plural].map(item=>item.metadata.name===body.metadata.name?saved:item)
  }
  return send({...body,metadata:{...body.metadata,resourceVersion:'22'}})
 }
 return send({})
})
const footer=()=>page.locator('.editor-footer')
async function assertPreviewFits(){
 await page.waitForFunction(()=>{const el=document.querySelector('.resource-preview-dialog');if(!el)return false;const b=el.getBoundingClientRect();return b.x>=0&&b.y>=0&&b.bottom<=innerHeight+1})
 const box=await page.locator('.resource-preview-dialog').boundingBox(),size=page.viewportSize();assert.ok(box.width<=size.width&&box.height<=size.height)
 const close=page.getByRole('button',{name:'关闭预览',exact:true});await close.waitFor();const bounds=await close.boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=size.height)
}

async function preflight(){await footer().getByRole('button',{name:'服务端预检',exact:true}).click();await page.getByRole('dialog',{name:/预览/}).waitFor();await assertPreviewFits()}
try{
 await page.goto(baseURL+'/c/test/r/apps/v1/deployments')
 await page.getByRole('button',{name:'新建',exact:true}).click()
 await page.getByRole('heading',{name:'新建部署',exact:true}).waitFor()
 await page.getByRole('textbox',{name:'资源名称',exact:true}).fill('created-app')
 await page.getByRole('tab',{name:'容器组模板',exact:true}).click()
 await page.getByRole('textbox',{name:'容器镜像',exact:true}).fill('nginx:1.25-alpine')
 await page.getByRole('button',{name:'添加初始化容器',exact:true}).click()
 await page.getByRole('textbox',{name:'容器镜像',exact:true}).fill('busybox:1.36')
 await preflight()
 await page.setViewportSize({width:900,height:500});await assertPreviewFits();await page.setViewportSize({width:1651,height:871})
 const preview=page.getByRole('dialog',{name:'创建预览',exact:true})
 await preview.getByRole('button',{name:'关闭预览',exact:true}).click()
 await page.getByText('探针、安全上下文和其他容器设置',{exact:true}).click()
 await page.getByRole('textbox',{name:'新字段 container',exact:true}).fill('stdin')
 await page.locator('.el-select').filter({has:page.getByRole('combobox',{name:'字段类型 container',exact:true})}).click()
 await page.getByRole('option',{name:'开关',exact:true}).click()
 await page.getByRole('button',{name:'添加字段',exact:true}).last().click()
 assert.equal(await footer().getByRole('button',{name:'创建',exact:true}).isDisabled(),true)
 await page.getByText('探针、安全上下文和其他容器设置',{exact:true}).click()
 await page.getByRole('textbox',{name:'容器镜像',exact:true}).fill('busybox:1.36.1')
 assert.equal(await footer().getByRole('button',{name:'创建',exact:true}).isDisabled(),true)
 await preflight();await page.getByRole('dialog',{name:'创建预览',exact:true}).getByRole('button',{name:'确认创建',exact:true}).click()
 await page.waitForURL('**/deployments')
 const created=writes.find(item=>item.method==='POST'&&item.params.dryRun==='false')
 assert.equal(created.body.spec.template.spec.initContainers[0].image,'busybox:1.36.1')
 assert.equal(created.body.spec.selector.matchLabels.app,created.body.spec.template.metadata.labels.app)
 const row=page.locator('.el-table__body-wrapper tbody tr').filter({hasText:'complex-web'})
 await row.getByRole('button',{name:'编辑',exact:true}).click()
 await page.getByRole('textbox',{name:'资源名称',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'资源名称',exact:true}).isDisabled(),true)
 assert.equal(await page.locator('.editor-version').count(),0)
 assert.ok(await page.locator('.resource-editor').evaluate(el=>getComputedStyle(el).fontFamily.includes('Microsoft YaHei')))
 await page.getByRole('tab',{name:'部署策略',exact:true}).click()
 await page.getByRole('tab',{name:'容器组模板',exact:true}).click()
 await page.getByRole('button',{name:'容器组',exact:true}).click()
 await preflight()
 assert.deepEqual(writes.at(-1).body.spec,deployment.spec,'mounting strategy and Pod settings must preserve existing spec exactly')
 await page.getByRole('dialog',{name:'变更预览',exact:true}).getByRole('button',{name:'关闭预览',exact:true}).click()
 await page.getByRole('dialog',{name:'变更预览',exact:true}).waitFor({state:'hidden'})
 await page.getByRole('tab',{name:'部署策略',exact:true}).click()
 await page.getByRole('spinbutton',{name:'副本数量',exact:true}).fill('3')
 await page.getByRole('spinbutton',{name:'最大超出副本',exact:true}).fill('30')
 if(!await page.getByRole('checkbox',{name:'自定义保留版本数',exact:true}).isChecked())await page.locator('.el-checkbox').filter({has:page.getByRole('checkbox',{name:'自定义保留版本数',exact:true})}).click()
 await page.getByRole('spinbutton',{name:'保留版本数',exact:true}).fill('8')
 await page.screenshot({path:'.local/frontend-qa/workload-reference-strategy.png',fullPage:true,animations:'disabled'})
 await page.getByRole('tab',{name:'容器组模板',exact:true}).click()
 await page.getByRole('button',{name:'容器组',exact:true}).click()
 await page.getByRole('spinbutton',{name:'优雅终止时长（秒）',exact:true}).fill('45')
 await page.locator('.el-switch').filter({has:page.getByRole('switch',{name:'自定义运行用户 ID',exact:true})}).click()
 await page.getByRole('spinbutton',{name:'运行用户 ID',exact:true}).fill('1001')
 await page.screenshot({path:'.local/frontend-qa/workload-reference-pod.png',fullPage:true,animations:'disabled'})
 await page.getByRole('button',{name:'容器信息',exact:true}).click()
 await page.getByRole('textbox',{name:'容器镜像',exact:true}).fill('nginx:1.26-alpine')
 await page.getByText('资源请求与限制',{exact:true}).click()
 await page.getByRole('textbox',{name:'CPU 请求',exact:true}).fill('200m')
 await page.getByText('探针、安全上下文和其他容器设置',{exact:true}).click()
 await page.getByRole('textbox',{name:'新字段 container',exact:true}).fill('resources')
 await page.getByRole('button',{name:'添加字段',exact:true}).last().click()
 await page.getByText('此字段由专用表单管理，请在对应设置中修改',{exact:true}).waitFor()
 await page.getByText('探针、安全上下文和其他容器设置',{exact:true}).click()
 await page.screenshot({path:'.local/frontend-qa/resource-form-workload.png',fullPage:true,animations:'disabled',style:'.el-message{visibility:hidden}'})
 await preflight();await page.getByRole('dialog',{name:'变更预览',exact:true}).getByRole('button',{name:'确认保存',exact:true}).click()
 await page.waitForURL('**/deployments')
 const edited=writes.find(item=>item.method==='PUT'&&item.params.dryRun==='false')
 assert.deepEqual(edited.body.spec.template.spec.containers[0].livenessProbe,deployment.spec.template.spec.containers[0].livenessProbe)
 assert.deepEqual(edited.body.spec.template.spec.volumes,deployment.spec.template.spec.volumes)
 assert.equal(edited.body.spec.template.spec.containers[0].resources.requests['example.com/device'],'1')
 assert.equal(edited.body.spec.replicas,3);assert.equal(edited.body.spec.strategy.rollingUpdate.maxSurge,'30%');assert.equal(edited.body.spec.revisionHistoryLimit,8)
 assert.equal(edited.body.spec.template.spec.terminationGracePeriodSeconds,45)
 assert.equal(edited.body.spec.template.spec.securityContext.runAsUser,1001)
 assert.deepEqual(edited.body.spec.template.spec.securityContext.supplementalGroups,[2000]);assert.deepEqual(edited.body.spec.template.spec.securityContext.seccompProfile,{type:'RuntimeDefault'})
 assert.deepEqual(edited.body.spec.template.spec.affinity,deployment.spec.template.spec.affinity)
 assert.equal(edited.body.metadata.resourceVersion,'18');assert.equal(edited.body.status,undefined)
 await page.goto(baseURL+'/c/test/r/_core/v1/configmaps')
 await page.getByRole('button',{name:'编辑',exact:true}).click()
 await page.getByRole('button',{name:'添加标签',exact:true}).click()
 await page.getByRole('textbox',{name:'标签键 1',exact:true}).fill('app')
 await page.getByRole('textbox',{name:'标签值 1',exact:true}).fill('settings')
 await page.getByRole('button',{name:'添加标签',exact:true}).click()
 await page.getByRole('textbox',{name:'标签键 2',exact:true}).fill('app')
 const before=writes.length;await footer().getByRole('button',{name:'服务端预检',exact:true}).click();assert.equal(writes.length,before)
 await page.getByText('标签：键名称重复：app',{exact:true}).waitFor()
 await page.getByRole('button',{name:'删除标签 2',exact:true}).click()
 await page.getByRole('tab',{name:'条目模式',exact:true}).click()
 await page.getByRole('textbox',{name:'配置条目值 1',exact:true}).fill('listen=8080\nmode=debug\n')
 await page.getByRole('tab',{name:'标签页模式',exact:true}).click()
 assert.equal(await page.getByRole('textbox',{name:'配置条目值 1',exact:true}).inputValue(),'listen=8080\nmode=debug\n')
 await page.getByRole('button',{name:'添加条目',exact:true}).click()
 await page.getByRole('textbox',{name:'配置条目键 3',exact:true}).fill('extra.conf')
 await page.getByRole('textbox',{name:'配置条目值 3',exact:true}).fill('enabled=true')
 await page.getByRole('button',{name:'app.conf',exact:true}).click()
 await page.getByRole('link',{name:'Deployments',exact:true}).click()
 await page.getByRole('dialog',{name:'未保存的修改',exact:true}).getByRole('button',{name:'取消',exact:true}).click()
 await page.getByRole('dialog',{name:'未保存的修改',exact:true}).waitFor({state:'hidden'})
 await page.waitForURL('**/configmaps/team/settings/edit')
 await page.screenshot({path:'.local/frontend-qa/resource-form-configmap.png',fullPage:true,animations:'disabled',style:'.el-message{visibility:hidden}'})
 assert.equal(await page.getByRole('tab',{name:'YAML',exact:true}).count(),0)
 await page.getByRole('tab',{name:'条目模式',exact:true}).click()
 conflict=true;await preflight();await page.getByRole('dialog',{name:'变更预览',exact:true}).getByRole('button',{name:'确认保存',exact:true}).click()
 await page.getByText('资源版本已变化，草稿已保留。请导出草稿，重新读取并核对修改。',{exact:true}).waitFor()
 assert.equal(await page.getByRole('textbox',{name:'配置条目值 1',exact:true}).inputValue(),'listen=8080\nmode=debug\n')
 assert.equal(await footer().getByRole('button',{name:'保存',exact:true}).isDisabled(),true)
 conflict=false
 await page.setViewportSize({width:430,height:932})
 await page.screenshot({path:'.local/frontend-qa/resource-form-mobile.png',fullPage:true,animations:'disabled',style:'.el-message{visibility:hidden}'})
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
 await preflight();await page.getByRole('dialog',{name:'变更预览',exact:true}).getByRole('button',{name:'确认保存',exact:true}).click();await page.waitForURL('**/configmaps')
 const configCall=writes.filter(item=>item.method==='PUT'&&item.path.includes('/configmaps/')&&item.params.dryRun==='false').at(-1)
 assert.equal(configCall.body.metadata.resourceVersion,'21');assert.equal(configCall.body.data['extra.conf'],'enabled=true');assert.equal(configCall.body.binaryData.image,'AAEC')
 await page.setViewportSize({width:1651,height:871})
 await page.goto(baseURL+'/c/test/r/_core/v1/pods')
 assert.equal(await page.getByRole('button',{name:'日志',exact:true}).count(),0)
 await page.getByRole('button',{name:'更多操作',exact:true}).click()
 for(const label of ['日志','终端','文件浏览器'])await page.getByRole('menuitem',{name:label,exact:true}).waitFor()
 assert.equal(await page.getByRole('menuitem',{name:'编辑 YAML',exact:true}).count(),0)
 await page.screenshot({path:'.local/frontend-qa/resource-form-actions.png',fullPage:true,animations:'disabled',style:'.el-message{visibility:hidden}'})
 assert.deepEqual(errors,[])
 console.log('PASS: form create/edit, complex field preservation, exact preflight, ConfigMap entries/files sync and no YAML tab, duplicate validation, 409 draft retention, mobile and action menu; fixture-only writes.')
}catch(e){await page.screenshot({path:'.local/frontend-qa/workload-reference-failure.png',fullPage:true,animations:'disabled'});console.error('Browser errors',errors);console.error('URL',page.url());console.error((await page.locator('body').innerText()).slice(0,5000));await page.screenshot({path:'.local/frontend-qa/resource-form-failure.png',fullPage:true});throw e}finally{await browser.close();await vite?.close()}
