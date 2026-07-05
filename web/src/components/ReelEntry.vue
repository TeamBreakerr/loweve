<script setup lang="ts">
// 单条胶片卡片：一部「一起看过」的作品（海报 + 信息列 + 双方短评/标签）。
// 从 TogetherReel 拆出（T16）。根节点保持 <article class="watched-card">——作为单根子组件，
// 它会继承父组件 TogetherReel 的 scope 属性，故父那边的 .watched-card 定位/hover 与
// :deep(.tl2 .watched-card…) 仍命中此根节点；但根节点以内的 DOM 只带本组件 scope，
// 故凡命中 article 内部节点的样式都随模板一并迁入本文件（详见下方 <style>）。
import { useRouter } from 'vue-router';
import { useIdentity } from '../stores/identity';
import Poster from './Poster.vue';
import Rating from './Rating.vue';
import Dual from './Dual.vue';
import { ratingHref } from '../api/index';
import { fmtWatched } from '../utils/watchedDate';
import type { Session } from '../types';

const router = useRouter();
const identity = useIdentity();
defineProps<{ s: Session }>();
const emit = defineEmits(['edit']);

const fmtDate = (n: any) => fmtWatched(n, ' 看完');
function tags(s: Session) { try { return (JSON.parse(s.work?.genres || '[]') as string[]).slice(0, 3); } catch { return []; } }
function goWork(s: Session) { if (s.work_id) router.push(`/work/${s.work_id}`); }
</script>

<template>
  <article class="watched-card">
    <button class="card-edit" data-tip="编辑" data-tip-pos="below" @click.stop="emit('edit', s)">
      <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
    </button>
    <Poster :color="'#2a2a30'" :url="s.work?.primary_poster_url" :kind="s.work?.is_anime ? '番剧' : ''" class="watched-card__poster" @click="goWork(s)" />
    <div class="watched-card__body">
      <h3 class="watched-card__title watched-card__title--clickable" @click="goWork(s)">{{ s.work?.title }} <span class="year">{{ s.work?.year }}</span></h3>
      <div v-if="s.watched_at" class="watched-card__date">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 9h18" /></svg>
        {{ fmtDate(s.watched_at) }}
      </div>
      <div class="watched-card__scores">
        <Dual :rating-a="s.rating_a ?? '–'" :rating-b="s.rating_b ?? '–'" />
        <Rating v-if="s.work" :source="s.work.rating_source" :score="s.work.primary_rating?.toFixed(1) || '—'" :href="ratingHref(s.work)" />
      </div>
    </div>
    <div class="wm">
      <p v-if="s.review_a" class="wm__rev" :data-who="identity.whoKey(1)"><span class="wm__who">{{ identity.userById(1)?.display_name?.[0] || 'A' }}</span><span class="wm__txt">{{ s.review_a }}</span></p>
      <p v-if="s.review_b" class="wm__rev" :data-who="identity.whoKey(2)"><span class="wm__who">{{ identity.userById(2)?.display_name?.[0] || 'B' }}</span><span class="wm__txt">{{ s.review_b }}</span></p>
      <div v-if="tags(s).length" class="wm__tags"><span v-for="t in tags(s)" :key="t" class="tag">{{ t }}</span></div>
      <p v-if="!s.review_a && !s.review_b && !tags(s).length" class="wm__empty">这部还没写短评</p>
    </div>
  </article>
</template>

<style scoped>
/* 以下规则的最右选择器命中的都是 article 内部节点（本组件 scope 的 DOM），从 TogetherReel
   随模板迁入（T16，纯剪切，声明零改动）。留在 TogetherReel 的是：.watched-card 根类自身
   （position/hover/680px flex-direction，命中子组件根节点、父 scope 生效）与全部
   :deep(.tl2 .watched-card…)（:deep 跨界穿透，本就为跨组件覆盖而设）。*/

/* .watched-card__body/.watched-card__title(+.year)/.watched-card__date(+svg)/
   .watched-card__scores：原从 loweve.css「② 一起看过卡片」段搬入 TogetherReel（T10 批 6），
   本次随 article 内部 DOM 迁入本组件。放在下方 .wm 一族之前，与原文件源顺序一致。*/
.watched-card__body{ flex:1; min-width:0; display:flex; flex-direction:column; gap:var(--s-2); }
.watched-card__title{ font-family:var(--font-serif); font-weight:600; font-size:var(--fs-md); }
.watched-card__title .year{ color:var(--text-faint); font-weight:400; font-family:var(--font-sans); font-size:var(--fs-sm); }
.watched-card__date{ display:flex; align-items:center; gap:6px; font-size:var(--fs-sm); color:var(--text-faint); }
.watched-card__date svg{ width:13px; height:13px; stroke:currentColor; fill:none; stroke-width:1.6; }
.watched-card__scores{ display:flex; align-items:center; gap:var(--s-3); flex-wrap:wrap; }

/* 内联样式收编（T12 批 4）：两层类选择器 .watched-card .watched-card__poster 编译后特异性
   稳赢 loweve.css 的 .watched-card .poster（含移动端 @media(max-width:680px) 的 width:100%），
   不论视口/源序宽度恒为 84px；cursor 落到 <Poster> 子组件根节点（fallthrough attrs 携带本
   文件 scoped id，Poster 仍是本组件的直接子组件，故此机制不变）。随 article 内部 DOM 迁入本组件。*/
.watched-card .watched-card__poster{ width:84px; cursor:pointer; }
.watched-card__title--clickable{ cursor:pointer; }

.wm { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 7px; padding-left: var(--s-4); border-left: 1px solid var(--line-soft); }
.wm__rev { display: flex; align-items: flex-start; gap: 7px; font-size: var(--fs-sm); color: var(--text-dim); line-height: 1.5; }
.wm__who { flex: 0 0 auto; width: 18px; height: 18px; margin-top: 1px; border-radius: 50%; display: grid; place-items: center; font-size: 10px; font-weight: 700; color: var(--bg); border: 1px solid oklch(0 0 0 / 0.28); }
.wm__rev[data-who="a"] .wm__who { background: var(--user-a); }
.wm__rev[data-who="b"] .wm__who { background: var(--user-b); }
.wm__txt { min-width: 0; }
.wm__tags { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 2px; }
.wm__empty { font-size: var(--fs-sm); color: var(--text-faint); }

@media (max-width: 880px) {
  /* 窄屏短评列堆叠到信息列下方——原 TogetherReel 880px 段内唯一命中 article 内部节点的规则。*/
  .wm { flex: 1 1 100%; border-left: none; border-top: 1px solid var(--line-soft); padding-left: 0; padding-top: var(--s-3); margin-top: var(--s-1); }
}
</style>
