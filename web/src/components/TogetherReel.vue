<script setup lang="ts">
// 一起看过 · 老式电影放映机（设计稿移植）
// 左：进片盘 + 片门 3D 胶片滚筒 + 镜头光束；右：月份分组卡片，光束对准的那部点亮、其余压暗。
// 拖/滚滚筒→列表跳到对应月；滚列表→滚筒联动 + 点亮对准卡片；停下吸附到光束线。咔哒音效可静音。
import { computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useIdentity } from '../stores/identity';
import Poster from './Poster.vue';
import Rating from './Rating.vue';
import Dual from './Dual.vue';
import { imgProxy, ratingHref } from '../api/index';
import { fmtWatched } from '../utils/watchedDate';
import { buildYears, buildGroups } from '../utils/reelGroups';
import { useReelDrum, STEP, RAD } from '../composables/useReelDrum';
import type { Session } from '../types';

const router = useRouter();
const identity = useIdentity();
const props = withDefaults(defineProps<{ sessions?: Session[] }>(), { sessions: () => [] });
const emit = defineEmits(['edit']);

// 年 → 月分组（新→旧）
const years = computed(() => buildYears(props.sessions));
// 滚筒格子（扁平，新→旧）
const GROUPS = computed(() => buildGroups(years.value, s => imgProxy(s?.work?.primary_poster_url || '')));
const fmtDate = (n: any) => fmtWatched(n, ' 看完');
function tags(s: Session) { try { return (JSON.parse(s.work?.genres || '[]') as string[]).slice(0, 3); } catch { return []; } }
function goWork(s: Session) { if (s.work_id) router.push(`/work/${s.work_id}`); }

// ============================================================ 放映机引擎（抽成 useReelDrum 组合式函数）
const { drumWrapEl, drumEl, tlEl, reelTopEl, gateEl, muted, toggleMute, selectIdx, init } = useReelDrum(() => GROUPS.value);
watch(() => props.sessions, () => init(), { deep: false });
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
            <article v-for="s in mo.sessions" :key="s.id" class="watched-card">
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
   自身根类），仍留在 loweve.css，不搬。
   T12 批 4：<article> 原内联 position:relative 声明直接并入本条已有的 scoped 规则
   （.watched-card 只在本文件模板出现，无跨文件同名规则冲突，属于「并入已有覆盖块」分支）
   ——position:relative 是 .card-edit[data-tip]{position:absolute} 编辑按钮的定位上下文，
   随基础样式一起声明语义更顺。*/
.watched-card{
  display:flex; gap:var(--s-4); padding:var(--s-4);
  background:var(--surface);
  border-radius:var(--r-lg); box-shadow:var(--shadow-card);
  transition:transform .22s var(--ease);
  position:relative;
}
.watched-card:hover{ transform:translateY(-3px); }
/* .watched-card__body/.watched-card__title(+.year)/.watched-card__date(+svg)/
   .watched-card__scores 从 styles/loweve.css「② 一起看过卡片」段搬入（T10 批 6，纯剪切，
   未改声明）。放在下方 :deep(.tl2 ...) 局部覆盖规则之前——同文件内源顺序即层叠顺序，保持
   原「全局基础 → 组件局部覆盖」的胜负方向不变。*/
.watched-card__body{ flex:1; min-width:0; display:flex; flex-direction:column; gap:var(--s-2); }
.watched-card__title{ font-family:var(--font-serif); font-weight:600; font-size:var(--fs-md); }
.watched-card__title .year{ color:var(--text-faint); font-weight:400; font-family:var(--font-sans); font-size:var(--fs-sm); }
.watched-card__date{ display:flex; align-items:center; gap:6px; font-size:var(--fs-sm); color:var(--text-faint); }
.watched-card__date svg{ width:13px; height:13px; stroke:currentColor; fill:none; stroke-width:1.6; }
.watched-card__scores{ display:flex; align-items:center; gap:var(--s-3); flex-wrap:wrap; }

/* ============================================================ 内联样式收编（T12 批 4）
   <Poster> 原内联 width:84px;cursor:pointer 曾误判 width:84px 可直接丢弃（以为与
   loweve.css 的 .watched-card .poster{width:84px} 数值重复、外层规则会接管）——跑
   visual-diff 才发现漏了 loweve.css 响应式段里同选择器、同特异性 (0,2,0) 的
   @media(max-width:680px){ .watched-card .poster{width:100%;aspect-ratio:16/9} }：
   两条规则特异性相同，胜负落到源码顺序，移动端命中的其实是后一条，width 会跳成
   100%（inline 原先能不分视口地恒赢两条，才把这条移动端规则一直盖住）。现改用
   .watched-card .watched-card__poster 两层类选择器，scoped 编译后 (0,4,0)，稳赢
   loweve.css 那两条 (0,2,0)，不论视口/源序，宽度恒为 84px，与内联迁移前像素一致；
   aspect-ratio 未被内联设过，仍走原级联（16/9 由移动端规则接管，桌面走 .poster 基类
   2/3），未受影响。cursor:pointer 是新增语义，手法沿用 Home.vue .hcard__poster /
   Plan.vue .plan-card__poster：落到 <Poster> 子组件根节点（单根组件，fallthrough
   attrs 携带本文件 scoped id）。
   .watched-card__title--clickable 同理沿用 Home.vue .hcard__title--clickable 手法，
   本文件内 .watched-card__title 无其它 cursor 声明，无冲突。*/
.watched-card .watched-card__poster{ width:84px; cursor:pointer; }
.watched-card__title--clickable{ cursor:pointer; }

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
