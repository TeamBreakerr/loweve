<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api, imgProxy } from '../api/index';
import type { HotReview, HotReviewResponse } from '../types';

const props = withDefaults(defineProps<{
  endpoint: string;
  theme?: 'film' | 'game';
}>(), {
  theme: 'film',
});

const payload = ref<HotReviewResponse | null>(null);
const loading = ref(false);
const failed = ref(false);
const brokenAvatars = ref<Set<string>>(new Set());
let requestId = 0;
const sectionTitle = computed(() => payload.value?.source === 'bangumi' ? 'Bangumi 短评' : '热门短评');

async function load() {
  const id = ++requestId;
  loading.value = true;
  failed.value = false;
  brokenAvatars.value = new Set();
  try {
    const response = await api(props.endpoint);
    if (id === requestId) payload.value = response;
  } catch {
    if (id === requestId) {
      payload.value = null;
      failed.value = true;
    }
  } finally {
    if (id === requestId) loading.value = false;
  }
}

watch(() => props.endpoint, load, { immediate: true });

function reviewDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function reviewMeta(review: HotReview) {
  const parts: string[] = [];
  if (review.rating != null) parts.push(`评分 ${review.rating}`);
  if (review.sentiment) parts.push(review.sentiment === 'positive' ? '推荐' : '不推荐');
  if (review.votes) parts.push(`${review.votes} 人赞同`);
  if (review.playtime_hours) parts.push(`游玩 ${review.playtime_hours} 小时`);
  return parts;
}

function onAvatarError(id: string) {
  brokenAvatars.value = new Set([...brokenAvatars.value, id]);
}
</script>

<template>
  <section class="section hot-reviews" :class="`hot-reviews--${theme}`">
    <div class="section__head">
      <h2 class="section__title">{{ sectionTitle }}</h2>
      <a v-if="payload?.source_url" class="hot-reviews__source" :href="payload.source_url" target="_blank" rel="noreferrer">
        来自 {{ payload.source_label }} <span>↗</span>
      </a>
      <span v-else-if="payload?.source_label" class="hot-reviews__source">来自 {{ payload.source_label }}</span>
    </div>

    <p v-if="loading" class="hot-reviews__state">正在加载热评…</p>
    <p v-else-if="failed" class="hot-reviews__state">热评暂时没有加载出来。</p>
    <p v-else-if="!payload?.reviews.length" class="hot-reviews__state">
      {{ payload?.source ? '这个来源暂时没有可显示的短评。' : '暂未匹配到豆瓣或 Bangumi 条目。' }}
    </p>
    <div v-else class="hot-reviews__grid">
      <article v-for="review in payload.reviews" :key="review.id" class="hot-review">
        <header class="hot-review__head">
          <img v-if="review.avatar_url && !brokenAvatars.has(review.id)" :src="imgProxy(review.avatar_url)" alt="" referrerpolicy="no-referrer" @error="onAvatarError(review.id)" />
          <span v-else class="hot-review__avatar">{{ review.author.trim().slice(0, 1) || '评' }}</span>
          <div>
            <strong>{{ review.author }}</strong>
            <time v-if="review.created_at">{{ reviewDate(review.created_at) }}</time>
          </div>
        </header>
        <p class="hot-review__content">{{ review.content }}</p>
        <footer v-if="reviewMeta(review).length" class="hot-review__meta">
          <span v-for="item in reviewMeta(review)" :key="item">{{ item }}</span>
        </footer>
        <a v-if="review.url" class="hot-review__link" :href="review.url" target="_blank" rel="noreferrer" aria-label="查看原短评">↗</a>
      </article>
    </div>
  </section>
</template>

<style scoped>
.hot-reviews{ --review-accent:var(--rose); --review-tint:var(--rose-tint); --review-line:var(--rose-line); }
.hot-reviews--game{ --review-accent:var(--game-accent); --review-tint:var(--game-tint); --review-line:var(--game-line); }
.hot-reviews__source{ margin-left:auto; padding-bottom:3px; color:var(--text-faint); font-size:var(--fs-sm); }
a.hot-reviews__source:hover{ color:var(--review-accent); }
.hot-reviews__source span{ color:var(--review-accent); }
.hot-reviews__state{ padding:var(--s-6); border:1px dashed var(--line-soft); border-radius:var(--r-lg); color:var(--text-faint); text-align:center; }
.hot-reviews__grid{ display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:var(--s-4); }
.hot-review{
  position:relative; display:flex; min-width:0; min-height:230px; flex-direction:column; gap:var(--s-4);
  padding:var(--s-5); overflow:hidden; border:1px solid var(--line-soft); border-radius:var(--r-lg);
  background:linear-gradient(145deg, var(--surface), var(--surface-2));
}
.hot-review::before{ content:"“"; position:absolute; right:14px; top:-13px; color:var(--review-tint); font-family:var(--font-serif); font-size:92px; line-height:1; pointer-events:none; }
.hot-review__head{ position:relative; z-index:1; display:flex; align-items:center; gap:var(--s-3); min-width:0; }
.hot-review__head img,.hot-review__avatar{ width:36px; height:36px; flex:0 0 36px; border-radius:50%; }
.hot-review__head img{ object-fit:cover; }
.hot-review__avatar{ display:grid; place-items:center; background:var(--review-tint); border:1px solid var(--review-line); color:var(--review-accent); font-weight:700; }
.hot-review__head>div{ display:flex; min-width:0; flex-direction:column; }
.hot-review__head strong{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--fs-body); }
.hot-review__head time{ color:var(--text-faint); font-size:var(--fs-cap); }
.hot-review__content{ position:relative; z-index:1; display:-webkit-box; overflow:hidden; color:var(--text-dim); font-size:var(--fs-body); line-height:1.75; -webkit-box-orient:vertical; -webkit-line-clamp:7; }
.hot-review__meta{ display:flex; flex-wrap:wrap; gap:6px; margin-top:auto; }
.hot-review__meta span{ padding:3px 7px; border:1px solid var(--review-line); border-radius:var(--r-pill); background:var(--review-tint); color:var(--text-faint); font-size:var(--fs-cap); }
.hot-review__link{ position:absolute; right:12px; bottom:10px; color:var(--review-accent); font-size:var(--fs-md); }
.hot-review:has(.hot-review__link) .hot-review__meta{ padding-right:24px; }
@media(max-width:920px){ .hot-reviews__grid{ grid-template-columns:1fr; }.hot-review{ min-height:0; }.hot-review__content{ -webkit-line-clamp:6; } }
@media(max-width:520px){ .hot-reviews .section__head{ align-items:flex-start; }.hot-reviews__source{ max-width:42%; text-align:right; }.hot-review{ padding:var(--s-4); } }
</style>
