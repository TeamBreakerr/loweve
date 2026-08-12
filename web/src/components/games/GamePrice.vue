<script setup lang="ts">
import { discountEndLabel, originalPrice } from '../../utils/games';
defineProps({ work: { type: Object, required: true } });
</script>

<template>
  <span v-if="work.is_free" class="game-price game-price--free">免费</span>
  <span v-else-if="work.current_price != null" class="game-price">
    <span v-if="work.discount_percent" class="game-price__discount">-{{ work.discount_percent }}%</span>
    <span v-if="work.discount_percent" class="game-price__original">{{ originalPrice(work) }}</span>
    <strong>{{ work.price_formatted || `¥${(work.current_price / 100).toFixed(2)}` }}</strong>
    <small v-if="work.discount_percent && work.discount_end_date" class="game-price__end">{{ discountEndLabel(work.discount_end_date) }}</small>
  </span>
  <span v-else-if="work.steam_appid && work.catalog_source === 'steam'" class="game-price game-price--muted">{{ work.release_state === 'released' ? '暂无在售价格' : '价格待定' }}</span>
</template>

<style scoped>
.game-price{ display:inline-flex; align-items:center; flex-wrap:wrap; gap:5px; font-size:12px; color:var(--text-dim); }
.game-price strong{ color:var(--text); font-size:13px; }
.game-price__discount{ color:oklch(.88 .14 140); background:oklch(.45 .12 145 / .28); border-radius:4px; padding:1px 5px; font-weight:700; }
.game-price__original{ text-decoration:line-through; color:var(--text-faint); }
.game-price__end{ flex-basis:100%; color:var(--text-faint); font-size:10px; line-height:1.2; }
.game-price--free{ color:oklch(.82 .13 150); font-weight:700; }
.game-price--muted{ color:var(--text-faint); }
</style>
