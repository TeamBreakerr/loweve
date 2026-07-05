// 放映机滚筒引擎：3D 滚筒渲染/拖拽惯性/滚轮/列表联动吸附/咔哒音效。
// 从 TogetherReel.vue 原样抽出（「放映机引擎」注释段全部），行为不变。
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import type { DrumCell } from '../utils/reelGroups';

export const STEP = 27;
export const RAD = 100;

export function useReelDrum(getGroups: () => DrumCell[]) {
// ============================================================ 放映机引擎（移植自设计稿）
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
const N = () => getGroups().length;
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
  return getGroups().findIndex(g => g.y === +sec.dataset.year! && g.m === +sec.dataset.month!);
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
  const g = getGroups()[i];
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
  for (let i = 0; i < getGroups().length; i++) {
    const el = document.getElementById(getGroups()[i].gid);
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
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  window.removeEventListener('scroll', onWinScroll);
  clearInterval(pollTimer); clearTimeout(scrollTimer); clearTimeout(snapT); clearTimeout(spyT); clearTimeout(wt);
});
return { drumWrapEl, drumEl, tlEl, reelTopEl, gateEl, muted, toggleMute, selectIdx, init };
}
