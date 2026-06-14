<script setup lang="ts">
// 优先级 = 两人各占一半的双色爱心（左A右B），填到 value，其余为浅描边空心。
// total=0 时不渲染任何心（用于选择器按钮里只显示已选数量）。
defineProps({
  value: { type: Number, default: 0 },   // 已填心数
  total: { type: Number, default: 3 },   // 总槽位
});
</script>

<template>
  <span class="prio" :aria-label="value ? `优先级 ${value}/${total}` : '未设优先级'">
    <svg v-for="i in total" :key="i" class="prio__h" :class="{ off: i > value }" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.5 4.04 3 5.5l7 7Z"
            :fill="i <= value ? 'url(#prio-dual)' : 'none'" />
    </svg>
  </span>
</template>

<style scoped>
.prio { display:inline-flex; gap:2px; align-items:center; }
.prio__h { width:15px; height:15px; }
.prio__h.off path { stroke: var(--line); stroke-width: 1.7; }
</style>
