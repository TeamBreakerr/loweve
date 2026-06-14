<script setup lang="ts">
// 推荐卡反馈三按钮：想看 / 没兴趣 / 看过（纯图标 + 悬停提示）
defineEmits(['want', 'no', 'seen']);
</script>

<template>
  <button class="feedback feedback--want" data-tip="想看" @click.stop="$emit('want')">
    <!-- heart -->
    <svg viewBox="0 0 24 24"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.5 4.04 3 5.5l7 7Z"/></svg>
  </button>
  <button class="feedback feedback--no" data-tip="没兴趣" @click.stop="$emit('no')">
    <!-- x-circle -->
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></svg>
  </button>
  <button class="feedback feedback--seen" data-tip="看过" @click.stop="$emit('seen')">
    <!-- eye -->
    <svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
  </button>
</template>
