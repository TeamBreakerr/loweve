<script setup lang="ts">
import { useIdentity } from '../stores/identity';
defineProps({
  ratingA: { type: [Number, String], default: '–' },  // 用户A 评分（user_id=1）
  ratingB: { type: [Number, String], default: '–' },  // 用户B 评分（user_id=2）
});
const identity = useIdentity();
</script>

<template>
  <div class="dual">
    <span class="dual__one" data-who="a">
      <span class="dual__who">{{ identity.userById(1)?.display_name?.[0] || 'A' }}</span>
      <span class="dual__score">{{ ratingA }}</span>
    </span>
    <span class="dual__sep"></span>
    <span class="dual__one" data-who="b">
      <span class="dual__who">{{ identity.userById(2)?.display_name?.[0] || 'B' }}</span>
      <span class="dual__score">{{ ratingB }}</span>
    </span>
  </div>
</template>

<style scoped>
/* 从 styles/loweve.css「双人评分并排」段搬入（T10 批 5，纯剪切，未改声明）。*/
.dual{ display:flex; align-items:center; gap:var(--s-2); }
.dual__one{ display:flex; align-items:center; gap:6px; font-size:var(--fs-sm); }
.dual__who{
  width:22px; height:22px; border-radius:50%; display:grid; place-items:center;
  font-family:var(--font-brand); font-style:italic; font-weight:700; font-size:10px; color:var(--bg);
}
.dual__one[data-who="a"] .dual__who{ background:var(--user-a); }
.dual__one[data-who="b"] .dual__who{ background:var(--user-b); }
.dual__score{ font-family:var(--font-brand); font-style:italic; font-weight:600; font-size:var(--fs-md); color:var(--text); }
.dual__sep{ width:1px; height:18px; background:var(--line); }
</style>
