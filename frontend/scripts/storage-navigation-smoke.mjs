// All application API traffic uses fixtures; no live storage is modified.
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
import {createServer} from '../node_modules/vite/dist/node/index.js'
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const base=process.env.SMOKE_BASE_URL||'http://127.0.0.1:5190'
const vite=process.env.SMOKE_BASE_URL?null:await createServer({root:new URL('../',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),server:{host:'127.0.0.1',port:5190,strictPort:true}})
await vite?.listen()
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1651,height:871}})
page.setDefaultTimeout(12000)
const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message))
const pvc={apiVersion:'v1',kind:'PersistentVolumeClaim',metadata:{name:'data',namespace:'team',uid:'pvc1',resourceVersion:'10',annotations:{custom:'keep'}},spec:{accessModes:['ReadWriteOnce'],resources:{requests:{storage:'10Gi'}},storageClassName:'manual',volumeName:'data-pv',selector:{matchLabels:{disk:'data'}}},status:{phase:'Bound',capacity:{storage:'8Gi'},accessModes:['ReadWriteOnce']}}
const pv={apiVersion:'v1',kind:'PersistentVolume',metadata:{name:'data-pv',uid:'pv1',resourceVersion:'20'},spec:{capacity:{storage:'10Gi'},accessModes:['ReadWriteOnce'],storageClassName:'manual',persistentVolumeReclaimPolicy:'Retain',claimRef:{name:'data',namespace:'team',uid:'pvc1'},nfs:{server:'nfs.internal',path:'/exports/data',readOnly:false},mountOptions:['hard','nfsvers=4.1']},status:{phase:'Bound'}}
const sc={apiVersion:'storage.k8s.io/v1',kind:'StorageClass',metadata:{name:'manual',uid:'sc1',resourceVersion:'30'},provisioner:'nfs.csi.k8s.io',parameters:{server:'nfs.internal',share:'/exports'},reclaimPolicy:'Retain',volumeBindingMode:'WaitForFirstConsumer',allowVolumeExpansion:false,allowedTopologies:[{matchLabelExpressions:[{key:'zone',values:['east']}]}]}
const cm={apiVersion:'v1',kind:'ConfigMap',metadata:{name:'settings',namespace:'team',uid:'cm1',resourceVersion:'40'},data:{key:'old'}}
const resources={persistentvolumeclaims:[pvc],persistentvolumes:[pv],storageclasses:[sc],configmaps:[cm]}
const discovery=[['','persistentvolumeclaims','PersistentVolumeClaim',true],['','persistentvolumes','PersistentVolume',false],['storage.k8s.io','storageclasses','StorageClass',false],['','configmaps','ConfigMap',true]].map(([group,plural,kind,namespaced])=>({group,plural,kind,namespaced,version:'v1',verbs:['get','list','create','update','delete']}))
await page.route('**/api/**',async route=>{
 const req=route.request(),url=new URL(req.url()),path=url.pathname.replace(/^\/api/,'');if(!url.pathname.startsWith('/api/'))return route.continue()
 const send=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)})
 if(path==='/v1/auth/profile')return send({username:'admin',role:'admin',permissions:['*'],csrfToken:'fixture',scope:{clusters:['*'],namespaces:['*'],resources:['*']}})
 if(path==='/v1/clusters')return send([{id:'test',name:'开发集群',healthy:true}])
 if(path==='/v1/cluster')return send({name:'开发集群',version:'v1.33.7',namespaces:['team','default']})
 if(path==='/v1/resources')return send(discovery)
 if(path.startsWith('/v1/resources/')){
  const parts=path.split('/'),plural=parts[5],name=parts[7]
  if(req.method()==='GET')return send(name?resources[plural]?.find(x=>x.metadata.name===decodeURIComponent(name))||{}:{items:resources[plural]||[]})
  const body=req.postDataJSON();writes.push({method:req.method(),plural,body,params:Object.fromEntries(url.searchParams)})
  return send({...body,metadata:{...body.metadata,resourceVersion:'100'}})
 }
 return send({})
})
const root='/c/test/r',footer=()=>page.locator('.editor-footer')
async function check(){await footer().getByRole('button',{name:'服务端预检',exact:true}).click();await page.getByRole('dialog',{name:/预览/}).waitFor();return writes.at(-1).body}
async function closePreview(){const dialog=page.getByRole('dialog',{name:/预览/});await dialog.getByRole('button',{name:'关闭预览',exact:true}).click();await dialog.waitFor({state:'hidden'})}
async function save(){await check();await page.getByRole('dialog',{name:/预览/}).getByRole('button',{name:/^确认(保存|创建)$/}).click();await page.waitForURL(url=>!url.pathname.endsWith('/edit')&&!url.pathname.endsWith('/new'))}
async function select(name,option){await page.locator('.el-select').filter({has:page.getByRole('combobox',{name,exact:true})}).click();await page.getByRole('option',{name:option,exact:true}).click()}
try{
 await page.goto(base+root+'/_core/v1/persistentvolumeclaims')
 await page.getByRole('button',{name:'编辑',exact:true}).click()
 await page.getByRole('heading',{name:'存储申请配置',exact:true}).waitFor()
 assert.equal(await page.getByRole('tab',{name:'YAML',exact:true}).count(),0)
 assert.equal(await page.getByRole('combobox',{name:'存储类选择方式',exact:true}).isDisabled(),true)
 assert.equal(await page.getByRole('textbox',{name:'预绑定持久卷名称',exact:true}).isDisabled(),true)
 assert.deepEqual((await check()).spec,pvc.spec,'opening an existing storage form must not rewrite defaults');await closePreview()
 await page.getByRole('textbox',{name:'存储申请容量',exact:true}).fill('5Gi')
 const before=writes.length;await footer().getByRole('button',{name:'服务端预检',exact:true}).click();assert.equal(writes.length,before)
 await page.getByText('容量不能小于原申请容量 10Gi',{exact:true}).first().waitFor()
 await page.getByRole('textbox',{name:'存储申请容量',exact:true}).fill('20Gi')
 await page.locator('.kp-content').evaluate(el=>el.scrollTop=0);await page.screenshot({path:'.local/frontend-qa/storage-pvc-form.png',fullPage:true,animations:'disabled',style:'.el-message{visibility:hidden}'})
 await save()
 const claimWrite=writes.find(x=>x.method==='PUT'&&x.params.dryRun==='false');assert.equal(claimWrite.body.spec.resources.requests.storage,'20Gi');assert.equal(claimWrite.body.metadata.resourceVersion,'10');assert.deepEqual(claimWrite.body.spec.selector,pvc.spec.selector)
 await page.goto(base+root+'/_core/v1/persistentvolumeclaims/new')
 await page.getByRole('textbox',{name:'资源名称',exact:true}).fill('new-data')
 await page.getByRole('tab',{name:'存储配置',exact:true}).click()
 await select('存储类选择方式','不使用存储类')
 await page.getByRole('textbox',{name:'存储申请容量',exact:true}).fill('2Gi');await save()
 const created=writes.find(x=>x.method==='POST'&&x.params.dryRun==='false');assert.equal(created.body.spec.storageClassName,'');assert.deepEqual(created.body.spec.accessModes,['ReadWriteOnce'])
 await page.goto(base+root+'/_core/v1/persistentvolumes/new')
 await page.getByRole('textbox',{name:'资源名称',exact:true}).fill('new-pv')
 await page.getByRole('tab',{name:'存储配置',exact:true}).click()
 await select('持久卷存储源类型','NFS 共享存储')
 await page.getByRole('textbox',{name:'NFS 服务器',exact:true}).fill('nfs.internal');await page.getByRole('textbox',{name:'NFS 共享路径',exact:true}).fill('/exports/new')
 const createdVolume=await check();assert.equal(createdVolume.spec.nfs.server,'nfs.internal');assert.equal(createdVolume.spec.csi,undefined);await closePreview()
 await page.goto(base+root+'/_core/v1/persistentvolumes/_all/data-pv/edit')
 // page.goto does not trigger the SPA unsaved guard; this fixture has no real writes.
 await page.getByRole('textbox',{name:'NFS 服务器',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'NFS 服务器',exact:true}).isDisabled(),true)
 assert.deepEqual((await check()).spec,pv.spec);await closePreview()
 await select('持久卷回收策略','删除（Delete）');const volumeEdit=await check();assert.equal(volumeEdit.spec.persistentVolumeReclaimPolicy,'Delete');assert.deepEqual(volumeEdit.spec.nfs,pv.spec.nfs);assert.deepEqual(volumeEdit.spec.mountOptions,pv.spec.mountOptions);await closePreview()
 await page.goto(base+root+'/storage.k8s.io/v1/storageclasses/new')
 await page.getByRole('textbox',{name:'资源名称',exact:true}).fill('new-class');await page.getByRole('tab',{name:'存储配置',exact:true}).click()
 assert.equal(await page.getByRole('textbox',{name:'存储供给器',exact:true}).inputValue(),'')
 await page.getByRole('textbox',{name:'存储供给器',exact:true}).fill('nfs.csi.k8s.io');await check();await closePreview()
 await page.goto(base+root+'/storage.k8s.io/v1/storageclasses/_all/manual/edit')
 assert.equal(await page.getByRole('textbox',{name:'存储供给器',exact:true}).isDisabled(),true)
 const untouched=await check();for(const key of ['parameters','allowVolumeExpansion','allowedTopologies'])assert.deepEqual(untouched[key],sc[key]);await closePreview()
 await select('允许存储卷扩容','允许');const classEdit=await check();assert.equal(classEdit.allowVolumeExpansion,true);assert.deepEqual(classEdit.parameters,sc.parameters);assert.deepEqual(classEdit.allowedTopologies,sc.allowedTopologies);await closePreview()
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);await page.locator('.kp-content').evaluate(el=>el.scrollTop=0);await page.screenshot({path:'.local/frontend-qa/storage-mobile.png',fullPage:true,animations:'disabled'});await page.setViewportSize({width:1651,height:871})
 await page.goto(base+root+'/_core/v1/configmaps/team/settings/edit')
 await page.getByRole('tab',{name:'条目模式',exact:true}).click();await page.getByRole('textbox',{name:'配置条目值 1',exact:true}).fill('unsaved')
 await page.getByRole('link',{name:'返回集群概览',exact:true}).click()
 await page.getByRole('dialog',{name:'未保存的修改',exact:true}).getByRole('button',{name:'取消',exact:true}).click()
 await page.getByRole('dialog',{name:'未保存的修改',exact:true}).waitFor({state:'hidden'});assert.ok(page.url().endsWith('/edit'))
 await page.getByRole('link',{name:'返回配置字典列表',exact:true}).click()
 await page.getByRole('dialog',{name:'未保存的修改',exact:true}).getByRole('button',{name:'放弃修改',exact:true}).click()
 await page.waitForURL('**/configmaps');assert.equal(await page.evaluate(()=>localStorage.getItem('kp_ns')),'team')
 await page.goto(base+root+'/_core/v1/persistentvolumeclaims/team/data')
 const details=page.locator('.storage-details');await details.getByRole('heading',{name:'持久卷声明配置',exact:true}).waitFor()
 await details.getByText('实际容量',{exact:true}).waitFor();await details.getByText('8Gi',{exact:true}).first().waitFor()
 await details.getByText('NFS',{exact:true}).waitFor();await details.getByText('/exports/data',{exact:true}).waitFor()
 await page.locator('.kp-content').evaluate(el=>el.scrollTop=0);await page.screenshot({path:'.local/frontend-qa/storage-pvc-detail.png',fullPage:true,animations:'disabled'})
 await details.getByRole('link',{name:'data-pv',exact:true}).first().click();await page.waitForURL('**/persistentvolumes/_all/data-pv')
 await details.getByRole('heading',{name:'持久卷配置',exact:true}).waitFor();await details.getByRole('link',{name:'team / data',exact:true}).waitFor()
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth)
 await page.setViewportSize({width:1651,height:871})
 assert.equal(await page.getByRole('link',{name:'持久卷声明',exact:true}).count(),1)
 await page.getByPlaceholder('搜索菜单 / 资源类型').fill('Deployments');await page.getByRole('link',{name:'部署',exact:true}).waitFor()
 assert.deepEqual(errors,[])
 console.log('PASS: dedicated PVC/PV/StorageClass forms, immutable fields, bound expansion and shrink validation, defaults/unknowns/UID/RV preservation, NFS creation, mobile layout, clickable breadcrumbs and unsaved guard; fixture-only writes.')
}catch(e){console.error('Browser errors',errors);console.error('URL',page.url());console.error((await page.locator('body').innerText()).slice(-5000));await page.screenshot({path:'.local/frontend-qa/storage-navigation-failure.png',fullPage:true});throw e}finally{await browser.close();await vite?.close()}
