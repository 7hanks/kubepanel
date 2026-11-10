<template>
  <div>
    <div class="kp-toolbar">
      <el-input v-model="keyword" placeholder="搜索 Kind / API 组 / 资源名" clearable style="width:300px" :prefix-icon="Search" />
      <el-button @click="load" :loading="loading"><el-icon><Refresh /></el-icon><span style="margin-left:5px">刷新</span></el-button>
      <span class="spacer" />
      <el-tag disable-transitions type="info" size="small" effect="plain">共 {{ filtered.length }} 种自定义资源</el-tag>
    </div>

    <el-alert type="info" :closable="false" style="margin-bottom:14px">
      <template #title>自定义资源（CRD 实例）在这里按需进入</template>
      <template #default>
        侧边栏不再逐个罗列 CRD。找到对应资源类型后点「查看实例」，会进入通用资源列表，支持查看 / 新建 / YAML 编辑 / 删除等全部操作。
      </template>
    </el-alert>

    <el-alert v-if="loadError" type="error" :title="loadError" :closable="false" style="margin-bottom:12px"><el-button @click="load">重试</el-button></el-alert>
    <div class="kp-card" style="padding:0">
      <el-table v-loading="loading" :data="filtered" border stripe size="small" style="width:100%">
        <el-table-column prop="kind" label="Kind" min-width="200" show-overflow-tooltip />
        <el-table-column prop="group" label="API 组" min-width="220" show-overflow-tooltip />
        <el-table-column prop="version" label="版本" width="110" />
        <el-table-column label="作用域" width="110">
          <template #default="{ row }">
            <el-tag disable-transitions :type="row.namespaced ? 'info' : 'warning'" size="small">{{ row.namespaced ? '命名空间' : '集群级' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="plural" label="资源名 (plural)" min-width="200" show-overflow-tooltip />
        <el-table-column label="操作" width="130" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="open(row)">查看实例</el-button>
          </template>
        </el-table-column>
        <template #empty><div class="kp-empty">{{ loadError ? '资源发现失败，请重试' : '该集群没有发现自定义资源' }}</div></template>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Refresh } from '@element-plus/icons-vue'
import api from '../api'
import { customResources } from '../config/resources'
import { cpath } from '../utils/path'

const router = useRouter()
const loading = ref(false)
const loadError=ref('')
const keyword = ref('')
const items = ref([])

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return items.value
  return items.value.filter(r =>
    r.kind.toLowerCase().includes(k) || r.group.toLowerCase().includes(k) || r.plural.toLowerCase().includes(k))
})

async function load() {
  loading.value = true; loadError.value=''
  try {
    const discovery = await api.discovery()
    items.value = customResources(discovery)
  } catch (e) { items.value = [];loadError.value=e.message || '资源发现失败' }
  finally { loading.value = false }
}

function open(row) { router.push(cpath(row.path)) }

onMounted(load)
</script>
