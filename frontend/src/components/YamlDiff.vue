<template>
  <div class="yaml-line-diff">
    <div class="diff-summary" role="status" aria-live="polite">
      <span v-if="result.unchanged" class="diff-unchanged">无修改</span>
      <template v-else-if="result.additions !== null">
        <span class="diff-added-count">新增 {{ result.additions }}</span>
        <span class="diff-deleted-count">删除 {{ result.deletions }}</span>
      </template>
      <span v-else>差异未展开</span>
    </div>
    <p v-if="result.notice" class="diff-notice">{{ result.notice }}</p>
    <div class="diff-panes">
      <section v-for="pane in panes" :key="pane.side" class="diff-pane">
        <h3 class="diff-pane-title">{{ pane.label }}</h3>
        <div
          :ref="element => setViewport(pane.side, element)"
          class="diff-viewport" role="region" :aria-label="pane.label" tabindex="0"
          @scroll="syncScroll($event, pane.side)"
        >
          <template v-for="(row, index) in result.rows" :key="index">
            <div v-if="row.omitted" class="diff-gap">已省略 {{ row.omitted }} 行</div>
            <div
              v-else class="diff-line" :class="`diff-line--${row[pane.side]?.kind || 'empty'}`"
              :data-kind="row[pane.side]?.kind || 'empty'" :aria-hidden="!row[pane.side] || undefined"
            >
              <span class="diff-line-number" aria-hidden="true">{{ row[pane.side]?.number ?? '' }}</span>
              <span class="diff-line-marker" aria-hidden="true">{{ marker(row[pane.side]?.kind) }}</span>
              <span class="diff-line-text">{{ displayText(row[pane.side]?.text) }}</span>
            </div>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { yamlLineDiff } from '../utils/yaml-diff.js'

const props = defineProps({
  before: { type: String, default: '' },
  after: { type: String, default: '' },
})
const result = computed(() => yamlLineDiff(props.before, props.after))
const panes = [{ side: 'before', label: '修改前' }, { side: 'after', label: '修改后' }]
const viewports = {}
function setViewport(side, element) { viewports[side] = element }
function syncScroll(event, side) {
  const other = viewports[side === 'before' ? 'after' : 'before']
  if (other && other.scrollTop !== event.target.scrollTop) other.scrollTop = event.target.scrollTop
}
function marker(kind) { return kind === 'added' ? '+' : kind === 'removed' ? '−' : '' }
function displayText(text) { return text?.replace(/\r/g, '␍') ?? '' }
</script>

<style scoped>
.yaml-line-diff {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  color: var(--kp-text, #111827);
}
.diff-summary { display: flex; flex-wrap: wrap; gap: 16px; flex-shrink: 0; padding-bottom: 10px; font-size: 14px; }
.diff-added-count { color: #166534; }
.diff-deleted-count { color: #991b1b; }
.diff-unchanged { color: var(--kp-text-2, #4b5563); }
.diff-notice { flex-shrink: 0; margin: 0 0 10px; color: var(--kp-muted, #596579); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.diff-panes { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); flex: 1; min-height: 0; min-width: 0; gap: 12px; }
.diff-pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; border: 1px solid var(--kp-border-strong, #dce2ea); border-radius: var(--kp-r-sm, 6px); }
.diff-pane-title { flex-shrink: 0; margin: 0; padding: 9px 12px; background: var(--kp-surface-2, #fafbfc); border-bottom: 1px solid var(--kp-border, #e9edf2); font-size: 14px; font-weight: 600; }
.diff-viewport { flex: 1; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; background: var(--kp-surface, #fff); font: 14px/24px var(--kp-font-mono, ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace); tab-size: 2; }
.diff-viewport:focus-visible { outline: 2px solid var(--kp-brand, #2563eb); outline-offset: -2px; }
.diff-line { display: grid; grid-template-columns: 6ch 2ch minmax(0, 1fr); width: max-content; min-width: 100%; min-height: 24px; }
.diff-line-number { padding: 0 8px; text-align: right; color: var(--kp-muted, #596579); user-select: none; border-right: 1px solid var(--kp-border, #e9edf2); }
.diff-line-marker { text-align: center; user-select: none; }
.diff-line-text { display: block; padding-right: 12px; white-space: pre; }
.diff-line--removed { background: var(--kp-danger-bg, #fef2f2); color: #7f1d1d; }
.diff-line--added { background: var(--kp-success-bg, #ecfdf3); color: #14532d; }
.diff-line--removed .diff-line-marker { color: #991b1b; font-weight: 700; }
.diff-line--added .diff-line-marker { color: #166534; font-weight: 700; }
.diff-line--empty { background: var(--kp-bg, #f7f8fa); }
.diff-gap { min-height: 24px; padding: 0 12px; color: var(--kp-muted, #596579); background: var(--kp-info-bg, #f1f5f9); white-space: nowrap; }
@media (max-width: 640px) {
  .diff-panes { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
}
</style>
