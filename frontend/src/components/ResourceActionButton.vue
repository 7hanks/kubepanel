<template>
  <el-button class="kp-resource-action" type="primary" plain round size="small">
    <slot />
  </el-button>
</template>

<style>
/* One size and native Element Plus interaction states for every row action,
   including buttons nested inside a Dropdown trigger. */
.kp-resource-action.el-button {
  inline-size: 4em;
  flex: none;
  margin: 0;
}
.kp-list-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: nowrap;
  gap: 8px;
  white-space: nowrap;
}
.kp-list-actions > .el-dropdown { flex: none; }
</style>
