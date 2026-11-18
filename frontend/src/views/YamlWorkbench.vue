<template>
 <main class="yaml-workbench">
  <div class="workbench-heading"><div><h1>YAML 生成器</h1><p>配置资源并实时生成 YAML，再按需转入预检。</p></div></div>
  <el-tabs v-model="activeTab" class="workbench-tabs">
   <el-tab-pane label="生成 YAML" name="generator"><YamlGenerator ref="generator" :namespace="defaultNamespace" :can-apply="writable" @preflight="stageGenerated" /></el-tab-pane>
   <el-tab-pane label="预检与提交" name="apply"><YamlApplyWorkbench ref="applyWorkbench" /></el-tab-pane>
  </el-tabs>
 </main>
</template>
<script setup>
import {ref,computed,onMounted,onUnmounted} from 'vue'
import {ElMessageBox} from 'element-plus'
import {store} from '../store'
import {can} from '../utils/perm'
import {registerUnsavedGuard} from '../utils/navigation'
import YamlGenerator from '../components/YamlGenerator.vue'
import YamlApplyWorkbench from '../components/YamlApplyWorkbench.vue'
const activeTab=ref('generator'),generator=ref(null),applyWorkbench=ref(null)
const defaultNamespace=computed(()=>store.namespace&&store.namespace!=='all'?store.namespace:'default')
const writable=computed(()=>can('cluster:create')&&can('cluster:update'))
const dirty=computed(()=>!!generator.value?.dirty||!!applyWorkbench.value?.dirty)
async function stageGenerated(value){if(await applyWorkbench.value?.stageYaml(value)){generator.value?.markExported(value);activeTab.value='apply'}}
const removeGuard=registerUnsavedGuard(async()=>{
 if(applyWorkbench.value?.working)return false
 if(!dirty.value)return true
 try{await ElMessageBox.confirm('生成器或预检区还有未导出、未提交的修改，确定离开并丢弃？','未保存的修改',{type:'warning',confirmButtonText:'丢弃并离开',cancelButtonText:'保留编辑'})}catch{return false}
 generator.value?.discardDraft();applyWorkbench.value?.discardDraft();return true
})
function beforeUnload(event){if(dirty.value){event.preventDefault();event.returnValue=''}}
onMounted(()=>window.addEventListener('beforeunload',beforeUnload))
onUnmounted(()=>{removeGuard();window.removeEventListener('beforeunload',beforeUnload)})
</script>
<style scoped>
.yaml-workbench{min-width:0}.workbench-heading{display:flex;align-items:center;justify-content:space-between;margin:2px 0 20px}.workbench-heading h1{font-size:21px;font-weight:600;letter-spacing:-.3px;margin:0 0 7px;color:var(--kp-text)}.workbench-heading p{font-size:12px;line-height:1.7;color:var(--kp-muted);margin:0}.workbench-tabs :deep(.el-tabs__header){margin-bottom:18px}.workbench-tabs :deep(.el-tabs__item){font-size:13px}.workbench-tabs :deep(.el-tab-pane){min-width:0}
@media(max-width:600px){.workbench-heading{margin-bottom:14px}.workbench-heading h1{font-size:19px}}
</style>
