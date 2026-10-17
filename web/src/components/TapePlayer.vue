<script lang="ts">
// 同一页面同时只放一段：开始播放时把上一段暂停
let active: HTMLAudioElement | null = null;
</script>

<script setup lang="ts">
// 讨论录音播放条：替代浏览器默认的 <audio controls>，配色走主题 token
import { computed, onBeforeUnmount, ref } from 'vue';
import { fmtClock } from '../utils/reviewRoom';

const props = defineProps<{ src: string; durationHint?: number }>(); // durationHint：服务端记的时长（秒），元数据到之前先用它

const RATES = [1, 1.25, 1.5, 2];
const STEP: Record<string, number> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 };

const el = ref<HTMLAudioElement>();
const playing = ref(false);
const waiting = ref(false);
const failed = ref(false);
const current = ref(0);
const duration = ref(0);
const bufferedEnd = ref(0);
const rate = ref(1);
let fixing = false;

const total = computed(() => duration.value || props.durationHint || 0);
const pct = computed(() => (total.value ? Math.min(1, current.value / total.value) : 0));
const bufPct = computed(() => (total.value ? Math.min(1, bufferedEnd.value / total.value) : 0));

function toggle() {
  const a = el.value;
  if (!a) return;
  if (a.paused) a.play().catch(() => {});
  else a.pause();
}
function seek(t: number) {
  const a = el.value;
  if (!a || !total.value) return;
  current.value = Math.min(Math.max(0, t), total.value);
  a.currentTime = current.value;
}
function onScrub(e: Event) {
  seek(Number((e.target as HTMLInputElement).value));
}
// 原生 range 按方向键只挪一个 step，换成 ±5 秒
function onKey(e: KeyboardEvent) {
  const d = STEP[e.key];
  if (d == null) return;
  e.preventDefault();
  seek(current.value + d);
}
function cycleRate() {
  rate.value = RATES[(RATES.indexOf(rate.value) + 1) % RATES.length] ?? 1;
  if (el.value) el.value.playbackRate = rate.value;
}

// MediaRecorder 录的 webm 不带总时长（Chrome 的老问题），duration 是 Infinity：进度条没法定位。
// 先跳到极远处逼浏览器读到文件尾算出真实时长，再跳回开头；期间的 timeupdate 不算数。
function onMeta() {
  const a = el.value!;
  if (Number.isFinite(a.duration)) {
    duration.value = a.duration;
    return;
  }
  fixing = true;
  a.currentTime = 1e101;
}
function onDuration() {
  const a = el.value!;
  if (!Number.isFinite(a.duration)) return;
  duration.value = a.duration;
  if (fixing) {
    fixing = false;
    a.currentTime = 0;
  }
}
function onTime() {
  if (fixing) return;
  current.value = el.value!.currentTime;
  onProgress();
}
// 只算当前位置所在的那段缓冲；跳尾取时长时缓冲下来的文件尾不算
function onProgress() {
  const a = el.value!, t = a.currentTime, b = a.buffered;
  let end = 0;
  for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) >= t) end = b.end(i);
  bufferedEnd.value = end;
}
function onPlay() {
  if (active && active !== el.value) active.pause();
  active = el.value!;
  playing.value = true;
}
function onPause() {
  playing.value = false;
  waiting.value = false;
}
onBeforeUnmount(() => {
  if (active === el.value) active = null;
});
</script>

<template>
  <div class="tape" :class="{ 'is-playing': playing }">
    <audio ref="el" :src="src" preload="metadata"
           @loadedmetadata="onMeta" @durationchange="onDuration" @timeupdate="onTime" @progress="onProgress"
           @play="onPlay" @pause="onPause" @ended="onPause"
           @waiting="waiting = true" @playing="waiting = false" @error="failed = true"></audio>

    <button type="button" class="tape__play" :class="{ 'is-waiting': playing && waiting }"
            :aria-label="playing ? '暂停' : '播放'" :disabled="failed" @click="toggle">
      <svg v-if="playing" viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1.3"/><rect x="13.5" y="5" width="4" height="14" rx="1.3"/></svg>
      <svg v-else viewBox="0 0 24 24"><path d="M8.5 5.6v12.8a1 1 0 0 0 1.53.85l10.1-6.4a1 1 0 0 0 0-1.7l-10.1-6.4a1 1 0 0 0-1.53.85z"/></svg>
    </button>

    <template v-if="!failed">
      <button type="button" class="tape__back" data-tip="后退 15 秒" aria-label="后退 15 秒"
              :disabled="!total" @click="seek(current - 15)">
        <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><text x="12" y="14.8" text-anchor="middle">15</text></svg>
      </button>
      <span class="tape__time">{{ fmtClock(current) }}</span>
      <div class="tape__track" :style="{ '--p': pct, '--b': bufPct }">
        <div class="tape__rail"><span class="tape__buf"></span><span class="tape__fill"></span></div>
        <span class="tape__knob"></span>
        <input class="tape__range" type="range" min="0" :max="total || 1" step="any" :value="current"
               :disabled="!total" aria-label="播放进度" :aria-valuetext="`${fmtClock(current)} / ${fmtClock(total)}`"
               @input="onScrub" @keydown="onKey">
      </div>
      <span class="tape__time tape__time--total">{{ total ? fmtClock(total) : '--:--' }}</span>
      <button type="button" class="tape__rate" :class="{ 'is-fast': rate !== 1 }"
              data-tip="播放速度" aria-label="播放速度" @click="cycleRate">{{ rate }}×</button>
    </template>
    <span v-else class="tape__failed">录音没能加载出来，可以先下载下来听。</span>
  </div>
</template>

<style scoped>
.tape{
  display:flex; align-items:center; gap:var(--s-2);
  padding:6px var(--s-3) 6px 6px; border-radius:var(--r-pill);
  background:var(--surface-2); border:1px solid var(--line-soft);
  transition:border-color .2s var(--ease);
}
.tape.is-playing{ border-color:var(--rose-line); }
.tape audio{ display:none; }

.tape__play{
  width:38px; height:38px; flex-shrink:0; border-radius:50%; display:grid; place-items:center;
  background:var(--rose); color:oklch(0.16 0.02 30);
  box-shadow:0 6px 18px -8px var(--rose-dim); transition:transform .15s var(--ease), background .2s;
}
.tape__play:hover:not(:disabled){ background:var(--rose-bright); transform:scale(1.05); }
.tape__play:disabled{ background:var(--surface-3); color:var(--text-faint); box-shadow:none; cursor:not-allowed; }
.tape__play svg{ width:16px; height:16px; fill:currentColor; }
.tape__play.is-waiting svg{ animation:tape-pulse 1.2s ease-in-out infinite; }

.tape__back{
  width:30px; height:30px; flex-shrink:0; border-radius:50%; display:grid; place-items:center;
  color:var(--text-dim); transition:color .15s, background .15s;
}
.tape__back:hover:not(:disabled){ color:var(--text); background:var(--surface-3); }
.tape__back:disabled{ opacity:.4; cursor:not-allowed; }
.tape__back svg{ width:20px; height:20px; stroke:currentColor; fill:none; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
.tape__back text{ fill:currentColor; stroke:none; font-family:var(--font-sans); font-size:7.5px; font-weight:700; }

.tape__time{ flex-shrink:0; min-width:4.5ch; text-align:center; font-size:var(--fs-cap); color:var(--text-dim); font-variant-numeric:tabular-nums; }
.tape__time--total{ color:var(--text-faint); }

/* 进度条：可见的轨道 + 透明 range 叠在上面接管拖动和键盘。
   轨道左右各缩进半个圆钮，圆钮中心才能和填充末端对齐（与原生 thumb 的点击换算一致） */
.tape__track{ --knob:12px; position:relative; flex:1; min-width:48px; height:24px; }
.tape__rail{
  position:absolute; left:calc(var(--knob) / 2); right:calc(var(--knob) / 2); top:50%;
  height:4px; transform:translateY(-50%); border-radius:var(--r-pill); background:var(--surface-3);
  overflow:hidden; transition:height .15s var(--ease);
}
.tape__buf, .tape__fill{ position:absolute; inset:0 auto 0 0; border-radius:inherit; }
.tape__buf{ width:calc(var(--b) * 100%); background:color-mix(in oklch, var(--text-faint) 40%, transparent); }
.tape__fill{ width:calc(var(--p) * 100%); background:var(--rose); }
.tape__knob{
  position:absolute; top:50%; left:calc(var(--knob) / 2 + var(--p) * (100% - var(--knob)));
  width:var(--knob); height:var(--knob); border-radius:50%; pointer-events:none;
  background:var(--rose-bright); box-shadow:0 0 0 4px var(--rose-tint);
  transform:translate(-50%, -50%) scale(0); transition:transform .15s var(--ease), box-shadow .15s;
}
.tape__range{ position:absolute; inset:0; width:100%; height:100%; margin:0; opacity:0; cursor:pointer; }
.tape__range:disabled{ cursor:default; }
.tape__track:has(.tape__range:enabled):hover .tape__rail,
.tape__track:has(.tape__range:focus-visible) .tape__rail{ height:6px; }
.tape__track:has(.tape__range:enabled):hover .tape__knob,
.tape__track:has(.tape__range:focus-visible) .tape__knob{ transform:translate(-50%, -50%) scale(1); }
.tape__track:has(.tape__range:focus-visible) .tape__knob{ box-shadow:0 0 0 4px var(--rose-line); }
@media (hover:none){
  .tape__track:has(.tape__range:enabled) .tape__knob{ transform:translate(-50%, -50%) scale(1); }
}

.tape__rate{
  flex-shrink:0; min-width:46px; padding:4px 8px; border-radius:var(--r-pill);
  border:1px solid var(--line); color:var(--text-dim);
  font-size:var(--fs-cap); font-variant-numeric:tabular-nums; transition:all .15s var(--ease);
}
.tape__rate:hover{ color:var(--text); background:var(--surface-3); }
.tape__rate.is-fast{ color:var(--rose); border-color:var(--rose-line); background:var(--rose-tint); }

.tape__failed{ flex:1; font-size:var(--fs-sm); color:var(--text-faint); }

@keyframes tape-pulse{ 50%{ opacity:.35 } }
@media (max-width:480px){
  .tape__back{ display:none; }
}
@media (prefers-reduced-motion: reduce){
  .tape__play.is-waiting svg{ animation:none; }
}
</style>
