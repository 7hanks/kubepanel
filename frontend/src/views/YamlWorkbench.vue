<template>
  <div>
    <div class="kp-toolbar">
      <el-select v-model="sampleKey" placeholder="插入示例模板" style="width:220px" @change="insertSample">
        <el-option v-for="(v, k) in samples" :key="k" :label="k" :value="k" />
      </el-select>
      <span class="spacer" />
      <el-button @click="validate">校验 YAML</el-button>
      <el-button @click="text = ''">清空</el-button>
      <el-button type="primary" :loading="applying" :disabled="!writable" @click="apply">应用 (apply)</el-button>
    </div>

    <el-row :gutter="16">
      <el-col :xs="24" :lg="15">
        <textarea v-model="text" class="kp-yaml" style="min-height:560px" spellcheck="false" placeholder="在此粘贴 YAML，支持 --- 分隔的多文档" />
      </el-col>
      <el-col :xs="24" :lg="9">
        <div class="kp-card">
          <div class="kp-section-title">执行结果</div>
          <div v-if="!results.length" class="kp-empty">尚未执行。KubePanel 使用服务端 Apply，可创建或更新任意资源（含 CRD 自定义资源）。</div>
          <div v-for="(r, i) in results" :key="i" style="margin-bottom:10px;padding:9px;border-radius:6px;background:#f7f9fc;border:1px solid var(--kp-border)">
            <div style="display:flex;align-items:center;gap:8px">
              <el-tag :type="r.ok ? 'success' : 'danger'" size="small">{{ r.ok ? '成功' : '失败' }}</el-tag>
              <span class="kp-mono">{{ r.name }}</span>
            </div>
            <div v-if="!r.ok" class="kp-danger kp-mono" style="margin-top:6px;word-break:break-all">{{ r.message }}</div>
            <div v-else class="kp-muted" style="margin-top:6px;font-size:12px">{{ r.message }}</div>
          </div>
        </div>
        <el-alert type="warning" :closable="false" style="margin-top:14px" title="提示"
          description="apply 会直接作用于当前集群。删除资源请到对应资源列表操作，不要在 YAML 工作台粘贴含 delete 意图的清单。" />
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import * as yaml from 'js-yaml'
import api from '../api'
import { store } from '../store'
import { canAny } from '../utils/perm'

const writable = computed(() => canAny('cluster:create', 'cluster:update'))

const text = ref(`# 示例：创建一个 Nginx Deployment（可直接点"应用"体验）
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kubepanel-demo
  namespace: default
  labels:
    app: kubepanel-demo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kubepanel-demo
  template:
    metadata:
      labels:
        app: kubepanel-demo
    spec:
      containers:
        - name: nginx
          image: nginx:1.25-alpine
          ports:
            - containerPort: 80
`)
const sampleKey = ref('')
const applying = ref(false)
const results = ref([])

const samples = {
  'Nginx Deployment': text.value,
  'Service': `apiVersion: v1
kind: Service
metadata:
  name: kubepanel-demo
  namespace: default
spec:
  type: ClusterIP
  selector:
    app: kubepanel-demo
  ports:
    - name: http
      port: 80
      targetPort: 80
`,
  'ConfigMap': `apiVersion: v1
kind: ConfigMap
metadata:
  name: kubepanel-demo-config
  namespace: default
data:
  app.properties: |
    env=prod
    log.level=info
`,
  'Namespace': `apiVersion: v1
kind: Namespace
metadata:
  name: demo
`,
}

function insertSample(k) { if (k) text.value = samples[k]; sampleKey.value = '' }
function validate() {
  try {
    const docs = yaml.loadAll(text.value).filter(Boolean)
    if (!docs.length) throw new Error('没有可解析的文档')
    for (const d of docs) if (!d.apiVersion || !d.kind) throw new Error('文档缺少 apiVersion 或 kind')
    ElMessage.success(`语法正确，共 ${docs.length} 个资源`)
  } catch (e) { ElMessage.error('YAML 校验失败：' + e.message) }
}

async function apply() {
  applying.value = true
  results.value = []
  try {
    const data = await api.apply(text.value, { defaultNamespace: store.namespace !== 'all' ? store.namespace : undefined })
    results.value = data.results || []
    const ok = results.value.filter(r => r.ok).length
    ElMessage[ok === results.value.length ? 'success' : 'warning'](`执行完成：成功 ${ok} / ${results.value.length}`)
  } catch (e) { ElMessage.error(e.message || '应用失败') }
  finally { applying.value = false }
}
</script>
