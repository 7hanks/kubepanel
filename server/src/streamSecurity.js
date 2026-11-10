import { can } from './permissions.js'
import { assertResourceAccess } from './access.js'
import { activeStreamAccount } from './auth.js'

export function authorizeStream(account,purpose,{clusterId,namespace,pod}) {
  if(![clusterId,namespace,pod].every(x=>typeof x==='string'&&x.length>0&&x.length<=253)) throw Object.assign(new Error('缺少合法的流连接目标'),{status:400})
  if(!can(account,purpose==='exec'?'pod:exec':'pod:logs')) throw Object.assign(new Error('该账号无日志或终端权限'),{status:403})
  assertResourceAccess(account,{clusterId,namespace,group:'',plural:'pods',verb:'get'})
}
export function watchStream(account,purpose,target,onDenied) {
  const timer=setInterval(()=>{
    try {
      const fresh=activeStreamAccount(account)
      if(!fresh) throw new Error('会话失效')
      authorizeStream(fresh,purpose,target)
    } catch { clearInterval(timer);onDenied() }
  },10000)
  timer.unref?.()
  return ()=>clearInterval(timer)
}
