<script setup lang="ts">
// 一起看过 · 老式电影放映机（设计稿移植）
// 左：进片盘 + 片门 3D 胶片滚筒 + 镜头光束；右：月份分组卡片，光束对准的那部点亮、其余压暗。
// 拖/滚滚筒→列表跳到对应月；滚列表→滚筒联动 + 点亮对准卡片；停下吸附到光束线。咔哒音效可静音。
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useIdentity } from '../stores/identity';
import Poster from './Poster.vue';
import Rating from './Rating.vue';
import Dual from './Dual.vue';
import { imgProxy, ratingHref } from '../api/index';
import { fmtWatched } from '../utils/watchedDate';
import type { Session } from '../types';

const router = useRouter();
const identity = useIdentity();
const props = withDefaults(defineProps<{ sessions?: Session[] }>(), { sessions: () => [] });
const emit = defineEmits(['edit']);

const MONTHS = ['', '1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
function ymOf(s: Session) {
  const w = s.watched_at;
  if (!w) return { year: null as number | null, month: 0 };
  const m = Math.floor(w / 100) % 100;
  return { year: Math.floor(w / 10000), month: m >= 1 && m <= 12 ? m : 0 };
}

// 年 → 月分组（新→旧）
const years = computed(() => {
  const byYear = new Map<number, Map<number, Session[]>>();
  const unknown: Session[] = [];
  for (const s of props.sessions) {
    const { year, month } = ymOf(s);
    if (year == null) { unknown.push(s); continue; }
    if (!byYear.has(year)) byYear.set(year, new Map());
    const mm = byYear.get(year)!;
    if (!mm.has(month)) mm.set(month, []);
    mm.get(month)!.push(s);
  }
  const res = [...byYear.keys()].sort((a, b) => b - a).map(year => ({
    year,
    months: [...byYear.get(year)!.keys()].sort((a, b) => b - a).map(m => ({
      m, mLabel: m ? MONTHS[m] : '年内', gid: `g-${year}-${m}`, sessions: byYear.get(year)!.get(m)!,
    })),
  }));
  if (unknown.length) res.push({ year: 0, months: [{ m: 0, mLabel: '未知', gid: 'g-0-0', sessions: unknown }] } as any);
  return res;
});
// 滚筒格子（扁平，新→旧）
const GROUPS = computed(() => {
  const g: { y: number; m: number; yLabel: string; mLabel: string; gid: string; poster: string }[] = [];
  for (const y of years.value) for (const mo of y.months) {
    g.push({ y: y.year, m: mo.m, yLabel: y.year ? String(y.year) : '·', mLabel: mo.mLabel, gid: mo.gid, poster: imgProxy(mo.sessions[0]?.work?.primary_poster_url || '') });
  }
  return g;
});
const fmtDate = (n: any) => fmtWatched(n, ' 看完');
function tags(s: Session) { try { return (JSON.parse(s.work?.genres || '[]') as string[]).slice(0, 3); } catch { return []; } }
function goWork(s: Session) { if (s.work_id) router.push(`/work/${s.work_id}`); }

// ============================================================ 放映机引擎（移植自设计稿）
const STEP = 27, RAD = 100;
const drumWrapEl = ref<HTMLElement | null>(null);
const drumEl = ref<HTMLElement | null>(null);
const tlEl = ref<HTMLElement | null>(null);
const reelTopEl = ref<HTMLElement | null>(null);
const gateEl = ref<HTMLElement | null>(null);
const muted = ref(false);

let rotB = 0, vel = 0, dragging = false, y0 = 0, rot0 = 0, lastActive = -1;
let programScroll = false, scrollTimer: any = null, lastSpyTop = -1, spyT: any = null, snapT: any = null, pollTimer: any = null;
let cells: HTMLElement[] = [];
let cards: HTMLElement[] = [];
const N = () => GROUPS.value.length;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const isMobile = () => window.matchMedia('(max-width: 880px)').matches;
function lineWithinTl() {
  const t = tlEl.value; if (!t) return 0;
  if (isMobile()) return 56;   // 移动端：参考线放在列表顶部附近，避免被顶部胶片条挡住
  const g = gateEl.value; if (!g) return 0;
  const gb = g.getBoundingClientRect(), tb = t.getBoundingClientRect();
  return (gb.top + gb.height / 2) - tb.top;
}
function cardGroupIdx(card: HTMLElement) {
  const sec = card.closest('.mg') as HTMLElement | null;
  if (!sec) return -1;
  return GROUPS.value.findIndex(g => g.y === +sec.dataset.year! && g.m === +sec.dataset.month!);
}
function nearestCard(): HTMLElement | null {
  const t = tlEl.value; if (!t) return null;
  const line = lineWithinTl();
  let best: HTMLElement | null = null, bd = Infinity;
  for (const c of cards) { const ctr = c.offsetTop + c.offsetHeight / 2 - t.scrollTop; const d = Math.abs(ctr - line); if (d < bd) { bd = d; best = c; } }
  return best;
}
function updateLit(rotateDrum: boolean) {
  const t = tlEl.value; if (!t) return;
  const best = nearestCard(); if (!best) return;
  cards.forEach(c => c.classList.toggle('is-lit', c === best));
  t.classList.add('lit-mode');
  if (rotateDrum) { const idx = cardGroupIdx(best); if (idx >= 0) { rotB = idx * STEP; renderDrum(); } }
}
function applyTopPad() {
  const t = tlEl.value; if (!t || !cards.length) return;
  t.style.paddingTop = '0px';
  if (isMobile()) return;   // 移动端不加动态顶部留白（否则会把首卡顶到胶片条后面）
  const pad = lineWithinTl() - cards[0].offsetTop - cards[0].offsetHeight / 2;
  t.style.paddingTop = Math.max(0, Math.round(pad)) + 'px';
}
let suppressTick = false;
function renderDrum() {
  const d = drumEl.value; if (!d) return;
  rotB = clamp(rotB, 0, (N() - 1) * STEP);
  d.style.transform = `rotateX(${rotB}deg)`;
  if (reelTopEl.value) reelTopEl.value.style.transform = `rotate(${rotB * 4.6}deg)`;
  const act = clamp(Math.round(rotB / STEP), 0, N() - 1);
  cells.forEach((c, i) => c.classList.toggle('is-active', i === act));
  if (act !== lastActive) { lastActive = act; if (!suppressTick) tick(); }
}
function programScrollTo(top: number) {
  const t = tlEl.value; if (!t) return;
  const max = t.scrollHeight - t.clientHeight;
  top = Math.max(0, Math.min(top, max));
  programScroll = true; clearTimeout(scrollTimer);
  t.scrollTo({ top, behavior: 'smooth' });
  const t0 = Date.now();
  (function check() {
    const arrived = Math.abs(t.scrollTop - top) < 2;
    if (arrived || Date.now() - t0 > 1300) {
      if (!arrived) t.scrollTop = top;
      lastSpyTop = t.scrollTop; updateLit(false); programScroll = false; return;
    }
    scrollTimer = setTimeout(check, 60);
  })();
}
function selectIdx(i: number, doScroll: boolean) {
  i = clamp(i, 0, N() - 1);
  rotB = i * STEP; renderDrum();
  if (!doScroll) return;
  const g = GROUPS.value[i];
  if (isMobile()) {
    // 移动端走整页滚动：直接滚到该月分组（CSS scroll-margin-top 让它落在胶片条下方）
    document.getElementById(g.gid)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const sec = tlEl.value?.querySelector(`#${CSS.escape(g.gid)}`) as HTMLElement | null;
  const card = sec?.querySelector('.watched-card') as HTMLElement | null;
  if (card) programScrollTo(card.offsetTop + card.offsetHeight / 2 - lineWithinTl());
}
// 移动端：整页滚动时让滚筒静默跟随到当前月（不发声、不归位）
function onWinScroll() {
  if (!isMobile() || dragging) return;
  const bar = 116;
  let idx = 0;
  for (let i = 0; i < GROUPS.value.length; i++) {
    const el = document.getElementById(GROUPS.value[i].gid);
    if (el && el.getBoundingClientRect().top <= bar) idx = i; else break;
  }
  suppressTick = true; rotB = idx * STEP; renderDrum(); suppressTick = false;
}
function settle() { selectIdx(Math.round(rotB / STEP), true); }

// 拖拽 + 惯性
function onDown(e: PointerEvent) {
  ensureAudio();
  dragging = true; vel = 0; y0 = e.clientY; rot0 = rotB;
  drumEl.value?.classList.add('dragging'); drumWrapEl.value?.classList.add('is-grab');
  try { drumWrapEl.value?.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
}
function onMove(e: PointerEvent) {
  if (!dragging) return;
  const nr = rot0 + (e.clientY - y0) * 0.42;
  vel = clamp(nr - rotB, -22, 22);
  rotB = nr; renderDrum();
}
function endDrag() {
  if (!dragging) return; dragging = false;
  drumEl.value?.classList.remove('dragging'); drumWrapEl.value?.classList.remove('is-grab');
  if (Math.abs(vel) > 1.2) requestAnimationFrame(spin); else settle();
}
function spin() {
  if (dragging) return;
  if ((rotB <= 0 && vel < 0) || (rotB >= (N() - 1) * STEP && vel > 0)) vel = 0;
  if (Math.abs(vel) > 0.6) { rotB = clamp(rotB + vel, 0, (N() - 1) * STEP); vel *= 0.9; renderDrum(); requestAnimationFrame(spin); }
  else { vel = 0; settle(); }
}
let wt: any = null;
function onWheel(e: WheelEvent) {
  e.preventDefault(); ensureAudio(); vel = 0;
  rotB = clamp(rotB + e.deltaY * 0.16, 0, (N() - 1) * STEP); renderDrum();
  clearTimeout(wt); wt = setTimeout(settle, 180);
}
// 滚列表联动
function onListScroll() {
  if (programScroll || dragging) return;
  updateLit(true);
  if (isMobile()) return;   // 移动端：滚动只转滚筒反馈，不做归位吸附（避免遮挡）
  clearTimeout(snapT);
  snapT = setTimeout(() => {
    if (programScroll || dragging) return;
    const c = nearestCard();
    if (c) programScrollTo(c.offsetTop + c.offsetHeight / 2 - lineWithinTl());
  }, 220);
}
function onScrollRaw() { clearTimeout(spyT); spyT = setTimeout(onListScroll, 40); }

// 音效（Web Audio 合成机械咔哒）
let actx: any = null, noiseBuf: AudioBuffer | null = null;
function ensureAudio() {
  if (!actx) { try { actx = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch (e) { actx = null; } }
  if (actx && actx.state === 'suspended') actx.resume();
}
function tick() {
  if (muted.value || !actx) return;
  const t = actx.currentTime;
  if (!noiseBuf) { const n = (actx.sampleRate * 0.03) | 0; const buf: AudioBuffer = actx.createBuffer(1, n, actx.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; noiseBuf = buf; }
  const src = actx.createBufferSource(); src.buffer = noiseBuf;
  const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2800;
  const ng = actx.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.12, t + 0.001); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
  src.connect(hp); hp.connect(ng); ng.connect(actx.destination); src.start(t); src.stop(t + 0.03);
  const o = actx.createOscillator(), og = actx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(2400, t);
  og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.05, t + 0.001); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  o.connect(og); og.connect(actx.destination); o.start(t); o.stop(t + 0.035);
}
function toggleMute() { muted.value = !muted.value; if (!muted.value) ensureAudio(); }

function refreshNodes() {
  const d = drumEl.value, t = tlEl.value;
  cells = d ? [...d.querySelectorAll('.dcell')] as HTMLElement[] : [];
  cards = t ? [...t.querySelectorAll('.watched-card')] as HTMLElement[] : [];
}
function init() {
  nextTick(() => {
    refreshNodes();
    rotB = 0; lastActive = 0; renderDrum();
    requestAnimationFrame(() => { applyTopPad(); selectIdx(0, false); updateLit(false); });
  });
}
function onResize() { applyTopPad(); const c = nearestCard(); if (c) programScrollTo(c.offsetTop + c.offsetHeight / 2 - lineWithinTl()); }

onMounted(() => {
  const dw = drumWrapEl.value, t = tlEl.value;
  if (dw) {
    dw.addEventListener('pointerdown', onDown);
    dw.addEventListener('pointermove', onMove);
    dw.addEventListener('pointerup', endDrag);
    dw.addEventListener('pointercancel', endDrag);
    dw.addEventListener('lostpointercapture', endDrag);
    dw.addEventListener('wheel', onWheel, { passive: false });
  }
  if (t) t.addEventListener('scroll', onScrollRaw);
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onWinScroll, { passive: true });
  pollTimer = setInterval(() => {
    if (programScroll || dragging) return;
    const tt = tlEl.value; if (!tt) return;
    if (Math.abs(tt.scrollTop - lastSpyTop) < 1) return;
    lastSpyTop = tt.scrollTop; onListScroll();
  }, 120);
  init();
});
watch(() => props.sessions, () => init(), { deep: false });
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  window.removeEventListener('scroll', onWinScroll);
  clearInterval(pollTimer); clearTimeout(scrollTimer); clearTimeout(snapT); clearTimeout(spyT); clearTimeout(wt);
});
</script>

<template>
  <div class="cinema-glow" aria-hidden="true"></div>
  <div class="watched-layout">
    <div class="beam"></div>
    <!-- 左：放映机 -->
    <aside class="reel-rail">
      <div class="projector">
        <svg class="preel" ref="reelTopEl" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="rim" cx="60" cy="60" r="57" />
          <circle class="flange" cx="60" cy="60" r="54" />
          <circle class="coil" cx="60" cy="60" r="50" /><circle class="coil" cx="60" cy="60" r="45.5" /><circle class="coil" cx="60" cy="60" r="41" />
          <circle class="opening" cx="60" cy="27" r="15" /><circle class="opening" cx="88.6" cy="76.5" r="15" /><circle class="opening" cx="31.4" cy="76.5" r="15" />
          <circle class="hub" cx="60" cy="60" r="17" />
          <rect class="pin" x="57" y="51" width="6" height="18" rx="2" />
        </svg>
        <div class="film-link"></div>
        <div class="gate-frame" ref="gateEl">
          <span class="proj-led"></span>
          <div class="drum-wrap" ref="drumWrapEl">
            <div class="drum" ref="drumEl">
              <div v-for="(g, i) in GROUPS" :key="g.gid" class="dcell" :data-i="i"
                   :style="{ transform: `rotateX(${-i * STEP}deg) translateZ(${RAD}px)` }" @click="selectIdx(i, true)">
                <div class="dcell__pc" :style="g.poster ? { backgroundImage: `url(${g.poster})` } : { '--pc': '#2a2520' }"></div>
                <div class="dcell__txt"><span class="dy">{{ g.yLabel }}</span><span class="dm">{{ g.mLabel }}</span></div>
              </div>
            </div>
            <div class="dgate"><span class="dgate__tick l"></span><span class="dgate__tick r"></span></div>
          </div>
          <div class="lens"><div class="lens__barrel"></div><div class="lens__ring"></div><div class="lens__front"></div></div>
          <div class="lightbeam"></div>
        </div>
      </div>
      <div class="reel-foot">
        <button class="mutebtn" :class="{ 'is-muted': muted }" :data-tip="muted ? '开音效' : '静音'" @click="toggleMute">
          <svg v-if="!muted" viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>
          <svg v-else viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="M22 9l-6 6M16 9l6 6" /></svg>
        </button>
        <span>拖动 / 滚轮 · 连续翻看</span>
      </div>
    </aside>

    <!-- 右：月份分组 -->
    <div class="tl2" ref="tlEl">
      <template v-for="y in years" :key="y.year">
        <div class="tl2__year">{{ y.year || '未知' }}</div>
        <section v-for="mo in y.months" :key="mo.gid" class="mg" :id="mo.gid" :data-year="y.year" :data-month="mo.m">
          <div class="mg__head"><span class="mark"></span>{{ mo.mLabel }}</div>
          <div class="mg__cards">
            <article v-for="s in mo.sessions" :key="s.id" class="watched-card" style="position:relative">
              <button class="card-edit" data-tip="编辑" data-tip-pos="below" @click.stop="emit('edit', s)">
                <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              </button>
              <Poster :color="'#2a2a30'" :url="s.work?.primary_poster_url" :kind="s.work?.is_anime ? '番剧' : ''" style="width:84px;cursor:pointer" @click="goWork(s)" />
              <div class="watched-card__body">
                <h3 class="watched-card__title" style="cursor:pointer" @click="goWork(s)">{{ s.work?.title }} <span class="year">{{ s.work?.year }}</span></h3>
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
          </div>
        </section>
      </template>
    </div>
  </div>
  <div class="cinema-fx" aria-hidden="true"></div>
</template>

<style scoped>
/* .watched-card(+:hover) 基础样式，从 styles/loweve.css「② 一起看过卡片」段搬入（T10 批 4，
   响应式段清点顺手归位：批 1-3 未覆盖这块样式，本次借响应式清点补上，纯剪切未改声明，报
   DONE_WITH_CONCERNS）。.watched-card .poster 是跨组件选择器（.poster 是子组件 Poster.vue
   自身根类），仍留在 loweve.css，不搬。*/
.watched-card{
  display:flex; gap:var(--s-4); padding:var(--s-4);
  background:var(--surface);
  border-radius:var(--r-lg); box-shadow:var(--shadow-card);
  transition:transform .22s var(--ease);
}
.watched-card:hover{ transform:translateY(-3px); }

.watched-layout { display: grid; grid-template-columns: 256px 1fr; gap: var(--s-8); align-items: start; position: relative; }
.reel-rail { position: relative; z-index: 3; position: sticky; top: 88px; display: flex; flex-direction: column; align-items: center; }
.projector { position: relative; display: flex; flex-direction: column; align-items: center; }

.preel { width: 120px; height: 120px; display: block; position: relative; z-index: 2; transition: transform .18s linear; }
.preel .rim { fill: #1c1814; stroke: #80766a; stroke-width: 3; }
.preel .flange { fill: none; stroke: #544b40; stroke-width: 1.5; }
.preel .coil { fill: none; stroke: #39322a; stroke-width: 1.3; }
.preel .opening { fill: #0c0a08; stroke: #4a443c; stroke-width: 1.4; }
.preel .hub { fill: #2b251f; stroke: #80766a; stroke-width: 2; }
.preel .pin { fill: #0c0a08; }

.film-link { width: 28px; height: 26px; margin: -9px 0; z-index: 1; position: relative; background: #0f0c0a; box-shadow: inset 0 0 0 1px rgba(0,0,0,.55); }
.film-link::before, .film-link::after { content: ""; position: absolute; top: 0; bottom: 0; width: 7px; background-image: radial-gradient(circle, #d8cbb0 0 1.9px, transparent 2.4px); background-size: 7px 9px; background-position: center; }
.film-link::before { left: 1px; } .film-link::after { right: 1px; }

.gate-frame { position: relative; z-index: 3; padding: 11px; border-radius: 13px; background: #211c18; border: 1px solid #534b41; box-shadow: 0 18px 42px -18px #000, inset 0 1px 0 rgba(255,255,255,.06); }
.proj-led { position: absolute; left: 12px; top: 11px; width: 7px; height: 7px; border-radius: 50%; background: var(--gold); box-shadow: 0 0 9px var(--gold); animation: projflick 5s steps(1) infinite; z-index: 4; }
@keyframes projflick { 0%,92%,100%{opacity:1} 94%{opacity:.4} 96%{opacity:1} 97%{opacity:.6} 98%{opacity:1} }
@media (prefers-reduced-motion: reduce) { .preel { transition: none; } .proj-led { animation: none; } }

.lens { position: absolute; right: -36px; top: 50%; transform: translateY(-50%); display: flex; align-items: center; z-index: 2; }
.lens__barrel { width: 16px; height: 28px; background: #2b2520; border: 1px solid #62594d; border-radius: 3px 2px 2px 3px; }
.lens__ring { width: 9px; height: 40px; background: #201b16; border: 1px solid #73685a; border-radius: 3px; margin-left: -2px; }
.lens__front { width: 15px; height: 48px; border-radius: 50%; background: radial-gradient(circle at 38% 50%, oklch(0.82 0.10 72 / .55), #131009 72%); border: 2px solid #73685a; margin-left: -3px; box-shadow: 0 0 20px var(--rose-tint); }

.drum-wrap { position: relative; width: 128px; height: 198px; perspective: 600px; border-radius: 7px; overflow: hidden; background: #0d0a08; box-shadow: inset 0 0 40px rgba(0,0,0,.85);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 20%, #000 80%, transparent 100%); mask-image: linear-gradient(to bottom, transparent 0, #000 20%, #000 80%, transparent 100%);
  touch-action: none; user-select: none; -webkit-user-select: none; cursor: grab; }
.drum-wrap.is-grab { cursor: grabbing; }
.beam { position: absolute; left: 214px; top: 54px; width: 58%; height: 440px; z-index: 0; pointer-events: none; background: radial-gradient(56% 46% at 0% 50%, oklch(0.82 0.085 72 / 0.07), transparent 72%); filter: blur(7px); }
.drum { position: absolute; inset: 0; transform-style: preserve-3d; transition: transform .45s var(--ease); }
.drum.dragging { transition: none; }

.lightbeam { position: absolute; left: calc(100% + 22px); top: 50%; transform: translateY(-50%); width: 900px; height: 168px; z-index: 4; pointer-events: none;
  background: linear-gradient(to right, oklch(0.87 0.10 76 / 0.12), oklch(0.86 0.10 76 / 0.03) 52%, transparent 84%); clip-path: polygon(0 41%, 100% 0, 100% 100%, 0 59%); filter: blur(5px); mix-blend-mode: screen; }
.lightbeam::before { content: ""; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 24px; height: 50px; background: radial-gradient(circle, oklch(0.92 0.10 78 / 0.4), transparent 70%); filter: blur(2px); }

:deep(.tl2 .watched-card) { transition: opacity .35s var(--ease), filter .35s var(--ease), box-shadow .35s var(--ease); }
.tl2.lit-mode :deep(.watched-card) { opacity: .74; filter: brightness(.85) saturate(.96); }
.tl2.lit-mode :deep(.watched-card.is-lit) { opacity: 1; filter: none; box-shadow: 0 0 0 1px var(--rose-line), -22px 0 50px -18px oklch(0.86 0.10 75 / 0.34); }

.cinema-glow { position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background: radial-gradient(40% 52% at 13% 52%, oklch(0.82 0.07 72 / 0.08), transparent 62%), radial-gradient(75% 58% at 62% 4%, oklch(0.5 0.03 60 / 0.07), transparent 72%); }

.dcell { position: absolute; left: 9px; right: 9px; top: 50%; height: 44px; margin-top: -22px; backface-visibility: hidden; border-radius: 4px; overflow: hidden; cursor: pointer; background: #0b0908; box-shadow: inset 0 0 0 1px rgba(0,0,0,.55); }
.dcell__pc { position: absolute; inset: 0 13px; background: var(--pc,#16120e); background-size: cover; background-position: center; filter: brightness(.82) saturate(.88); }
.dcell__pc::after { content: ""; position: absolute; inset: 0; background: rgba(0,0,0,.32); }
.dcell::before, .dcell::after { content: ""; position: absolute; top: 0; bottom: 0; width: 13px; background: #0f0c0a; background-image: radial-gradient(circle, #d8cbb0 0 1.9px, transparent 2.4px); background-size: 13px 15px; background-position: center; }
.dcell::before { left: 0; } .dcell::after { right: 0; }
.dcell__txt { position: relative; z-index: 1; height: 100%; display: flex; align-items: center; justify-content: center; gap: 7px; white-space: nowrap; text-shadow: 0 1px 6px rgba(0,0,0,.92); transition: color .2s; }
.dcell__txt .dm { font-family: var(--font-brand); font-style: italic; font-weight: 600; font-size: 18px; color: #ece1c9; line-height: 1; }
.dcell__txt .dy { font-family: var(--font-sans); font-weight: 500; font-size: 10px; color: #b8ac93; letter-spacing: .06em; }
.dcell.is-active .dm { color: var(--rose-bright); }
.dcell.is-active .dy { color: var(--rose); }

.dgate { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); width: 118px; height: 50px; border-radius: 6px; border: 2px solid var(--rose); box-shadow: 0 0 22px var(--rose-tint), inset 0 0 14px var(--rose-tint); pointer-events: none; z-index: 5; }
.dgate__tick { position: absolute; top: 50%; width: 9px; height: 2px; background: var(--rose); transform: translateY(-50%); box-shadow: 0 0 6px var(--rose); }
.dgate__tick.l { left: -11px; } .dgate__tick.r { right: -11px; }

.reel-foot { display: flex; align-items: center; gap: var(--s-3); margin-top: var(--s-5); color: var(--text-faint); font-size: var(--fs-sm); }
.mutebtn { width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line); background: var(--surface-2); color: var(--text-dim); display: grid; place-items: center; transition: all .18s; flex-shrink: 0; }
.mutebtn:hover { color: var(--text); border-color: var(--line); background: var(--surface-3); }
.mutebtn.is-muted { color: var(--text-faint); }
.mutebtn svg { width: 17px; height: 17px; stroke: currentColor; fill: none; stroke-width: 1.7; }

.tl2 { position: relative; z-index: 1; max-height: calc(100vh - 150px); overflow-y: auto; padding: 0 var(--s-2) 46vh 26px; scrollbar-width: thin; scrollbar-color: var(--surface-3) transparent; }
/* 时间脊线：月份节点挂在一条细竖线上，呼应左侧胶片 */
.tl2::before { content: ""; position: absolute; left: 9px; top: 6px; bottom: 46vh; width: 2px; background: linear-gradient(var(--line), var(--line) 88%, transparent); z-index: 0; }
.tl2::-webkit-scrollbar { width: 8px; }
.tl2::-webkit-scrollbar-thumb { background: var(--surface-3); border-radius: var(--r-pill); }
.tl2::-webkit-scrollbar-track { background: transparent; }
.tl2__year { font-family: var(--font-brand); font-style: italic; font-size: var(--fs-2xl); color: var(--rose); margin: var(--s-6) 0 var(--s-2); }
.tl2__year:first-child { margin-top: 0; }
.mg { scroll-margin-top: 8px; }
.mg__head { position: relative; display: flex; align-items: center; gap: var(--s-3); font-size: var(--fs-md); color: var(--text-dim); margin: var(--s-5) 0 var(--s-4); }
.mg__head::after { content: ""; flex: 1; height: 1px; background: var(--line-soft); }
.mg__head .mark { position: absolute; left: -17px; top: 50%; transform: translateY(-50%); width: 9px; height: 9px; border-radius: 50%; background: var(--rose); box-shadow: 0 0 8px var(--rose); }
.mg__cards { display: flex; flex-direction: column; gap: var(--s-4); }

/* 卡片：撑开右侧放双方短评 + 标签；字体层级更硬 */
:deep(.tl2 .watched-card) { align-items: stretch; gap: var(--s-4); }
:deep(.tl2 .watched-card__body) { flex: 0 0 230px; }
:deep(.tl2 .watched-card__title) { font-size: var(--fs-lg); color: var(--text); }
:deep(.tl2 .watched-card__title .year) { color: var(--text-faint); font-weight: 400; font-size: var(--fs-sm); }
:deep(.tl2 .watched-card__date) { font-size: 12px; color: var(--text-faint); }
.wm { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 7px; padding-left: var(--s-4); border-left: 1px solid var(--line-soft); }
.wm__rev { display: flex; align-items: flex-start; gap: 7px; font-size: var(--fs-sm); color: var(--text-dim); line-height: 1.5; }
.wm__who { flex: 0 0 auto; width: 18px; height: 18px; margin-top: 1px; border-radius: 50%; display: grid; place-items: center; font-size: 10px; font-weight: 700; color: var(--bg); border: 1px solid oklch(0 0 0 / 0.28); }
.wm__rev[data-who="a"] .wm__who { background: var(--user-a); }
.wm__rev[data-who="b"] .wm__who { background: var(--user-b); }
.wm__txt { min-width: 0; }
.wm__tags { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 2px; }
.wm__empty { font-size: var(--fs-sm); color: var(--text-faint); }

.cinema-fx { position: fixed; inset: 0; pointer-events: none; z-index: 60; background: radial-gradient(120% 92% at 50% 38%, transparent 56%, rgba(0,0,0,.34) 100%); }
.cinema-fx::before { content: ""; position: absolute; inset: 0; opacity: .05; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); background-size: 170px 170px; }

@media (max-width: 880px) {
  .watched-layout { grid-template-columns: 1fr; gap: var(--s-3); }
  /* 顶部一条轻薄胶片窗：去掉卷盘/镜头/光束/深色面板，背景接近页面色不再是黑块 */
  .reel-rail { position: sticky; top: 52px; z-index: 5; background: var(--bg); padding: 6px 0 var(--s-3); flex-direction: row; align-items: center; gap: var(--s-3); }
  .preel, .film-link, .lens, .lightbeam, .beam, .proj-led { display: none; }
  .projector { flex: 1; min-width: 0; flex-direction: row; align-items: center; }
  .gate-frame { flex: 1; min-width: 0; padding: 0; background: transparent; border: none; box-shadow: none; }
  .drum-wrap { width: 100%; height: 56px; background: var(--surface); border: 1px solid var(--line-soft); box-shadow: none; }
  .reel-foot { margin-top: 0; flex-shrink: 0; }
  .reel-foot span { display: none; }
  .cinema-fx { display: none; }   /* 小屏不要满屏暗角，避免显得糊/挡 */
  /* 列表跟随整页滚动（不再内部滚动），给分组留出胶片条高度 */
  .tl2 { max-height: none; overflow: visible; padding: 0 0 var(--s-8) 20px; }
  .tl2::before { left: 7px; bottom: var(--s-8); }
  .mg { scroll-margin-top: 116px; }
  .tl2__year { scroll-margin-top: 108px; }
  /* 卡片竖排：信息列 + 短评列堆叠；窄屏不压暗 */
  :deep(.tl2 .watched-card) { flex-wrap: wrap; }
  :deep(.tl2 .watched-card__body) { flex: 1 1 170px; }
  .wm { flex: 1 1 100%; border-left: none; border-top: 1px solid var(--line-soft); padding-left: 0; padding-top: var(--s-3); margin-top: var(--s-1); }
  .tl2.lit-mode :deep(.watched-card) { opacity: 1; filter: none; }
  .tl2.lit-mode :deep(.watched-card.is-lit) { box-shadow: none; }
}
/* .watched-card 响应式段同名 @media 规则，随基础样式一并搬入（T10 批 4，见上方旁注）*/
@media (max-width:680px){
  .watched-card{ flex-direction:column; }
}
</style>
