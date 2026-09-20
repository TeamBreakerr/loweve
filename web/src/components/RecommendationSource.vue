<script setup lang="ts">
import type { RecommendationEvidence } from '../types';
defineProps<{ evidence?: RecommendationEvidence | null }>();
</script>

<template>
  <a v-if="evidence?.source_url" class="recommendation-source" :href="evidence.source_url" target="_blank" rel="noopener noreferrer" @click.stop>
    来源：{{ evidence.source }}<template v-if="evidence.source_score != null"> · {{ evidence.source_score }}{{ evidence.source === 'Steam' ? '% 好评' : '分' }}</template>
    <template v-if="evidence.source_votes != null"> · {{ evidence.source_votes }}人评价</template>
    <span :title="new Date(evidence.fetched_at).toLocaleString()"> · 查询于{{ new Date(evidence.fetched_at).toLocaleDateString() }}</span> ↗
  </a>
</template>

<style scoped>
.recommendation-source { display: block; margin-top: 8px; font-size: 12px; line-height: 1.6; color: var(--text-muted); overflow-wrap: anywhere; }
</style>
