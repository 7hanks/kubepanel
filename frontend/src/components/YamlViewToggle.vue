<template>
  <el-radio-group :model-value="modelValue" size="small" aria-label="YAML 显示方式" :disabled="disabled" @update:model-value="$emit('update:modelValue', $event)">
    <el-radio-button value="full">完整 YAML</el-radio-button>
    <el-radio-button value="compact">精简 YAML</el-radio-button>
  </el-radio-group>
</template>

<script setup>
defineProps({ modelValue: { type: String, default: 'full' }, disabled: Boolean })
defineEmits(['update:modelValue'])
</script>
