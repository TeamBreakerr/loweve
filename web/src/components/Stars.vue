<script setup lang="ts">
defineProps({
  value: { type: Number, default: 0 },   // 0–3
  total: { type: Number, default: 3 },
});
</script>

<template>
  <span class="stars" :title="value ? `优先级 ${'★'.repeat(value)}` : '未设优先级'">
    <svg v-for="i in total" :key="i" viewBox="0 0 24 24">
      <path :class="i <= value ? 'on' : 'off'" d="M12 2l3 6.5 7 .9-5 4.8 1.3 7L12 18l-6.3 3.2L7 14.2 2 9.4l7-.9Z"/>
    </svg>
  </span>
</template>
