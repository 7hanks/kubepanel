export const MAX_BULK_POD_RESTART = 100
const controllers = new Set(['apps/v1/ReplicaSet','apps/v1/StatefulSet','apps/v1/DaemonSet','v1/ReplicationController','batch/v1/Job'])

function snapshot(row, clusterId) {
  const raw = row._raw || row, md = raw.metadata || {}
  const owner = md.ownerReferences?.find(o => o.controller === true && controllers.has(`${o.apiVersion}/${o.kind}`) && o.name && o.uid)
  return Object.freeze({clusterId,namespace:md.namespace || '',name:md.name || '',uid:md.uid || '',
    managed:!!owner,static:Object.hasOwn(md.annotations || {},'kubernetes.io/config.mirror') || md.annotations?.['kubernetes.io/config.source']==='file',
    completed:['Succeeded','Failed'].includes(raw.status?.phase),terminating:!!md.deletionTimestamp})
}

function rejection(target, canRestart) {
  if (!target.clusterId || !target.namespace || !target.name || !target.uid) return '缺少集群、命名空间或原始 UID，请刷新后重新选择'
  if (target.static) return '静态 / 镜像 Pod 不支持重启'
  if (target.completed) return '已完成或已失败的 Pod 不支持重启'
  if (target.terminating) return 'Pod 正在终止，请等待并刷新'
  if (!target.managed) return '没有支持的 controller 控制器，拒绝驱逐'
  if (!canRestart(target)) return '没有此命名空间的更新和删除权限'
  return ''
}

/** A one-use, sequential batch. Nothing here resolves a name against a later UI context. */
export function createBulkPodRestart({pods,clusterId,canRestart,request,isContextCurrent=()=>true,state={}}) {
  if (!pods?.length) throw new Error('请先选择 Pod')
  if (pods.length > MAX_BULK_POD_RESTART) throw new Error(`一次最多重启 ${MAX_BULK_POD_RESTART} 个已选 Pod，请缩小选择范围`)
  const seen = new Set()
  Object.assign(state,{phase:'idle',busy:false,stopped:false,rows:pods.map(pod=>{
    const target=snapshot(pod,clusterId),key=`${target.namespace}/${target.name}`
    const message=seen.has(key) ? '重复目标，已跳过' : rejection(target,canRestart)
    seen.add(key)
    return {target,status:message?'blocked':'pending',message:message || '等待服务端预检'}
  })})
  let controller
  function stop() {
    state.stopped=true;controller?.abort()
    for(const row of state.rows) {
      if(row.status==='submitting'){row.status='unknown';row.message='已停止等待；在途驱逐结果未知，请刷新核对，已提交的操作无法撤销'}
      else if(['pending','checking','passed'].includes(row.status)){row.status='cancelled';row.message='已停止，未继续提交'}
    }
  }
  function current() { if(!isContextCurrent()){stop();return false} return !state.stopped }
  async function run(dryRun) {
    if(state.busy || !current() || (dryRun ? state.phase!=='idle' : state.phase!=='ready'))return
    state.busy=true;state.phase=dryRun?'checking':'submitting'
    try {
      for(const row of state.rows) {
        if(!current()) break
        if(row.status!==(dryRun?'pending':'passed'))continue
        const denied=rejection(row.target,canRestart)
        if(denied){row.status='blocked';row.message=denied;continue}
        controller=new AbortController();row.status=dryRun?'checking':'submitting'
        row.message=dryRun?'正在服务端 dry-run…':'正在提交驱逐…'
        try {
          const result=await request(row.target.namespace,row.target.name,{dryRun,uid:row.target.uid,clusterId:row.target.clusterId,signal:controller.signal})
          if(result?.ok!==true || result.dryRun!==dryRun)throw new Error('服务端未返回明确成功结果')
          if(dryRun) { if(current()){row.status='passed';row.message=result.message || '服务端预检通过'} }
          else {row.status='submitted';row.message=result.message || '已提交驱逐，等待控制器重建；请刷新核对就绪状态'}
        } catch(error) {
          if(state.stopped || error?.cancelled || error?.name==='AbortError'){
            row.status=dryRun?'cancelled':'unknown';row.message=dryRun?'预检已停止':'在途驱逐结果未知，请刷新核对；请勿直接重复提交'
            stop()
          } else {
            const status=error?.status ?? error?.response?.status
            const explicitRejection=Number.isInteger(status) && status>=400 && status<500 && ![408,499].includes(status)
            if(!dryRun && !explicitRejection){
              row.status='unknown';row.message=`${error?.message || '服务端未确认结果'}；驱逐结果未知，请刷新核对；请勿直接重复提交`
              stop()
            }else{row.status=dryRun?'blocked':'failed';row.message=error?.message || (dryRun?'服务端预检失败':'驱逐提交失败')}
          }
        } finally {controller=undefined}
      }
    } finally {state.busy=false;state.phase=state.stopped?'stopped':dryRun?'ready':'done'}
  }
  function summary() {
    const count=status=>state.rows.filter(row=>row.status===status).length
    return {total:state.rows.length,executable:count('passed'),submitted:count('submitted'),blocked:count('blocked'),failed:count('failed'),unknown:count('unknown'),cancelled:count('cancelled'),allSubmitted:state.rows.every(row=>row.status==='submitted')}
  }
  return {state,preflight:()=>run(true),submit:()=>run(false),stop,summary}
}
