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

function onScroll() {
  updateBar();
  revealBar();
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
  background:var(--horizontal-rail-thumb, var(--rose-dim)); cursor:grab; touch-action:none;
  transition:background .15s;
}
.horizontal-rail__thumb:hover{ background:var(--horizontal-rail-thumb-hover, var(--rose)); }
.horizontal-rail__thumb:active{ background:var(--horizontal-rail-thumb-active, var(--rose-bright)); cursor:grabbing; }
@media (prefers-reduced-motion:reduce){ .horizontal-rail__bar{ transition:none; } }
</style>
