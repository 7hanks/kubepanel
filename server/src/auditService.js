import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.js'

const MAX_BYTES = 10 * 1024 * 1024
const fields = ['username','action','clusterId','namespace','resource','name','method','path','status','requestId','durationMs','ip']
export function writeAudit(event) {
  fs.mkdirSync(config.dataDir, {recursive:true,mode:0o700})
  const file = path.join(config.dataDir,'audit.jsonl')
  if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file,`${file}.1`)
  const record = {id:crypto.randomUUID(),time:new Date().toISOString()}
  for (const field of fields) if (event[field] !== undefined) record[field] = typeof event[field] === 'number' ? event[field] : String(event[field]).slice(0,500)
  fs.appendFileSync(file,JSON.stringify(record)+'\n',{mode:0o600})
}
export function listAudit({limit=50,cursor} = {}) {
  const size = Math.min(200,Math.max(1,Number(limit)||50))
  let lines = []
  for (const name of ['audit.jsonl.1','audit.jsonl']) {
    try { lines.push(...fs.readFileSync(path.join(config.dataDir,name),'utf8').split('\n').filter(Boolean)) }
    catch (error) { if(error.code !== 'ENOENT') throw Object.assign(new Error('读取审计日志失败'),{status:503}) }
  }
  const records = lines.map(line => {try {return JSON.parse(line)} catch {return null}}).filter(Boolean).reverse()
  const start = cursor ? records.findIndex(x=>x.id===cursor)+1 : 0
  if (cursor && start === 0) throw Object.assign(new Error('审计分页已过期，请刷新'),{status:400})
  const items = records.slice(start,start+size)
  return {items,nextCursor:start+size<records.length ? items.at(-1)?.id : null}
}
export function auditMiddleware(req,res,next) {
  const started=Date.now()
  req.requestId=crypto.randomUUID()
  res.setHeader('X-Request-Id',req.requestId)
  if (!['GET','HEAD','OPTIONS'].includes(req.method)) res.on('finish',()=>{
    try {
      writeAudit({username:req.account?.username||'anonymous',action:`${req.method} ${req.route?.path||req.path}`,method:req.method,path:req.path,clusterId:req.clusterId||req.query.clusterId,namespace:req.params.namespace,resource:req.params.plural,name:req.params.name,status:res.statusCode,requestId:req.requestId,durationMs:Date.now()-started,ip:req.ip})
    } catch { console.error('[KubePanel] 审计日志写入失败，请检查数据卷空间与权限') }
  })
  next()
}
