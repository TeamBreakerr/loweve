<script setup lang="ts">
// 推荐卡反馈三按钮：想看 / 没兴趣 / 看过（纯图标 + 悬停提示）
defineProps({
  wantLabel: { type: String, default: '想看' },
  seenLabel: { type: String, default: '看过' },
});
defineEmits(['want', 'no', 'seen']);
</script>

<template>
  <button class="feedback feedback--want" :data-tip="wantLabel" @click.stop="$emit('want')">
    <!-- heart -->
    <svg viewBox="0 0 24 24"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.5 4.04 3 5.5l7 7Z"/></svg>
  </button>
  <button class="feedback feedback--no" data-tip="没兴趣" @click.stop="$emit('no')">
    <!-- x-circle -->
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></svg>
  </button>
  <button class="feedback feedback--seen" :data-tip="seenLabel" @click.stop="$emit('seen')">
    <!-- eye -->
    <svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
  </button>
</template>

<style scoped>
.feedback{
  flex:1; font-size:var(--fs-sm); padding:5px 4px; border-radius:var(--r-sm);
  border:1px solid var(--line); color:var(--text-dim); background:var(--surface-2);
  display:flex; align-items:center; justify-content:center; gap:5px;
  transition:all .18s var(--ease);
}
.feedback svg{ width:16px; height:16px; stroke:currentColor; fill:none; stroke-width:1.8; }
.feedback:hover{ color:var(--text); transform:translateY(-1px); }
.feedback--want:hover{ background:var(--rose); border-color:var(--rose); color:oklch(0.16 0.02 30); }
.feedback--seen:hover{ background:var(--douban); border-color:var(--douban); color:oklch(0.16 0.04 150); }
.feedback--no:hover{ background:var(--surface-3); border-color:var(--line); color:var(--text); }

/* 反馈按钮：纯图标、实心、带描边 */
.feedback{ width:46px; height:42px; flex:0 0 auto; }
</style>
