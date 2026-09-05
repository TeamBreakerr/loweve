<script setup lang="ts">
// 一起看过 · 横向时间线：按年分组、节点+圆点+竖轴线、左右滚动。
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import Poster from './Poster.vue';
import Rating from './Rating.vue';
import Dual from './Dual.vue';
import { fmtWatchedShort } from '../utils/watchedDate';
import { ratingHref } from '../api/index';
import type { Session } from '../types';
import HorizontalRail from './HorizontalRail.vue';

const router = useRouter();
const props = withDefaults(defineProps<{ sessions?: Session[]; limit?: number }>(), {
  sessions: () => [],
  limit: 0,   // 0 = 全部
});
const emit = defineEmits(['edit']);

const groups = computed(() => {
  const list = props.limit ? props.sessions.slice(0, props.limit) : props.sessions;
  const g: Record<string, Session[]> = {};
  list.forEach(s => {
    const year = s.watched_at ? String(Math.floor(s.watched_at / 10000)) : '未知';
    (g[year] = g[year] || []).push(s);
  });
  return Object.entries(g).sort((a, b) => {
    if (a[0] === '未知') return 1;
    if (b[0] === '未知') return -1;
    return b[0].localeCompare(a[0]);
  });
});
const fmtMonthDay = (n: any) => fmtWatchedShort(n);

</script>

<template>
  <HorizontalRail class="htl-wrap" data-home-rail="film-completed" aria-label="一起看过">
    <p v-if="!sessions.length" class="htl-empty">还没记录一起看过的作品。</p>
    <template v-for="[year, items] in groups" :key="year">
      <div class="htl-node"><span class="htl-node__dot"></span><span class="htl-node__yr">{{ year }}</span></div>
      <article v-for="s in items" :key="s.id" class="hcard">
        <div class="hcard__pw">
          <Poster :color="'#2a2a30'" :url="s.work?.primary_poster_url" :kind="s.work?.is_anime ? '番剧' : ''"
                  class="hcard__poster" @click="s.work_id && router.push(`/work/${s.work_id}`)" />
          <div class="hcard__corner">
            <button class="hcard__edit" data-tip="编辑" data-tip-pos="below" @click="emit('edit', s)">
              <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
          </div>
        </div>
        <div class="hcard__body">
          <h3 class="hcard__title hcard__title--clickable" @click="s.work_id && router.push(`/work/${s.work_id}`)">{{ s.work?.title }} <span class="year">{{ s.work?.year }}</span></h3>
          <div class="hcard__row"><Dual :rating-a="s.rating_a ?? '–'" :rating-b="s.rating_b ?? '–'" /></div>
          <div class="hcard__row">
            <Rating v-if="s.work" :source="s.work.rating_source" :score="s.work.primary_rating?.toFixed(1) || '—'" :href="ratingHref(s.work)" />
            <span v-if="s.watched_at" class="hcard__date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 9h18"/></svg>
              {{ fmtMonthDay(s.watched_at) }}
            </span>
          </div>
        </div>
      </article>
    </template>
  </HorizontalRail>
</template>

<style scoped>
.htl-wrap { --horizontal-rail-gap:var(--s-3); --horizontal-rail-padding:6px 4px 8px; }
.htl-node {
  flex: 0 0 auto; align-self: stretch; position: relative;
  display: flex; flex-direction: column; align-items: center; padding: 8px 6px 0; min-width: 46px;
}
.htl-node::after {
  content: ""; position: absolute; top: 28px; bottom: 12px; left: 50%; transform: translateX(-50%);
  width: 2px; background: linear-gradient(var(--rose-line), transparent);
}
.htl-node__dot {
  width: 10px; height: 10px; border-radius: 50%; background: var(--rose);
  box-shadow: 0 0 0 4px var(--rose-tint); margin-bottom: 6px; position: relative; z-index: 1;
}
.htl-node__yr {
  font-family: var(--font-brand); font-style: italic; font-weight: 700;
  font-size: var(--fs-sm); color: var(--rose); white-space: nowrap;
}
/* .hcard__corner/.hcard__date(+svg)/.hcard__edit(+:hover/+svg) 从 styles/loweve.css「首页
   改版」段搬入（T10 批 6，纯剪切，未改声明）。三者只在本组件出现，.hcard 基类及其余共用
   子类（__body/__pw/__row/__title）留在 styles/primitives.css（Home.vue「想看就一起看」
   横向小卡与本组件共用）。*/
.hcard__corner{ position:absolute; top:8px; right:8px; display:flex; gap:5px; }
.hcard__edit{ width:30px; height:30px; border-radius:50%; display:grid; place-items:center; background:oklch(0.16 0.02 30 / 0.8); border:1px solid oklch(1 0 0 / 0.2); color:oklch(0.95 0 0 / 0.92); }
.hcard__edit svg{ width:14px; height:14px; stroke:currentColor; fill:none; stroke-width:1.8; }
.hcard__edit:hover{ background:var(--rose); color:oklch(0.16 0.02 30); border-color:var(--rose); }
.hcard__date{ display:inline-flex; align-items:center; gap:5px; font-size:var(--fs-sm); color:var(--text-faint); }
.hcard__date svg{ width:13px; height:13px; stroke:currentColor; fill:none; stroke-width:1.6; }

/* ============================================================ 内联样式收编（T12 批 4）
   .hcard__poster / .hcard__title--clickable 手法沿用 Home.vue「想看就一起看」横向小卡
   同名修饰类（两处 cursor:pointer 语义完全一致）：.hcard/.hcard__pw/.hcard__body/
   .hcard__row/.hcard__title 是跨文件共用基类（primitives.css），不改基类，各自文件用
   scoped 修饰类覆盖，互不影响。.hcard__poster 落到 <Poster> 子组件根节点（单根组件，
   fallthrough attrs 携带本文件 scoped id，同 Plan.vue .plan-card__poster 手法）。
   .htl-empty 是本文件独有元素（无同名基类），直接建类，无特异性冲突。*/
.hcard__poster{ cursor:pointer; }
.hcard__title--clickable{ cursor:pointer; }
.htl-empty{ color:var(--text-faint); padding:0 var(--s-3); }
</style>
