<template>
  <PlatformLayout active="audit"><main class="audit-main"><h1>操作审计</h1><p class="kp-muted">记录操作人、目标与结果；不会展示 Secret 内容或请求凭据。</p><div class="kp-toolbar"><el-button @click="load(false)" :loading="loading">刷新</el-button><span>已加载 {{items.length}} 条</span></div><el-alert v-if="error" :title="error" type="error" :closable="false" /><el-table :data="items" v-loading="loading" border stripe><el-table-column prop="time" label="时间" min-width="180" /><el-table-column label="操作人" width="140"><template #default="{row}">{{row.username || row.actor || '-'}}</template></el-table-column><el-table-column label="动作" min-width="160"><template #default="{row}">{{row.action || row.method}}</template></el-table-column><el-table-column prop="clusterId" label="集群" min-width="140" /><el-table-column prop="namespace" label="命名空间" min-width="140" /><el-table-column label="目标" min-width="200"><template #default="{row}">{{typeof row.target === 'object' ? JSON.stringify(row.target) : row.target || row.path}}</template></el-table-column><el-table-column label="结果" min-width="120"><template #default="{row}">{{ row.status || row.result || (row.ok ? '成功' : '失败') }}</template></el-table-column></el-table><el-button v-if="cursor" style="margin-top:16px" @click="load(true)" :loading="loading">加载更多</el-button></main></PlatformLayout>
</template>
<script setup>
import {ref,onMounted,onUnmounted} from 'vue'
import api from '../api'
import PlatformLayout from '../layout/PlatformLayout.vue'
import {createRequestGate} from '../utils/resource'
const items=ref([]),cursor=ref(''),loading=ref(false),error=ref(''),gate=createRequestGate()
async function load(append=false){const id=gate.next();loading.value=true;error.value='';try{const data=await api.audit({limit:100,...(append ? {cursor:cursor.value} : {})});if(!gate.current(id))return;items.value=append ? [...items.value,...data.items] : data.items || [];cursor.value=data.nextCursor || ''}catch(e){if(gate.current(id))error.value=e.message || '审计读取失败'}finally{if(gate.current(id))loading.value=false}}
onMounted(()=>load());onUnmounted(()=>gate.invalidate())
</script>
<style scoped>.audit-main {padding:24px;max-width:1600px;margin:auto}</style>
