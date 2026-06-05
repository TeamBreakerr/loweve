<script setup>
import { useIdentity } from '../stores/identity.js';
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
