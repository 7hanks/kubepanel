<template>
  <section class="insights" aria-label="资源概览">
    <article v-for="(item,index) in items" :key="item.label" class="insight" :class="`insight--${item.tone||'blue'}`" :style="{'--i':index}">
      <span class="insight-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path :d="paths[item.icon]||paths.files"/></svg>
      </span>
      <span class="insight-label">{{item.label}}</span>
      <span class="insight-value" :class="{'is-text':item.text}">
        {{item.value}}<small v-if="item.suffix&&!item.text">{{item.suffix}}</small>
      </span>
      <span class="insight-hint">{{item.hint}}</span>
      <span class="insight-spark" aria-hidden="true"></span>
    </article>
  </section>
</template>
<script setup>
defineProps({items:{type:Array,default:()=>[]}})
const paths={
  files:'M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M14 3v5h5',
  database:'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Z M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  tags:'M4 4h7l9 9-7 7-9-9V4Z M8.5 8.5h.01',
  check:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M8 12l3 3 5-6',
  edit:'M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z M14.5 5.5l4 4',
  warn:'M12 3 2 20h20L12 3Z M12 9v5 M12 17h.01',
  cube:'M12 2 3 7v10l9 5 9-5V7l-9-5Z M3 7l9 5 9-5 M12 12v10',
  link:'M9 15l6-6 M10 6l1-1a4 4 0 0 1 6 6l-1 1 M14 18l-1 1a4 4 0 0 1-6-6l1-1',
  clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 7v5l3 2'
}
</script>
<style scoped>
.insights{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0 18px}
.insight{
  position:relative;overflow:hidden;min-width:0;
  background:var(--kp-surface);border:1px solid var(--kp-border);border-radius:14px;
  padding:15px 16px 14px;box-shadow:var(--kp-shadow);
  transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s,border-color .2s;
  animation:insight-in .45s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i) * 55ms);
}
.insight:hover{transform:translateY(-3px);border-color:var(--kp-brand-border);box-shadow:0 10px 26px rgba(37,99,235,.09)}
@keyframes insight-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.insight-spark{position:absolute;left:0;top:0;height:3px;width:100%;background:linear-gradient(90deg,var(--tone),transparent 82%);opacity:.85}
.insight-icon{
  position:absolute;right:14px;top:13px;width:34px;height:34px;border-radius:10px;
  display:grid;place-items:center;background:var(--tone-soft);color:var(--tone);
  transition:transform .3s cubic-bezier(.2,.8,.2,1);
}
.insight:hover .insight-icon{transform:rotate(-8deg) scale(1.08)}
.insight-icon svg{width:18px;height:18px}
.insight-label{display:block;font-size:12px;font-weight:600;color:var(--kp-muted);letter-spacing:.01em}
.insight-value{display:block;margin-top:9px;font-size:25px;font-weight:680;letter-spacing:-.035em;line-height:1.1;color:var(--kp-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.insight-value small{font-size:12px;font-weight:600;margin-left:4px;color:var(--kp-faint);letter-spacing:0}
.insight-value.is-text{font-size:16px;font-weight:650;letter-spacing:-.01em;color:var(--tone);margin-top:13px}
.insight-hint{display:block;margin-top:8px;font-size:11.5px;color:var(--kp-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.insight--blue{--tone:#2563eb;--tone-soft:#eaf2ff}
.insight--violet{--tone:#7c5cd6;--tone-soft:#f2ecff}
.insight--teal{--tone:#0e9f8a;--tone-soft:#e6f8f4}
.insight--amber{--tone:#d97706;--tone-soft:#fff3df}
.insight--slate{--tone:#64748b;--tone-soft:#eef2f7}
.insight--green{--tone:#16a34a;--tone-soft:#e8f8ee}
@media(max-width:1100px){.insights{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:520px){.insights{grid-template-columns:minmax(0,1fr);gap:10px}.insight{padding:13px 14px}}
@media(prefers-reduced-motion:reduce){.insight{animation:none}.insight:hover{transform:none}}
</style>
