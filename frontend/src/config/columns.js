import * as yaml from 'js-yaml'

// ---------- 时间格式化 ----------
export function ago(ts) {
  if (!ts) return '-'
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export function fmtTime(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

// ---------- 容量格式化 ----------
const MEM_KI = { Ki: 1, Mi: 1024, Gi: 1024 ** 2, Ti: 1024 ** 3, Pi: 1024 ** 4 }
/** K8s 内存容量转成易读单位：16385520Ki → 16G；不足 1Gi 时用 M */
export function formatMemory(value) {
  const s = String(value ?? '').trim()
  if (!s) return '-'
  const m = /^([\d.]+)([KMGTP]i)$/.exec(s)
  if (!m) return s
  const gi = (Number(m[1]) * MEM_KI[m[2]]) / 1024 ** 2
  return gi >= 1 ? `${Math.round(gi)}G` : `${Math.round((gi * 1024))}M`
}

// ---------- 状态推断 ----------
export function phaseOf(kind, item) {
  const st = item.status || {}
  const sp = item.spec || {}
  const md = item.metadata || {}
  if (md.deletionTimestamp) return 'Terminating'

  switch (kind) {
    case 'Pod': {
      if (st.reason) return st.reason
      for (const c of st.initContainerStatuses || []) {
        if (c.state?.waiting) return `Init:${c.state.waiting.reason || 'Waiting'}`
        if (c.state?.terminated?.exitCode > 0) return `Init:${c.state.terminated.reason || 'Error'}`
        if (!c.state?.terminated && !c.started) return 'Initializing'
      }
      const waiting = (st.containerStatuses || []).find(c => c.state?.waiting)
      if (waiting) return waiting.state.waiting.reason || 'Waiting'
      const terminated = (st.containerStatuses || []).find(c => c.state?.terminated && c.state.terminated.exitCode !== 0)
      if (terminated) return terminated.state.terminated.reason || 'Error'
      if (st.phase === 'Running' && ((st.conditions || []).some(c => c.type === 'Ready' && c.status !== 'True') || (st.containerStatuses || []).some(c => !c.ready))) return 'NotReady'
      return st.phase || 'Unknown'
    }
    case 'Deployment':
    case 'StatefulSet':
    case 'ReplicaSet': {
      const want = sp.replicas ?? st.replicas ?? 0
      if (want === 0) return 'ScaledToZero'
      const ready = st.readyReplicas || 0
      if (want > 0 && ready >= want && st.availableReplicas !== 0) return 'Running'
      return ready > 0 ? 'Progressing' : 'Pending'
    }
    case 'DaemonSet': {
      const want = st.desiredNumberScheduled || 0
      return want > 0 && st.numberReady >= want ? 'Running' : 'Progressing'
    }
    case 'Job':
      if ((st.conditions || []).some(c => c.type === 'Failed' && c.status === 'True')) return 'Failed'
      return st.succeeded > 0 ? 'Succeeded' : 'Running'
    case 'CronJob': return sp.suspend ? 'Suspended' : 'Active'
    case 'Node': {
      const cond = (st.conditions || []).find(c => c.type === 'Ready')
      return cond?.status === 'True' ? 'Ready' : 'NotReady'
    }
    case 'Namespace': return st.phase || 'Active'
    case 'PersistentVolumeClaim': return st.phase || 'Pending'
    case 'PersistentVolume': return st.phase || 'Available'
    case 'Service': return sp.type || 'ClusterIP'
    case 'Event': return item.type || 'Normal'
    case 'HorizontalPodAutoscaler': return `${st.currentReplicas || 0}/${sp.maxReplicas || 0}`
    case 'Ingress': return (st.loadBalancer?.ingress || []).length ? 'Ready' : 'Pending'
    default:
      if ((st.conditions || []).some(c => c.type === 'Ready' && c.status === 'True')) return 'Ready'
      return st.phase || 'Active'
  }
}

// ---------- 行扁平化 ----------
export function normalizeRow(kind, item) {
  const md = item.metadata || {}
  const st = item.status || {}
  const sp = item.spec || {}
  const cs = st.containerStatuses || []
  const row = {
    _raw: item,
    uid: md.uid || `${md.namespace || '_all'}/${md.name}`,
    name: md.name || '-',
    namespace: md.namespace || '-',
    created: fmtTime(md.creationTimestamp),
    age: ago(md.creationTimestamp),
    status: phaseOf(kind, item),
    owner: (md.ownerReferences || []).map(o => `${o.kind}/${o.name}`).join(', ') || '-',
    reason: st.reason || [...(st.initContainerStatuses || []),...(st.containerStatuses || [])].map(c => c.state?.waiting?.reason || c.state?.terminated?.reason).filter(Boolean).join(', ') || '-',
    createdAt: Date.parse(md.creationTimestamp) || 0,
    labels: md.labels || {},
    annotations: md.annotations || {},
  }

  switch (kind) {
    case 'Pod':
      row.ready = `${cs.filter(c => c.ready).length}/${sp.containers?.length || cs.length || 0}`
      row.restarts = [...cs, ...(st.initContainerStatuses || [])].reduce((n, c) => n + (c.restartCount || 0), 0)
      row.podIP = st.podIP || '-'
      row.node = sp.nodeName || '-'
      row.images = (sp.containers || []).map(c => c.image).join(', ')
      row.containers = (sp.containers || []).map(c => c.name)
      break
    case 'Deployment':
    case 'StatefulSet':
    case 'ReplicaSet':
      row.replicas = `${st.readyReplicas || 0}/${sp.replicas ?? st.replicas ?? 0}`
      row.available = st.availableReplicas ?? 0
      row.images = (sp.template?.spec?.containers || []).map(c => c.image).join(', ')
      row.selector = Object.entries(sp.selector?.matchLabels || {}).map(([k, v]) => `${k}=${v}`).join(',')
      break
    case 'DaemonSet':
      row.replicas = `${st.numberReady || 0}/${st.desiredNumberScheduled || 0}`
      row.images = (sp.template?.spec?.containers || []).map(c => c.image).join(', ')
      row.selector = Object.entries(sp.selector?.matchLabels || {}).map(([k, v]) => `${k}=${v}`).join(',')
      break
    case 'Job':
    case 'CronJob':
      row.completions = `${st.succeeded || 0}/${sp.completions || 1}`
      row.schedule = sp.schedule || '-'
      row.suspend = sp.suspend ? '是' : '否'
      break
    case 'Service':
      row.type = sp.type || 'ClusterIP'
      row.clusterIP = sp.clusterIP || '-'
      row.ports = (sp.ports || []).map(p => `${p.port}${p.nodePort ? ':' + p.nodePort : ''}/${p.protocol || 'TCP'}`).join(', ')
      row.externalIP = (sp.externalIPs || []).join(',') || (st.loadBalancer?.ingress?.[0]?.ip || '-')
      break
    case 'Ingress':
      row.hosts = (sp.rules || []).map(r => r.host || '*').join(', ')
      row.address = (st.loadBalancer?.ingress || []).map(i => i.ip || i.hostname).join(', ') || '-'
      row.className = sp.ingressClassName || '-'
      break
    case 'Node':
      row.roles = Object.keys(md.labels || {}).filter(k => k.startsWith('node-role.kubernetes.io/')).map(k => k.split('/')[1]).join(',') || '<none>'
      row.version = st.nodeInfo?.kubeletVersion || '-'
      row.osImage = st.nodeInfo?.osImage || '-'
      row.internalIP = (st.addresses || []).find(a => a.type === 'InternalIP')?.address || '-'
      row.cpu = st.capacity?.cpu || '-'
      row.memory = formatMemory(st.capacity?.memory)
      row.unschedulable = !!sp.unschedulable
      break
    case 'Namespace': row.phase = st.phase || 'Active'; break
    case 'PersistentVolumeClaim':
      row.volume = sp.volumeName || '-'
      row.capacity = st.capacity?.storage || sp.resources?.requests?.storage || '-'
      row.storageClass = sp.storageClassName || '-'
      row.accessModes = (sp.accessModes || []).join(',')
      break
    case 'PersistentVolume':
      row.capacity = sp.capacity?.storage || '-'
      row.storageClass = sp.storageClassName || '-'
      row.reclaimPolicy = sp.persistentVolumeReclaimPolicy || '-'
      row.claim = sp.claimRef ? `${sp.claimRef.namespace}/${sp.claimRef.name}` : '-'
      break
    case 'ConfigMap': row.keys = Object.keys(item.data || {}).join(', ') || '-'; break
    case 'Secret':
      row.keys = Object.keys(item.data || {}).join(', ') || '-'
      row.secretType = item.type || '-'
      break
    case 'Event':
      row.reason = item.reason || '-'
      row.object = item.involvedObject ? `${item.involvedObject.kind}/${item.involvedObject.name}` : '-'
      row.message = item.message || '-'
      row.count = item.count || item.series?.count || 1
      break
    case 'HorizontalPodAutoscaler':
      row.target = sp.scaleTargetRef ? `${sp.scaleTargetRef.kind}/${sp.scaleTargetRef.name}` : '-'
      row.minmax = `${sp.minReplicas || 1}-${sp.maxReplicas || 1}`
      row.replicas = `${st.currentReplicas || 0}/${sp.maxReplicas || 0}`
      break
    default: break
  }
  return row
}

// ---------- 列定义 ----------
const NAME = { key: 'name', label: '名称', minWidth: 190, link: true }
const NS = { key: 'namespace', label: '命名空间', width: 140 }
const STATUS = { key: 'status', label: '状态', width: 130, tag: true }
const AGE = { key: 'age', label: '运行时间', width: 105 }

const KIND_COLS = {
  Pod: [
    { key: 'images', label: '镜像', minWidth: 230 },
    { key: 'ready', label: '就绪', width: 85 },
    { key: 'status', label: '状态', width: 145, tag: true },
    { key: 'restarts', label: '重启', width: 75 },
    { key: 'node', label: '节点', width: 150 },
  ],
  Deployment: [
    { key: 'replicas', label: '副本 (就绪/期望)', width: 150 },
    { key: 'status', label: '状态', width: 125, tag: true },
    { key: 'images', label: '镜像', minWidth: 210 },
  ],
  StatefulSet: [{ key: 'replicas', label: '副本', width: 110 }, { key: 'status', label: '状态', width: 125, tag: true }, { key: 'images', label: '镜像', minWidth: 200 }],
  ReplicaSet: [{ key: 'replicas', label: '副本', width: 110 }, { key: 'status', label: '状态', width: 125, tag: true }],
  DaemonSet: [{ key: 'replicas', label: '就绪/期望', width: 110 }, { key: 'status', label: '状态', width: 125, tag: true }, { key: 'images', label: '镜像', minWidth: 200 }],
  Job: [{ key: 'completions', label: '完成', width: 90 }, { key: 'status', label: '状态', width: 125, tag: true }],
  CronJob: [{ key: 'schedule', label: '调度', width: 130 }, { key: 'suspend', label: '暂停', width: 80 }, { key: 'status', label: '状态', width: 125, tag: true }],
  Service: [
    { key: 'type', label: '类型', width: 120 },
    { key: 'clusterIP', label: 'ClusterIP', width: 140 },
    { key: 'ports', label: '端口', minWidth: 240 },
    { key: 'externalIP', label: '外部地址', width: 140 },
  ],
  Ingress: [{ key: 'hosts', label: '域名', minWidth: 200 }, { key: 'address', label: '地址', width: 150 }, { key: 'className', label: 'IngressClass', width: 140 }],
  Node: [
    { key: 'status', label: '状态', width: 110, tag: true },
    { key: 'roles', label: '角色', width: 120 },
    { key: 'internalIP', label: '内网 IP', width: 140 },
    { key: 'version', label: 'Kubelet', width: 115 },
    { key: 'osImage', label: '操作系统', minWidth: 185 },
    { key: 'cpu', label: 'CPU', width: 80 },
    { key: 'memory', label: '内存', width: 100 },
  ],
  Namespace: [{ key: 'phase', label: '阶段', width: 130, tag: true }],
  PersistentVolumeClaim: [
    { key: 'status', label: '状态', width: 120, tag: true },
    { key: 'capacity', label: '容量', width: 100 },
    { key: 'volume', label: 'PV', minWidth: 160 },
    { key: 'storageClass', label: 'StorageClass', width: 150 },
  ],
  PersistentVolume: [
    { key: 'status', label: '状态', width: 120, tag: true },
    { key: 'capacity', label: '容量', width: 100 },
    { key: 'claim', label: '绑定 PVC', minWidth: 180 },
    { key: 'storageClass', label: 'StorageClass', width: 150 },
    { key: 'reclaimPolicy', label: '回收策略', width: 120 },
  ],
  ConfigMap: [{ key: 'keys', label: '数据键', minWidth: 260 }],
  Secret: [{ key: 'keys', label: '数据键', minWidth: 240 }, { key: 'secretType', label: '类型', width: 180 }],
  Event: [
    { key: 'status', label: '类型', width: 100, tag: true },
    { key: 'reason', label: '原因', width: 140 },
    { key: 'object', label: '对象', minWidth: 180 },
    { key: 'message', label: '消息', minWidth: 260 },
    { key: 'count', label: '次数', width: 80 },
  ],
  HorizontalPodAutoscaler: [
    { key: 'target', label: '目标', minWidth: 190 },
    { key: 'minmax', label: '副本范围', width: 110 },
    { key: 'replicas', label: '当前/最大', width: 120 },
    { key: 'status', label: '状态', width: 110, tag: true },
  ],
}

export function columnsFor(kind, namespaced) {
  const mid = KIND_COLS[kind] || [{ key: 'status', label: '状态', width: 130, tag: true }]
  return [NAME, ...(namespaced&&kind!=='Pod' ? [NS] : []), ...mid, AGE]
}

// ---------- 新建资源 YAML 模板 ----------
export function yamlTemplate(meta, namespace) {
  const ns = namespace && namespace !== 'all' ? namespace : 'default'
  const gv = meta.group ? `${meta.group}/${meta.version}` : 'v1'
  const base = { apiVersion: gv, kind: meta.kind, metadata: { name: '', namespace: meta.namespaced ? ns : undefined } }
  const templates = {
    Deployment: {
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: 'myapp' } },
        template: {
          metadata: { labels: { app: 'myapp' } },
          spec: {
            containers: [{ name: 'myapp', image: 'nginx:1.25', ports: [{ containerPort: 80 }] }],
          },
        },
      },
    },
    Service: {
      spec: {
        type: 'ClusterIP',
        selector: { app: 'myapp' },
        ports: [{ port: 80, targetPort: 80, protocol: 'TCP' }],
      },
    },
    Pod: {
      spec: { containers: [{ name: 'demo', image: 'busybox:1.36', command: ['sh', '-c', 'sleep 3600'] }] },
    },
    ConfigMap: { data: { key1: 'value1' } },
    Secret: { type: 'Opaque', stringData: {} },
    Namespace: { metadata: { name: '' } },
    Ingress: {
      spec: {
        ingressClassName: 'nginx',
        rules: [
          {
            host: 'example.com',
            http: {
              paths: [
                {
                  path: '/',
                  pathType: 'Prefix',
                  backend: { service: { name: 'myapp', port: { number: 80 } } },
                },
              ],
            },
          },
        ],
      },
    },
    PersistentVolumeClaim: {
      spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: '1Gi' } } },
    },
    CronJob: {
      spec: {
        schedule: '*/5 * * * *',
        jobTemplate: {
          spec: {
            template: {
              spec: {
                restartPolicy: 'OnFailure',
                containers: [{ name: 'job', image: 'busybox:1.36', command: ['sh', '-c', 'date'] }],
              },
            },
          },
        },
      },
    },
    Job: {
      spec: {
        template: {
          spec: {
            restartPolicy: 'OnFailure',
            containers: [{ name: 'job', image: 'busybox:1.36', command: ['sh', '-c', 'echo hello'] }],
          },
        },
      },
    },
  }
  const obj = { ...base, ...(templates[meta.kind] || {}) }
  if (meta.kind === 'Namespace' || !meta.namespaced) {
    // 集群级资源不带 namespace 字段
    delete obj.metadata.namespace
  }
  return yaml.dump(obj, { noRefs: true, lineWidth: 120 })
}
