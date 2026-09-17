// 放映机滚筒引擎：3D 滚筒渲染/拖拽惯性/滚轮/列表联动吸附/咔哒音效。
// 从 TogetherReel.vue 抽出；吸附/跳月的程序滚动已改为可打断的 rAF 动画（见 programScrollTo 旁注）。
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
let programScroll = false, snapRaf = 0, lastSpyTop = -1, spyT: any = null, snapT: any = null, pollTimer: any = null;
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
// 卡片对准光束线的目标 scrollTop。卡片很高（长短评）时"居中"会把标题顶出列表顶部，
// 这时改为让卡片顶边贴着列表顶——光束线仍落在卡片内部，标题也看得见。
function snapTargetFor(card: HTMLElement) {
  return Math.min(card.offsetTop + card.offsetHeight / 2 - lineWithinTl(), card.offsetTop - 8);
}
function updateLit(rotateDrum: boolean) {
  const t = tlEl.value; if (!t) return;
  const best = nearestCard(); if (!best) return;
  cards.forEach(c => c.classList.toggle('is-lit', c === best));
  t.classList.add('lit-mode');
  if (rotateDrum) { const idx = cardGroupIdx(best); if (idx >= 0) { rotB = idx * STEP; renderDrum(); } }
}
// 列表两端留白按光束线实际位置算：顶部让首卡在 scrollTop=0 时正对光束线，底部让末卡在滚到
// 最底时正对光束线。原先底部固定 46vh，只在约 900px 高的视口碰巧够用——更高的窗口滚到底后
// 末卡停在光束下方，灯照不到。放映机是 sticky 的，页面本身一滚光束线相对列表就会移动，
// 所以页面滚动停下后也要重算（见 onWinScroll）。
let lastLine = -1;
function applyPads(force = false) {
  const t = tlEl.value; if (!t || !cards.length) return;
  if (isMobile()) {   // 移动端整页滚动，不加动态留白（否则会把首卡顶到胶片条后面）
    t.style.paddingTop = '0px'; t.style.paddingBottom = ''; t.style.removeProperty('--tl2-pad-bottom');
    lastLine = -1; return;
  }
  const line = lineWithinTl();
  if (!force && Math.abs(line - lastLine) < 1) return;
  lastLine = line;
  const first = cards[0], last = cards[cards.length - 1];
  const prevTop = parseFloat(t.style.paddingTop) || 0;
  t.style.paddingTop = '0px';   // 先清零再量，offsetTop 不含旧留白
  const top = Math.max(0, Math.round(line - first.offsetTop - first.offsetHeight / 2));
  const boxH = parseFloat(getComputedStyle(t).maxHeight) || t.clientHeight;
  const bottom = Math.max(0, Math.round(boxH - line - last.offsetHeight / 2));
  t.style.paddingTop = top + 'px';
  t.style.paddingBottom = bottom + 'px';
  t.style.setProperty('--tl2-pad-bottom', bottom + 'px');   // 时间脊线跟着留白收尾
  // 顶部留白变化会把内容整体推移；不在顶部时同步补偿 scrollTop，视觉上内容不动
  if (t.scrollTop > 0 && top !== prevTop) t.scrollTop += top - prevTop;
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
// 程序滚动（吸附/跳月）自己用 rAF 驱动而不是 scrollTo({behavior:'smooth'})：
// 原生平滑滚动一旦被用户滚轮打断就再也到不了目标，旧实现等 1.3s 后硬写 scrollTop 把列表
// 拽回去（实测一次跳 900px），期间还冻结了点亮/滚筒联动——这就是"回弹卡顿"的来源。
// 现在任何用户输入（滚轮/触摸/拖滚动条/键盘）立刻取消程序滚动，用户永远优先。
function cancelProgramScroll() {
  if (snapRaf) cancelAnimationFrame(snapRaf);
  snapRaf = 0; programScroll = false;
}
function programScrollTo(top: number) {
  const t = tlEl.value; if (!t) return;
  cancelProgramScroll();
  top = clamp(top, 0, t.scrollHeight - t.clientHeight);
  const from = t.scrollTop, dist = top - from;
  if (Math.abs(dist) < 1) { lastSpyTop = t.scrollTop; updateLit(false); return; }
  programScroll = true;
  const dur = clamp(Math.abs(dist) * 0.9, 180, 420);   // 距离越远略久，封顶 420ms
  const ease = (x: number) => 1 - Math.pow(1 - x, 3);   // easeOutCubic，收尾柔和
  const t0 = performance.now();
  const frame = (now: number) => {
    const pgs = Math.min(1, (now - t0) / dur);
    t.scrollTop = from + dist * ease(pgs);
    if (pgs < 1) { snapRaf = requestAnimationFrame(frame); return; }
    snapRaf = 0;
    lastSpyTop = t.scrollTop; updateLit(false);
    // 最后一次写 scrollTop 的 scroll 事件下一帧才派发，等它过去再解除标记，避免被当成用户滚动
    requestAnimationFrame(() => { programScroll = false; });
  };
  snapRaf = requestAnimationFrame(frame);
}
// 停下后把离光束线最近的卡片吸过来；停在列表顶/底边缘是用户的明确意图（想看第一张的完整
// 标题 / 已经到底），不再往回吸——首卡很高时"居中"意味着标题被顶出视口，旧逻辑会反复把
// 滚到顶的列表拽回 149px，这正是"从下往上滑会卡"的另一半原因。
function snapToNearest() {
  const t = tlEl.value; if (!t || programScroll || dragging) return;
  const max = t.scrollHeight - t.clientHeight;
  if (t.scrollTop <= 1 || t.scrollTop >= max - 1) { updateLit(false); return; }
  const c = nearestCard();
  if (c) programScrollTo(snapTargetFor(c));
}
function onUserScrollIntent() { if (programScroll) cancelProgramScroll(); }
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
  if (card) programScrollTo(snapTargetFor(card));
}
// 页面（window）滚动：
// 桌面端放映机是 sticky 的，页面一滚光束线相对列表就移动了——停下后重算留白并重新对准；
// 移动端整页滚动时让滚筒静默跟随到当前月（不发声、不归位）
let winScrollT: any = null;
function onWinScroll() {
  if (dragging) return;
  if (!isMobile()) {
    clearTimeout(winScrollT);
    winScrollT = setTimeout(() => { applyPads(); snapToNearest(); }, 120);
    return;
  }
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
  snapT = setTimeout(snapToNearest, 220);
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
    requestAnimationFrame(() => { applyPads(true); selectIdx(0, false); updateLit(false); });
  });
}
function onResize() { applyPads(true); snapToNearest(); }

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
  if (t) {
    t.addEventListener('scroll', onScrollRaw);
    // 用户一动手就取消进行中的程序滚动（滚轮 / 触摸 / 拖滚动条 / 键盘）
    t.addEventListener('wheel', onUserScrollIntent, { passive: true });
    t.addEventListener('touchstart', onUserScrollIntent, { passive: true });
    t.addEventListener('pointerdown', onUserScrollIntent);
    t.addEventListener('keydown', onUserScrollIntent);
  }
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
  cancelProgramScroll();
  clearInterval(pollTimer); clearTimeout(snapT); clearTimeout(spyT); clearTimeout(wt); clearTimeout(winScrollT);
});
return { drumWrapEl, drumEl, tlEl, reelTopEl, gateEl, muted, toggleMute, selectIdx, init };
}
