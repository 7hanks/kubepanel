import { reactive } from 'vue'
import api from './api'

// 全局轻量状态（Vue reactive 单例，无需引入额外状态库）
export const store = reactive({
  clusters: [],                                   // 平台级：所有已注册集群
  currentClusterId: localStorage.getItem('kp_cluster') || '',
  cluster: null,                                  // 当前集群的详细信息
  discovery: [],                                  // 当前集群的 API 资源发现
  namespace: localStorage.getItem('kp_ns') || 'all',
  ready: false,
  error: '',

  /** 切换集群：清掉上一集群的缓存，避免串数据 */
  setCluster(id) {
    if (this.currentClusterId === id && this.ready) return
    this.currentClusterId = id || ''
    localStorage.setItem('kp_cluster', id || '')
    this.ready = false
    this.cluster = null
    this.discovery = []
    this.error = ''
  },

  setNamespace(ns) {
    this.namespace = ns
    localStorage.setItem('kp_ns', ns)
  },

  async loadClusters(refresh = false) {
    this.clusters = await api.clusters(refresh)
    return this.clusters
  },

  // 进入某个集群后加载集群信息与 API 资源发现
  async init(force = false) {
    if (this.ready && !force) return
    this.error = ''
    if (!this.currentClusterId) {
      this.error = '未选择集群'
      throw new Error('未选择集群')
    }
    try {
      const [cluster, discovery] = await Promise.all([api.cluster(), api.discovery()])
      this.cluster = cluster
      this.discovery = discovery
      this.ready = true
    } catch (e) {
      this.error = e.message || '无法连接 Kubernetes 集群'
      throw e
    }
  },

  get namespaces() {
    return this.cluster?.namespaces || []
  },
  get currentCluster() {
    return this.clusters.find(c => c.id === this.currentClusterId) || null
  },
})
