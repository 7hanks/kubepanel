<template>
  <div class="kv-fields" :aria-label="label">
    <div v-if="mode==='tabs'" class="kv-file-editor">
      <aside class="kv-file-nav"><button v-for="(row,index) in rows" :key="row.id" type="button" :class="{active:index===active}" @click="active=index">{{row.key||'未命名条目'}}</button><el-button :disabled="disabled" :icon="Plus" @click="add">添加条目</el-button></aside>
      <section v-if="rows[active]" class="kv-file-content"><div class="kv-file-heading"><el-input v-model="rows[active].key" :disabled="disabled" :aria-label="`${label}键 ${active+1}`" placeholder="文件名 / 键" @input="update"/><el-button :disabled="disabled" type="danger" text :icon="Delete" aria-label="删除当前条目" @click="remove(active)"/></div><el-input v-model="rows[active].value" :disabled="disabled" type="textarea" :rows="18" :aria-label="`${label}值 ${active+1}`" spellcheck="false" @input="update"/></section><el-empty v-else description="添加配置条目后编辑内容" :image-size="72"/>
    </div>
    <template v-else>
      <div v-for="(row,index) in rows" :key="row.id" class="kv-field-row" :class="{multiline}">
        <el-input v-model="row.key" :disabled="disabled" :aria-label="`${label}键 ${index+1}`" placeholder="键" @input="update"/>
        <span class="kv-equals" aria-hidden="true">=</span>
        <el-input v-model="row.value" :disabled="disabled" :type="multiline?'textarea':'text'" :autosize="multiline?{minRows:3,maxRows:10}:undefined" :aria-label="`${label}值 ${index+1}`" placeholder="值" spellcheck="false" @input="update"/>
        <el-button :disabled="disabled" type="danger" text :icon="Delete" :aria-label="`删除${label} ${index+1}`" @click="remove(index)"/>
      </div>
      <el-button class="kv-add" :disabled="disabled" :icon="Plus" @click="add">{{addLabel}}</el-button>
    </template>
    <div v-if="error" class="kv-field-error" role="alert">{{error}}</div>
  </div>
</template>
<script setup>
import {ref,watch} from 'vue'
import {Plus,Delete} from '@element-plus/icons-vue'
import {rowsToMap} from '../utils/resource-form'
const props=defineProps({modelValue:Object,label:{type:String,default:'条目'},addLabel:{type:String,default:'添加条目'},multiline:Boolean,mode:String,disabled:Boolean})
const emit=defineEmits(['update:modelValue','validity','change'])
const rows=ref([]),error=ref(''),active=ref(0)
let id=0,lastEmitted
watch(()=>props.modelValue,value=>{if(JSON.stringify(value||{})===lastEmitted)return;rows.value=Object.entries(value||{}).map(([key,value])=>({id:++id,key,value:String(value??'')}));error.value='';emit('validity','');active.value=Math.min(active.value,Math.max(0,rows.value.length-1))},{immediate:true,deep:true})
function update(){emit('change');try{const value=rowsToMap(rows.value);error.value='';lastEmitted=JSON.stringify(value);emit('update:modelValue',value)}catch(e){error.value=e.message}emit('validity',error.value)}
function add(){rows.value.push({id:++id,key:'',value:''});active.value=rows.value.length-1;update()}
function remove(index){rows.value.splice(index,1);active.value=Math.min(active.value,Math.max(0,rows.value.length-1));update()}
</script>
<style scoped>
.kv-fields{width:100%;min-width:0}.kv-field-row{display:grid;grid-template-columns:minmax(140px,30%) 20px minmax(180px,1fr) 28px;align-items:center;gap:12px;margin-bottom:16px;padding:6px 14px 6px 20px;background:#eaf0f6;border:1px solid #c9d7e8;border-radius:999px}.kv-field-row.multiline{border-radius:58px;padding:5px 18px 5px 24px}.kv-field-row :deep(.el-input__wrapper){background:var(--kp-surface);box-shadow:none;border-radius:8px}.kv-field-row :deep(.el-textarea__inner){background:var(--kp-surface);box-shadow:none;border-radius:9px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;line-height:1.65;min-height:110px;padding:12px 16px}.kv-field-row :deep(.el-input__inner){font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.kv-equals{display:grid;place-items:center;width:20px;height:24px;align-self:center;background:#426597;color:white;font-weight:600;font-size:13px}.kv-add{width:100%;border-style:dashed;margin-top:2px;border-radius:999px;background:#eaf0f6;border-color:#c9d7e8;color:#63768f;height:36px}.kv-field-error{margin-top:8px;color:var(--el-color-danger);font-size:13px}.kv-file-editor{display:grid;grid-template-columns:200px minmax(0,1fr);gap:20px;min-height:400px}.kv-file-nav{display:flex;flex-direction:column;gap:6px;border-right:1px solid var(--kp-border);padding-right:16px;min-width:0}.kv-file-nav>button:not(.el-button){background:transparent;border:0;border-radius:7px;cursor:pointer;padding:12px;text-align:left;color:var(--kp-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:inherit}.kv-file-nav>button.active{color:var(--kp-brand);background:var(--kp-side-active)}.kv-file-content{min-width:0}.kv-file-heading{display:flex;align-items:center;gap:8px;margin-bottom:12px}.kv-file-content :deep(textarea){font-family:var(--el-font-family);line-height:1.65}
@media(max-width:700px){.kv-field-row,.kv-field-row.multiline{grid-template-columns:minmax(0,1fr) 30px;border-radius:14px;padding:12px}.kv-field-row>.el-input:first-child{grid-column:1}.kv-field-row>.el-input:nth-child(3),.kv-field-row>.el-textarea{grid-column:1;grid-row:2}.kv-equals{display:none}.kv-field-row>.el-button{grid-column:2;grid-row:1}.kv-file-editor{grid-template-columns:minmax(0,1fr)}.kv-file-nav{border-right:0;border-bottom:1px solid var(--kp-border);padding:0 0 12px}}
</style>
