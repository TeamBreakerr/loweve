<script setup lang="ts">
defineProps({ work: { type: Object, default: null }, compact: { type: Boolean, default: false } });
</script>

<template>
  <span v-if="work?.content_type === 'dlc'" class="game-content" :class="{ 'is-compact': compact }">
    <b>DLC</b><small v-if="work.parent_title">所属《{{ work.parent_title }}》</small>
  </span>
</template>

<style scoped>
.game-content{ display:inline-flex; align-items:center; flex-wrap:wrap; gap:6px; max-width:100%; color:var(--game-accent); }
.game-content b{ padding:2px 7px; border:1px solid var(--game-line); border-radius:var(--r-pill); background:var(--game-tint); font-size:10px; letter-spacing:.08em; line-height:1.35; }
.game-content small{ overflow:hidden; color:var(--text-faint); font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
.game-content.is-compact small{ display:none; }
</style>
