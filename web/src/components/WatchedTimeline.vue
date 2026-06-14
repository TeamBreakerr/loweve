<script setup lang="ts">
// 一起看过 · 横向时间线：按年分组、节点+圆点+竖轴线、左右滚动。
// 自绘滚动条（藏原生）；overscroll-behavior-x 屏蔽左右滑触发的浏览器前进/后退。
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import Poster from './Poster.vue';
import Rating from './Rating.vue';
import Dual from './Dual.vue';
import { fmtWatchedShort } from '../utils/watchedDate';
import { ratingHref } from '../api/index';
import type { Session } from '../types';

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

// —— 自绘滚动条 ——
const scroller = ref<HTMLElement | null>(null);
const barShow = ref(false);
const thumbW = ref(20);   // %
const thumbL = ref(0);    // %
function updateBar() {
  const el = scroller.value!;
  if (!el) return;
  const { scrollWidth, clientWidth, scrollLeft } = el;
  if (scrollWidth <= clientWidth + 2) { barShow.value = false; return; }
  barShow.value = true;
  thumbW.value = Math.max((clientWidth / scrollWidth) * 100, 10);
  thumbL.value = (scrollLeft / (scrollWidth - clientWidth)) * (100 - thumbW.value);
}
// 自动隐藏：滚动/悬停/拖动时显示，空闲淡出（无溢出 barShow=false 直接不渲染）
const active = ref(false);
let hideTimer: any = null;
function showBar() { clearTimeout(hideTimer); active.value = true; }
function scheduleHide(delay = 900) { clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (!drag) active.value = false; }, delay); }
function onScroll() { updateBar(); showBar(); scheduleHide(); }

let drag: any = null;
function onDown(e: any) {
  const el = scroller.value!;
  drag = { x: e.clientX, scroll: el.scrollLeft, trackW: el.clientWidth };
  showBar();
  e.target.setPointerCapture?.(e.pointerId);
  e.preventDefault();
}
function onMove(e: any) {
  if (!drag) return;
  const el = scroller.value!;
  const travel = drag.trackW * (1 - thumbW.value / 100) || 1;
  el.scrollLeft = drag.scroll + ((e.clientX - drag.x) / travel) * (el.scrollWidth - el.clientWidth);
}
function onUp() { drag = null; scheduleHide(); }

watch(() => props.sessions, () => nextTick(updateBar), { deep: false });
onMounted(() => {
  nextTick(() => { updateBar(); if (barShow.value) { showBar(); scheduleHide(1400); } });   // 入场短暂提示可滑
  window.addEventListener('resize', updateBar);
});
onBeforeUnmount(() => { clearTimeout(hideTimer); window.removeEventListener('resize', updateBar); });
</script>

<template>
  <div class="htl-wrap" @pointerenter="showBar" @pointerleave="scheduleHide(300)">
    <div class="htl" ref="scroller" @scroll="onScroll">
      <p v-if="!sessions.length" style="color:var(--text-faint);padding:0 var(--s-3)">还没记录一起看过的作品。</p>
      <template v-for="[year, items] in groups" :key="year">
        <div class="htl-node"><span class="htl-node__dot"></span><span class="htl-node__yr">{{ year }}</span></div>
        <article v-for="s in items" :key="s.id" class="hcard">
          <div class="hcard__pw">
            <Poster :color="'#2a2a30'" :url="s.work?.primary_poster_url" :kind="s.work?.is_anime ? '番剧' : ''"
                    style="cursor:pointer" @click="s.work_id && router.push(`/work/${s.work_id}`)" />
            <div class="hcard__corner">
              <button class="hcard__edit" data-tip="编辑" data-tip-pos="below" @click="emit('edit', s)">
                <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
            </div>
          </div>
          <div class="hcard__body">
            <h3 class="hcard__title" style="cursor:pointer" @click="s.work_id && router.push(`/work/${s.work_id}`)">{{ s.work?.title }} <span class="year">{{ s.work?.year }}</span></h3>
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
    </div>

    <div v-show="barShow" class="htl-sb" :class="{ 'is-on': active }">
      <div class="htl-sb__thumb" :style="{ width: thumbW + '%', left: thumbL + '%' }"
           @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp"></div>
    </div>
  </div>
</template>

<style scoped>
.htl-wrap { position: relative; }
.htl {
  display: flex; align-items: stretch; gap: var(--s-3);
  overflow-x: auto; overflow-y: hidden; padding: 6px 4px 8px; margin: 0 -4px;
  overscroll-behavior-x: contain;          /* 屏蔽左右滑触发的浏览器前进/后退 */
  scrollbar-width: none;                    /* 藏原生滚动条（Firefox）*/
}
.htl::-webkit-scrollbar { display: none; } /* 藏原生滚动条（WebKit）*/
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
/* 自绘横向滚动条（空闲淡出，滚动/悬停/拖动时显示）*/
.htl-sb {
  height: 6px; margin: 6px 6px 0; border-radius: 999px; background: var(--surface-2); position: relative;
  opacity: 0; pointer-events: none; transition: opacity .25s ease;
}
.htl-sb.is-on { opacity: 1; pointer-events: auto; }
.htl-sb__thumb {
  position: absolute; top: 0; height: 6px; min-width: 24px; border-radius: 999px;
  background: var(--rose-dim); cursor: grab; touch-action: none; transition: background .15s;
}
.htl-sb__thumb:hover { background: var(--rose); }
.htl-sb__thumb:active { background: var(--rose-bright); cursor: grabbing; }
</style>
