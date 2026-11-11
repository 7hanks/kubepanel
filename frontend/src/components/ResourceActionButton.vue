<template>
  <el-button class="kp-resource-action" type="primary" link>
    <slot />
  </el-button>
</template>

<style>
.kp-resource-action.el-button {
  flex: none;
  margin: 0;
  padding: 3px 0;
  font-size: 14px;
}
.kp-list-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: nowrap;
  gap: 12px;
  white-space: nowrap;
}
.kp-list-actions > .el-dropdown { flex: none; }
</style>
