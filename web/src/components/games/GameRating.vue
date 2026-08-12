<script setup lang="ts">
import { computed } from 'vue';
import { formatReviewCount } from '../../utils/games';

const props = defineProps({
  work: { type: Object, required: true },
  compact: { type: Boolean, default: false },
});

const isSteam = computed(() => props.work?.review_percent != null);
const score = computed(() => isSteam.value ? props.work.review_percent : props.work?.catalog_rating);
const total = computed(() => isSteam.value ? props.work.review_total : props.work?.catalog_rating_count);
const brand = computed(() => isSteam.value ? 'STEAM' : 'IGDB');
const href = computed(() => isSteam.value ? props.work?.store_url : props.work?.source_url || props.work?.igdb_url);
const detail = computed(() => {
  if (score.value == null) return '暂无评价';
  if (isSteam.value && props.work?.review_desc) return `${props.work.review_desc} · ${formatReviewCount(total.value)} 篇`;
  return total.value ? `${formatReviewCount(total.value)} 人评价` : '评分样本未知';
});
</script>

<template>
  <component
    :is="href ? 'a' : 'span'"
    class="game-rating"
    :class="{ 'game-rating--empty': score == null, 'game-rating--igdb': !isSteam }"
    :href="href || undefined"
    :target="href ? '_blank' : undefined"
    :rel="href ? 'noreferrer' : undefined"
    @click.stop
  >
    <span class="game-rating__brand">{{ brand }}</span>
    <span class="game-rating__score">{{ score == null ? '暂无评价' : `${Math.round(score)}%` }}</span>
    <span v-if="!compact && score != null" class="game-rating__desc">{{ detail }}</span>
  </component>
</template>

<style scoped>
.game-rating{ display:inline-flex; align-items:center; gap:6px; max-width:100%; padding:3px 9px 3px 4px; border-radius:var(--r-pill); background:var(--surface-2); border:1px solid var(--line-soft); color:var(--text-dim); transition:transform .15s,border-color .15s; }
.game-rating[href]:hover{ transform:translateY(-1px); border-color:var(--game-line); }
.game-rating__brand{ padding:1px 6px; border-radius:var(--r-pill); color:oklch(.14 .04 245); background:var(--game-accent); font-size:9px; font-weight:900; letter-spacing:.06em; }
.game-rating--igdb .game-rating__brand{ color:oklch(.18 .05 35); background:oklch(.76 .18 45); }
.game-rating__score{ color:var(--game-accent); font-family:var(--font-brand); font-size:12px; font-style:italic; font-weight:700; }
.game-rating--igdb .game-rating__score{ color:oklch(.78 .16 48); }
.game-rating__desc{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-faint); font-size:10px; }
.game-rating--empty{ opacity:.72; }
</style>
