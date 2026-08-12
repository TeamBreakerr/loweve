<script setup lang="ts">
import { type PropType } from 'vue';
import { formatReviewCount } from '../../utils/games';
defineProps({
  percent: { type: Number as PropType<number | null | undefined>, default: null },
  total: { type: Number as PropType<number | null | undefined>, default: 0 },
  desc: { type: String as PropType<string | null | undefined>, default: '' },
  href: { type: String, default: '' },
  compact: { type: Boolean, default: false },
});
</script>

<template>
  <a v-if="href" class="steam-rating" :class="{ 'steam-rating--empty': percent == null }" :href="href" target="_blank" rel="noreferrer" @click.stop>
    <span class="steam-rating__brand">STEAM</span>
    <span class="steam-rating__score">{{ percent == null ? '暂无评测' : `${percent}%` }}</span>
    <span v-if="!compact && percent != null" class="steam-rating__desc">{{ desc }} · {{ formatReviewCount(total) }} 篇</span>
  </a>
  <span v-else class="steam-rating" :class="{ 'steam-rating--empty': percent == null }">
    <span class="steam-rating__brand">STEAM</span><span class="steam-rating__score">{{ percent == null ? '暂无评测' : `${percent}%` }}</span>
  </span>
</template>

<style scoped>
.steam-rating{ display:inline-flex; align-items:center; gap:6px; max-width:100%; padding:3px 9px 3px 4px; border-radius:var(--r-pill); background:var(--surface-2); border:1px solid var(--line-soft); transition:transform .15s,border-color .15s; }
a.steam-rating:hover{ transform:translateY(-1px); border-color:var(--game-line); }
.steam-rating__brand{ padding:2px 6px; border-radius:var(--r-pill); background:var(--game-accent); color:oklch(0.16 .04 240); font-size:9px; font-weight:800; letter-spacing:.05em; }
.steam-rating__score{ color:var(--game-accent); font-family:var(--font-brand); font-weight:700; font-style:italic; line-height:1; }
.steam-rating__desc{ color:var(--text-faint); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.steam-rating--empty{ opacity:.72; }
</style>
