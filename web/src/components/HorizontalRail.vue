<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

withDefaults(defineProps<{ ariaLabel?: string }>(), {
  ariaLabel: '横向作品列表',
});

const viewport = ref<HTMLElement | null>(null);
const hasOverflow = ref(false);
const barVisible = ref(false);
const thumbWidth = ref(20);
const thumbLeft = ref(0);
let drag: { x: number; scroll: number; trackWidth: number } | null = null;
let resizeObserver: ResizeObserver | null = null;
let mutationObserver: MutationObserver | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const HIDE_DELAY_MS = 1200;
// 停手后多久开始对齐：要盖过滚轮/触控板惯性里两次 scroll 事件的间隔，又不能久到让人先看到半张海报。
const SETTLE_DELAY_MS = 150;
// 落点与最近卡边界差在这个像素数以内就算已经对齐：对齐动画自己派发的 scroll 事件会再排一次
// 检查，靠这个阈值收敛成一次空转，而不是来回拉扯。
const SETTLE_TOLERANCE_PX = 2;
let settleTimer: ReturnType<typeof setTimeout> | null = null;

function clearHideTimer() {
  if (hideTimer == null) return;
  clearTimeout(hideTimer);
  hideTimer = null;
}

function scheduleHide() {
  clearHideTimer();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (drag) {
      scheduleHide();
      return;
    }
    barVisible.value = false;
  }, HIDE_DELAY_MS);
}

function revealBar() {
  if (!hasOverflow.value) return;
  barVisible.value = true;
  scheduleHide();
}

function updateBar() {
  const el = viewport.value;
  if (!el) return;
  const { scrollWidth, clientWidth, scrollLeft } = el;
  if (scrollWidth <= clientWidth + 2) {
    hasOverflow.value = false;
    barVisible.value = false;
    clearHideTimer();
    thumbLeft.value = 0;
    return;
  }
  hasOverflow.value = true;
  thumbWidth.value = Math.max((clientWidth / scrollWidth) * 100, 10);
  thumbLeft.value = (scrollLeft / (scrollWidth - clientWidth)) * (100 - thumbWidth.value);
}

function clearSettleTimer() {
  if (settleTimer == null) return;
  clearTimeout(settleTimer);
  settleTimer = null;
}

// 滑动过程中不干预（吸附会顿挫），停手后才把最近的一张卡对齐到内容左缘，
// 不让海报停在被切一半的位置。末尾一屏对齐到右缘，避免把最后一张卡拉回去。
function settleToNearestCard() {
  const el = viewport.value;
  if (!el || drag) return;
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 0) return;
  const paddingLeft = parseFloat(getComputedStyle(el).paddingLeft) || 0;
  const contentLeft = el.getBoundingClientRect().left + paddingLeft;
  const current = el.scrollLeft;
  let target: number | null = null;
  for (const child of Array.from(el.children) as HTMLElement[]) {
    const offset = child.getBoundingClientRect().left - contentLeft;
    const candidate = Math.min(Math.max(current + offset, 0), max);
    if (target == null || Math.abs(candidate - current) < Math.abs(target - current)) target = candidate;
  }
  if (target == null || Math.abs(target - current) <= SETTLE_TOLERANCE_PX) return;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion:reduce)').matches;
  el.scrollTo({ left: target, behavior: reduceMotion ? 'auto' : 'smooth' });
}

// 对齐期间用户又滑了，浏览器会取消这次平滑滚动；这里不设「动画中不排队」的锁，
// 就是为了让新滑动照样能在停手后拿到自己的对齐。
function scheduleSettle() {
  if (drag) return;
  clearSettleTimer();
  settleTimer = setTimeout(() => {
    settleTimer = null;
    settleToNearestCard();
  }, SETTLE_DELAY_MS);
}

function onScroll() {
  updateBar();
  revealBar();
  scheduleSettle();
}

function onDown(event: PointerEvent) {
  const el = viewport.value;
  if (!el) return;
  drag = { x: event.clientX, scroll: el.scrollLeft, trackWidth: el.clientWidth };
  revealBar();
  (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function onMove(event: PointerEvent) {
  const el = viewport.value;
  if (!drag || !el) return;
  revealBar();
  const travel = drag.trackWidth * (1 - thumbWidth.value / 100) || 1;
  el.scrollLeft = drag.scroll + ((event.clientX - drag.x) / travel) * (el.scrollWidth - el.clientWidth);
}

function onUp() {
  drag = null;
  scheduleHide();
  scheduleSettle();   // 拖滚动条松手同样对齐
}

onMounted(() => nextTick(() => {
  updateBar();
  revealBar();
  if (viewport.value) {
    resizeObserver = new ResizeObserver(updateBar);
    resizeObserver.observe(viewport.value);
    mutationObserver = new MutationObserver(() => nextTick(updateBar));
    mutationObserver.observe(viewport.value, { childList: true, subtree: true });
  }
}));

onBeforeUnmount(() => {
  clearHideTimer();
  clearSettleTimer();
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
});
</script>

<template>
  <div class="horizontal-rail" @pointerenter="revealBar" @pointermove="revealBar" @pointerleave="scheduleHide"
       @focusin="revealBar" @focusout="scheduleHide">
    <div ref="viewport" class="horizontal-rail__viewport" tabindex="0" :aria-label="ariaLabel" @scroll="onScroll">
      <slot />
    </div>
    <div v-show="hasOverflow" class="horizontal-rail__bar" :class="{ 'is-visible': barVisible }" aria-hidden="true">
      <div class="horizontal-rail__thumb" :style="{ width: `${thumbWidth}%`, left: `${thumbLeft}%` }"
           @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp"></div>
    </div>
  </div>
</template>

<style scoped>
.horizontal-rail{ position:relative; min-width:0; }
.horizontal-rail__viewport{
  display:flex; align-items:stretch; gap:var(--horizontal-rail-gap, var(--s-4));
  overflow-x:auto; overflow-y:hidden;
  padding:var(--horizontal-rail-padding, 4px 4px var(--s-4));
  margin:var(--horizontal-rail-margin, 0 -4px);
  /* 不做 scroll-snap：轨道要跟手连续滑动，按海报边界吸附会把每一次滚动都拽成整卡跳格（顿挫感来源）。*/
  overscroll-behavior-x:contain;
  scrollbar-width:none; outline:none;
}
.horizontal-rail__viewport::-webkit-scrollbar{ display:none; }
.horizontal-rail__viewport:focus-visible{ border-radius:var(--r-md); box-shadow:0 0 0 2px var(--rose-line); }
.horizontal-rail__bar{
  height:6px; margin:6px 6px 0; border-radius:999px; background:var(--surface-2); position:relative;
  opacity:0; pointer-events:none; transition:opacity .18s var(--ease);
}
.horizontal-rail__bar.is-visible{ opacity:1; pointer-events:auto; }
.horizontal-rail__thumb{
  position:absolute; top:0; height:6px; min-width:24px; border-radius:999px;
  background:var(--horizontal-rail-thumb, var(--rose-dim)); cursor:ew-resize; touch-action:none;
  transition:background .15s;
}
.horizontal-rail__thumb:hover{ background:var(--horizontal-rail-thumb-hover, var(--rose)); }
.horizontal-rail__thumb:active{ background:var(--horizontal-rail-thumb-active, var(--rose-bright)); }
@media (prefers-reduced-motion:reduce){ .horizontal-rail__bar{ transition:none; } }
</style>
