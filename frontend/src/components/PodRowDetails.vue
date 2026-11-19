<template>
  <div class="pod-row-details">
    <section class="pod-detail-card" :aria-label="`${pod.metadata?.name || 'Pod'} 的基础信息`">
      <div class="pod-detail-heading"><h3>Pod 信息</h3></div>
      <dl class="pod-info-list">
        <div><dt>Pod IP</dt><dd class="pod-detail-address"><span v-for="address in podIPs" :key="address">{{ address }}</span><span v-if="!podIPs.length">—</span></dd></div>
        <div><dt>节点</dt><dd>{{ pod.spec?.nodeName || '未调度' }}</dd></div>
        <div><dt>主机 IP</dt><dd class="pod-detail-address"><span v-for="address in hostIPs" :key="address">{{ address }}</span><span v-if="!hostIPs.length">—</span></dd></div>
        <div><dt>QoS</dt><dd>{{ pod.status?.qosClass || '—' }}</dd></div>
        <div><dt>服务账户</dt><dd>{{ pod.spec?.serviceAccountName || pod.spec?.serviceAccount || '—' }}</dd></div>
      </dl>
    </section>

    <section class="pod-detail-card" :aria-label="`${pod.metadata?.name || 'Pod'} 的容器信息`">
      <div class="pod-detail-heading"><h3>容器</h3><span>{{ containers.length }} 个</span></div>
      <div v-if="containers.length" class="pod-detail-table-scroll" tabindex="0" role="region" aria-label="容器列表">
        <table class="pod-detail-container-table" :aria-label="`${pod.metadata?.name || 'Pod'} 的容器状态`">
          <thead><tr><th scope="col">名称</th><th scope="col">镜像</th><th scope="col">状态</th><th scope="col">重启次数</th></tr></thead>
          <tbody>
            <tr v-for="container in containers" :key="`${container.type}/${container.key}`">
              <th scope="row"><strong>{{ container.name }}</strong><span class="pod-detail-container-kind">{{ containerKinds[container.type] }}</span></th>
              <td><code class="pod-detail-image">{{ container.image || '—' }}</code></td>
              <td><el-tag :type="stateType(container.state)" :title="container.state" size="small" effect="light" disable-transitions>{{ stateLabel(container.state) }}</el-tag></td>
              <td class="pod-detail-restarts">{{ container.restartCount }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="pod-detail-empty">尚无容器信息</p>
    </section>
  </div>
</template>

<script setup>
import {computed} from 'vue'
import {podContainers} from '../utils/container-targets'

const props=defineProps({pod:{type:Object,required:true}})
const containers=computed(()=>podContainers({...props.pod,metadata:props.pod.metadata||{}}))
const podIPs=computed(()=>addresses(props.pod.status?.podIPs,props.pod.status?.podIP))
const hostIPs=computed(()=>addresses(props.pod.status?.hostIPs,props.pod.status?.hostIP))
const containerKinds={Container:'工作容器',Init:'初始化容器',Ephemeral:'临时容器'}
const stateLabels={Running:'运行中',Completed:'已完成',Succeeded:'已完成',Unknown:'未知',Pending:'等待中'}

function stateLabel(state) {
  return Object.hasOwn(stateLabels, state) ? stateLabels[state] : state
}
function addresses(list,primary){
  const values=(Array.isArray(list)?list:[]).map(item=>item?.ip)
  if(primary)values.unshift(primary)
  return [...new Set(values.filter(value=>typeof value==='string'&&value))]
}
function stateType(state){
  if(['Running','Completed','Succeeded'].includes(state))return 'success'
  if(['Failed','Error','OOMKilled','CrashLoopBackOff','ImagePullBackOff','ErrImagePull','CreateContainerConfigError','RunContainerError'].includes(state))return 'danger'
  return ['Pending','ContainerCreating','PodInitializing'].includes(state)?'warning':'info'
}
</script>

<style scoped>
.pod-row-details {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(0, 2.15fr);
  gap: 12px;
  padding: 14px;
  background: var(--kp-surface-2);
  color: var(--kp-text-2);
  font-size: 13px;
  line-height: 1.6;
}
.pod-detail-card {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--kp-border);
  border-radius: 8px;
  background: var(--kp-surface);
}
.pod-detail-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.pod-detail-heading h3 { margin: 0; color: var(--kp-text); font-size: 14px; font-weight: 600; }
.pod-detail-heading > span { color: var(--kp-muted); font-size: 12px; }
.pod-info-list { margin: 0; }
.pod-info-list > div { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--kp-border); }
.pod-info-list > div:first-child { padding-top: 0; }
.pod-info-list > div:last-child { padding-bottom: 0; border-bottom: 0; }
.pod-info-list dt { color: var(--kp-muted); }
.pod-info-list dd { margin: 0; min-width: 0; color: var(--kp-text); overflow-wrap: anywhere; }
.pod-detail-address { display: grid; gap: 3px; font-variant-numeric: tabular-nums; }
.pod-detail-table-scroll { overflow-x: auto; border: 1px solid var(--kp-border); border-radius: 6px; }
.pod-detail-table-scroll:focus-visible { outline: 2px solid var(--kp-brand); outline-offset: 2px; }
.pod-detail-container-table { width: 100%; min-width: 550px; table-layout: fixed; border-collapse: collapse; font-size: 12px; line-height: 1.6; }
.pod-detail-container-table th, .pod-detail-container-table td { padding: 8px 10px; border-bottom: 1px solid var(--kp-border); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.pod-detail-container-table thead th { background: var(--kp-surface-2); color: var(--kp-text-2); font-weight: 500; }
.pod-detail-container-table th:first-child { width: 135px; }
.pod-detail-container-table th:nth-child(3) { width: 140px; }
.pod-detail-container-table th:last-child { width: 80px; white-space: nowrap; }
.pod-detail-container-table tbody th { font-weight: 400; }
.pod-detail-container-table tbody th strong { display: block; color: var(--kp-text); font-size: 13px; font-weight: 600; }
.pod-detail-container-kind { display: block; margin-top: 3px; color: var(--kp-muted); font-size: 12px; }
.pod-detail-image { font-family: "Cascadia Mono", Consolas, ui-monospace, monospace; font-size: 12px; white-space: normal; overflow-wrap: anywhere; }
.pod-detail-container-table :deep(.el-tag) { max-width: 100%; height: auto; min-height: 20px; padding: 2px 6px; font-size: 12px; line-height: 1.4; white-space: normal; }
.pod-detail-container-table :deep(.el-tag__content) { overflow-wrap: anywhere; }
.pod-detail-restarts { font-variant-numeric: tabular-nums; }
.pod-detail-container-table tbody tr:last-child > * { border-bottom: 0; }
.pod-detail-empty { color: var(--kp-muted); font-size: 13px; margin: 0; }
@media (max-width: 900px) {
  .pod-row-details { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 600px) {
  .pod-row-details { padding: 10px; gap: 10px; }
  .pod-detail-card { padding: 12px; }
  .pod-info-list > div { grid-template-columns: 70px minmax(0, 1fr); gap: 10px; }
}
</style>
