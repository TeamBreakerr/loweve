<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useGameRecos } from '../../stores/gameRecos';
import { useGameSessions } from '../../stores/gameSessions';
import { useGamePlan } from '../../stores/gamePlan';
import { useIdentity } from '../../stores/identity';
import GamePoster from '../../components/games/GamePoster.vue';
import GameRating from '../../components/games/GameRating.vue';
import GamePrice from '../../components/games/GamePrice.vue';
import GameContentBadge from '../../components/games/GameContentBadge.vue';
import FeedbackBtns from '../../components/FeedbackBtns.vue';
import Priority from '../../components/Priority.vue';
import Dual from '../../components/Dual.vue';
import GameAddModal from '../../components/games/GameAddModal.vue';
import GameEditModal from '../../components/games/GameEditModal.vue';
import { fmtWatchedShort } from '../../utils/watchedDate';
import { groupRecoTail, platformLabels, releaseLabel } from '../../utils/games';

const router = useRouter();
const identity = useIdentity();
const recos = useGameRecos();
const sessions = useGameSessions();
const plan = useGamePlan();
const intent = ref('');
const hero = computed(() => recos.items[0]);
const mids = computed(() => recos.items.slice(1, 3));
const minis = computed(() => recos.items.slice(3));
const miniRows = computed(() => groupRecoTail(minis.value));
const playingSessions = computed(() => sessions.list.filter(item => item.completed_at == null && item.plan_status !== 'dropped').slice(0, 6));
const completedSessions = computed(() => sessions.list.filter(item => item.completed_at != null).slice(0, 6));
const visiblePlan = computed(() => plan.list.filter(item => item.status === 'pending').slice(0, 6));
const modalOpen = ref(false);
const modalTarget = ref('couple_played');
const editOpen = ref(false);
const editType = ref('session');
const editRecord = ref<any>(null);
const pickerOpen = ref(false);
const picked = ref<any>(null);
const pickedPriority = ref(0);

onMounted(() => { recos.load(); sessions.load(); plan.load(); });
function submitIntent() { if (intent.value.trim()) recos.custom(intent.value.trim()); }
function refresh() { intent.value.trim() ? submitIntent() : recos.refresh(); }
function feedback(item: any, action: 'want' | 'no' | 'seen') {
  if (action === 'want') { picked.value = item; pickedPriority.value = 0; pickerOpen.value = true; }
  else recos.feedback(item, action);
}
function confirmWant() { if (picked.value) recos.feedback(picked.value, 'want', pickedPriority.value); pickerOpen.value = false; }
function openAdd(target: string) { modalTarget.value = target; modalOpen.value = true; }
function openEdit(type: string, record: any) { editType.value = type; editRecord.value = record; editOpen.value = true; }
function work(id: number) { router.push(`/games/work/${id}`); }
function facts(item: any) { return [releaseLabel(item), ...platformLabels(item.platforms).slice(0, 2)]; }
function miniRank(rowIndex: number, index: number) { return miniRows.value.slice(0, rowIndex).reduce((count, row) => count + row.length, 0) + index + 4; }
</script>

<template>
  <main class="page games-home">
    <section class="section game-section">
      <div class="section__head"><div><span class="game-section__index">01</span><h2 class="section__title">下一款一起玩什么</h2></div><button class="btn btn--icon btn--ghost" data-tip="换一批" :disabled="recos.loading || recos.generating" @click="refresh"><svg class="btn__ic" :class="{ 'spin-loop': recos.loading || recos.generating }" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/></svg></button></div>
      <div class="game-intent"><svg viewBox="0 0 24 24"><path d="M8 8h8a5 5 0 0 1 4.7 6.7l-1 2.8a2 2 0 0 1-3.3.8L14 16h-4l-2.4 2.3a2 2 0 0 1-3.3-.8l-1-2.8A5 5 0 0 1 8 8Z"/><path d="M7 12v4M5 14h4M17 13h.01M19 15h.01"/></svg><input v-model="intent" @keyup.enter="submitIntent" placeholder="例如「本地双人解谜」「允许单人 RPG」「看看未发售期待作」"/><button @click="submitIntent">推荐<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button></div>
      <div v-if="recos.loading || recos.generating" class="game-loading"><span class="game-loading__pad">✦</span>{{ recos.generating ? '新一批游戏正在后台匹配，当前推荐仍可浏览…' : '正在读取你们的游戏口味…' }}</div>
      <p v-if="recos.error && !recos.items.length && !recos.loading" class="game-empty">{{ recos.error === 'llm_unconfigured' ? 'AI 推荐尚未启用，可先手动添加游戏。' : '游戏推荐暂时不可用，请稍后重试。' }}</p>

      <template v-if="recos.items.length">
        <div class="game-rank-top">
          <article v-if="hero" class="game-rank game-rank--hero">
            <span class="game-rank__num">01</span><GamePoster :url="hero.poster_url" :fallback="hero.header_url" :state="hero.release_state" @click="work(hero.work_id)" />
            <div class="game-rank__body"><span class="game-rank__label">TOP MATCH</span><h3 @click="work(hero.work_id)">{{ hero.title }}</h3><GameContentBadge :work="hero"/><p v-if="hero.original_title" class="game-rank__original">{{ hero.original_title }}</p><div class="game-reco-facts"><span v-for="fact in facts(hero)" :key="fact">{{ fact }}</span></div><div class="game-rank__meta"><GameRating :work="hero"/><GamePrice :work="hero"/><span v-if="hero.supports_together" class="game-chip">双人可玩</span></div><div class="game-rank__reason"><span>WHY THIS GAME</span><p>{{ hero.reason }}</p><small v-if="hero.confidence_note">{{ hero.confidence_note }}</small></div><div class="game-rank__actions"><FeedbackBtns want-label="想和你一起玩" seen-label="玩过" @want="feedback(hero,'want')" @no="feedback(hero,'no')" @seen="feedback(hero,'seen')"/></div></div>
          </article>
          <div class="game-rank-mids">
            <article v-for="(item,index) in mids" :key="item.id" class="game-rank game-rank--mid"><span class="game-rank__num">0{{ index + 2 }}</span><GamePoster :url="item.poster_url" :fallback="item.header_url" :state="item.release_state" @click="work(item.work_id)"/><div class="game-rank__body"><h3 @click="work(item.work_id)">{{ item.title }}</h3><GameContentBadge :work="item"/><div class="game-reco-facts"><span v-for="fact in facts(item)" :key="fact">{{ fact }}</span></div><div class="game-rank__meta"><GameRating :work="item" compact/><GamePrice :work="item"/></div><p class="game-rank__reason-small">{{ item.reason }}</p><div class="game-rank__actions"><FeedbackBtns want-label="想和你一起玩" seen-label="玩过" @want="feedback(item,'want')" @no="feedback(item,'no')" @seen="feedback(item,'seen')"/></div></div></article>
          </div>
        </div>
        <div class="game-rank-rail"><div v-for="(row,rowIndex) in miniRows" :key="rowIndex" class="game-rank-rail__row"><article v-for="(item,index) in row" :key="item.id" class="game-mini"><div class="game-mini__poster"><span>{{ String(miniRank(rowIndex,index)).padStart(2,'0') }}</span><GamePoster :url="item.poster_url" :fallback="item.header_url" :state="item.release_state" @click="work(item.work_id)"/><div v-if="item.reason" class="game-mini__reason"><span class="game-mini__reason-hd"><svg viewBox="0 0 24 24"><path d="M12 21s-8-4.5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.5-8 11-8 11Z"/></svg>为什么推给你们</span><p>{{ item.reason }}</p></div></div><div class="game-mini__body"><h4 @click="work(item.work_id)">{{ item.title }}</h4><GameContentBadge :work="item" compact/><div class="game-reco-facts"><span v-for="fact in facts(item)" :key="fact">{{ fact }}</span></div><div class="game-mini__meta"><GameRating :work="item" compact/><GamePrice :work="item"/></div><div class="game-rank__actions"><FeedbackBtns want-label="想和你一起玩" seen-label="玩过" @want="feedback(item,'want')" @no="feedback(item,'no')" @seen="feedback(item,'seen')"/></div></div></article></div></div>
      </template>
    </section>

    <section class="section game-section">
      <div class="section__head"><div><span class="game-section__index">02</span><h2 class="section__title">正在玩</h2></div><div class="section__actions"><button class="btn btn--rose" @click="openAdd('couple_playing')"><svg class="btn__ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>添加</button><router-link class="link-more" to="/games/playing">查看全部</router-link></div></div>
      <p v-if="!sessions.loading && !playingSessions.length" class="game-empty">现在没有共同进行中的游戏。</p>
      <div v-else class="game-history"><article v-for="item in playingSessions" :key="item.id" class="game-history__card"><GamePoster :url="item.work.cover_url" :fallback="item.work.header_url" :state="item.work.release_state" @click="work(item.work_id)"/><button class="game-card-edit" @click="openEdit('session',item)">✎</button><h3 @click="work(item.work_id)">{{ item.work.title }}</h3><GameContentBadge :work="item.work" compact/><Dual :rating-a="item.rating_a ?? '–'" :rating-b="item.rating_b ?? '–'"/><span v-if="item.played_at" class="game-history__date">{{ fmtWatchedShort(item.played_at) }} 开始</span></article></div>
    </section>

    <section class="section game-section">
      <div class="section__head"><div><span class="game-section__index">03</span><h2 class="section__title">一起玩过</h2></div><div class="section__actions"><button class="btn btn--rose" @click="openAdd('couple_played')"><svg class="btn__ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>添加</button><router-link class="link-more" to="/games/together">查看全部</router-link></div></div>
      <p v-if="!sessions.loading && !completedSessions.length" class="game-empty">还没有记录通关的共同游戏。</p>
      <div v-else class="game-history"><article v-for="item in completedSessions" :key="item.id" class="game-history__card"><GamePoster :url="item.work.cover_url" :fallback="item.work.header_url" :state="item.work.release_state" @click="work(item.work_id)"/><button class="game-card-edit" @click="openEdit('session',item)">✎</button><h3 @click="work(item.work_id)">{{ item.work.title }}</h3><GameContentBadge :work="item.work" compact/><Dual :rating-a="item.rating_a ?? '–'" :rating-b="item.rating_b ?? '–'"/><span class="game-history__date">{{ fmtWatchedShort(item.completed_at) }} 通关</span></article></div>
    </section>

    <section class="section game-section">
      <div class="section__head"><div><span class="game-section__index">04</span><h2 class="section__title">想和你一起玩</h2></div><div class="section__actions"><button class="btn btn--rose" @click="openAdd('couple_plan')"><svg class="btn__ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>添加</button><router-link class="link-more" to="/games/plan">查看全部</router-link></div></div>
      <p v-if="!visiblePlan.length" class="game-empty">共同游戏清单还是空的。</p>
      <div v-else class="game-history"><article v-for="item in visiblePlan" :key="item.id" class="game-history__card"><GamePoster :url="item.work.cover_url" :fallback="item.work.header_url" :state="item.work.release_state" @click="work(item.work_id)"/><button class="game-card-edit" @click="openEdit('plan',item)">✎</button><h3 @click="work(item.work_id)">{{ item.work.title }}</h3><GameContentBadge :work="item.work" compact/><div class="game-plan-row"><Priority :value="item.priority"/><span class="game-status">{{ item.status === 'playing' ? '在玩' : '待玩' }}</span></div><small>{{ identity.userById(item.added_by)?.display_name }} 添加</small></article></div>
    </section>

    <GameAddModal v-model="modalOpen" :initial-target="modalTarget" :lock-target="modalTarget === 'couple_plan'" @added="() => { sessions.load(); plan.load(); }" />
    <GameEditModal v-model="editOpen" :type="editType" :record="editRecord" @changed="() => { sessions.load(); plan.load(); }" />
    <div v-if="pickerOpen" class="modal-overlay is-open" @pointerdown.self="pickerOpen = false"><div class="modal game-priority-modal"><div class="modal__head"><h3 class="modal__title">加入“想和你一起玩”</h3><button class="modal__close" @click="pickerOpen=false"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div><div class="modal__body"><p>给《{{ picked?.title }}》设置优先级</p><div class="game-priority-grid"><button v-for="n in [0,1,2,3]" :key="n" class="target" :class="{ 'is-active': pickedPriority === n }" @click="pickedPriority=n">{{ n ? '★'.repeat(n) : '无' }}</button></div></div><div class="modal__foot"><button class="btn btn--primary game-priority-confirm" @click="confirmWant">确认加入</button></div></div></div>
  </main>
</template>

<style scoped>
.games-home {
  padding-top: var(--s-6);
}

.game-section {
  padding-top: var(--s-8);
  border-top: 1px solid var(--line-soft);
}

.game-section:first-child {
  padding-top: 0;
  border-top: 0;
}

.game-section .section__head > div:first-child {
  display: flex;
  align-items: center;
  gap: var(--s-3);
}

.game-section .section__head > .btn {
  margin-left: auto;
}

.game-section__index {
  color: var(--game-accent);
  font-family: var(--font-brand);
  font-size: 14px;
  font-style: italic;
}

.game-intent {
  display: flex;
  align-items: center;
  min-height: 48px;
  margin-bottom: var(--s-5);
  overflow: hidden;
  border: 1px solid var(--game-line);
  border-radius: var(--r-lg);
  background: var(--surface);
}

.game-intent > svg {
  width: 21px;
  margin-left: 14px;
  fill: none;
  stroke: var(--game-accent);
  stroke-width: 1.6;
}

.game-intent input {
  flex: 1;
  min-width: 0;
  padding: 12px 14px;
  border: 0;
  outline: 0;
  color: var(--text);
  background: transparent;
}

.game-intent button {
  display: flex;
  align-items: center;
  align-self: stretch;
  gap: 3px;
  padding: 0 18px;
  color: oklch(.16 .04 240);
  background: var(--game-accent);
  font-weight: 700;
}

.game-intent button svg {
  width: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
}

.game-loading,
.game-empty {
  padding: var(--s-6);
  color: var(--text-faint);
  text-align: center;
}

.game-loading__pad {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-right: 8px;
  border: 1px solid var(--game-line);
  border-radius: 8px;
  color: var(--game-accent);
  animation: gamePulse 1.2s infinite;
}

@keyframes gamePulse {
  50% { transform: rotate(45deg) scale(.86); }
}

.game-rank-top {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(350px, 1fr);
  align-items: stretch;
  gap: var(--s-4);
  min-height: 520px;
}

.game-rank {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: var(--r-xl);
  background: var(--surface);
}

.game-rank__num {
  position: absolute;
  z-index: 3;
  top: 10px;
  right: 12px;
  color: var(--game-accent);
  font-family: var(--font-brand);
  font-size: 19px;
  font-style: italic;
  font-weight: 700;
  text-shadow: 0 2px 10px var(--bg);
}

.game-rank--hero {
  display: grid;
  grid-template-columns: minmax(245px, 50%) 1fr;
  min-height: 520px;
}

.game-rank--hero :deep(.game-poster),
.game-rank--mid :deep(.game-poster) {
  width: 100%;
  min-width: 0;
  height: 100%;
  aspect-ratio: auto;
  border-radius: 0;
  box-shadow: none;
}

.game-rank-top :deep(.game-poster img),
.game-rank-rail :deep(.game-poster img) {
  object-fit: contain;
  background: var(--surface-2);
}

.game-rank__body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  padding: var(--s-5);
  gap: 9px;
}

.game-rank--hero .game-rank__body {
  padding-bottom: 14px;
}

.game-rank__label {
  color: var(--game-accent);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .18em;
}

.game-rank__body h3 {
  padding-right: 24px;
  font-size: clamp(24px, 2.6vw, 34px);
  line-height: 1.16;
  cursor: pointer;
}

.game-rank__original {
  color: var(--text-faint);
}

.game-rank__meta,
.game-mini__meta {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

.game-reco-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.game-reco-facts span {
  padding: 2px 7px;
  border: 1px solid var(--line-soft);
  border-radius: var(--r-pill);
  color: var(--text-faint);
  font-size: 10px;
}

.game-chip,
.game-status {
  padding: 3px 8px;
  border: 1px solid var(--game-line);
  border-radius: var(--r-pill);
  color: var(--game-accent);
  background: var(--game-tint);
  font-size: 11px;
}

.game-rank__reason {
  width: 100%;
  margin-top: 5px;
  padding: var(--s-4);
  border-left: 2px solid var(--game-accent);
  background: linear-gradient(90deg, var(--game-tint), transparent);
}

.game-rank__reason span {
  color: var(--game-accent);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .14em;
}

.game-rank__reason small {
  display: block;
  margin-top: 5px;
  color: var(--text-faint);
}

.game-rank__actions {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: nowrap;
  margin-top: auto;
}

.game-rank__actions :deep(.feedback) {
  flex: 0 0 auto;
}

.game-rank-mids {
  display: grid;
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: var(--s-4);
}

.game-rank--mid {
  display: grid;
  grid-template-columns: minmax(142px, 40%) minmax(0, 1fr);
  min-height: 0;
}

.game-rank--mid .game-rank__body {
  padding: 14px;
  gap: 6px;
}

.game-rank--mid h3 {
  font-size: var(--fs-lg);
}

.game-rank--mid .game-rank__meta {
  padding-right: 22px;
}

.game-rank__reason-small {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.game-rank--mid .game-rank__actions {
  margin-top: auto;
}

.game-rank--mid .game-rank__actions :deep(.feedback) {
  width: 38px;
  height: 34px;
}

.game-rank-rail {
  display: grid;
  gap: 10px;
  padding: var(--s-4) 0;
}

.game-rank-rail__row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
  align-items: stretch;
  gap: 10px;
}

.game-mini {
  display: grid;
  grid-template-columns: clamp(120px, 40%, 154px) minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: var(--r-lg);
  background: var(--surface);
}

.game-mini__poster {
  position: relative;
  align-self: start;
  width: 100%;
  aspect-ratio: 2 / 3;
  background: var(--surface-2);
}

.game-mini__poster :deep(.game-poster) {
  width: 100%;
  height: 100%;
  aspect-ratio: 2 / 3;
  border-radius: 0;
  box-shadow: none;
}

.game-mini__poster > span {
  position: absolute;
  z-index: 2;
  top: 8px;
  right: 8px;
  padding: 3px 7px;
  border: 1px solid var(--game-line);
  border-radius: var(--r-pill);
  color: var(--game-accent);
  background: oklch(.13 .025 250 / .82);
  backdrop-filter: blur(5px);
  font-family: var(--font-brand);
  font-size: 19px;
  font-style: italic;
  font-weight: 700;
  text-shadow: 0 2px 10px var(--bg);
}

/* 与影视推荐一致：第 4 名以后把推荐理由收进封面悬浮层。 */
.game-mini__reason {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 14px 13px;
  background: linear-gradient(180deg, oklch(.15 .035 240 / .76), oklch(.10 .025 250 / .97) 58%);
  backdrop-filter: blur(7px) saturate(1.05);
  opacity: 0;
  pointer-events: none;
  transform: translateY(8px);
  transition: opacity .28s ease, transform .28s ease;
  -webkit-backdrop-filter: blur(7px) saturate(1.05);
}

.game-mini:hover .game-mini__reason {
  opacity: 1;
  transform: translateY(0);
  transition-delay: .4s;
}

.game-mini__reason-hd {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  color: var(--game-accent);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .02em;
  white-space: nowrap;
}

.game-mini__reason-hd svg {
  width: 14px;
  height: 14px;
  fill: currentColor;
  stroke: none;
}

.game-mini__reason p {
  flex: 1 1 auto;
  overflow-y: auto;
  margin: 0;
  color: oklch(.93 .012 235);
  font-size: 13px;
  line-height: 1.52;
  scrollbar-width: none;
}

.game-mini__reason p::-webkit-scrollbar {
  display: none;
}

.game-mini__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  padding: 11px 8px 10px 10px;
  gap: 6px;
}

.game-mini h4 {
  display: -webkit-box;
  min-height: 2.6em;
  overflow: hidden;
  width: 100%;
  padding-right: 0;
  font-size: 16px;
  line-height: 1.3;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  cursor: pointer;
}

.game-mini .game-reco-facts {
  min-height: 21px;
}

.game-mini .game-reco-facts span {
  padding: 2px 6px;
  font-size: 11px;
}

.game-mini__meta {
  align-content: flex-start;
  width: 100%;
  min-height: 55px;
}

.game-mini :deep(.game-rating) {
  gap: 5px;
  padding: 3px 8px 3px 4px;
}

.game-mini :deep(.game-rating__brand) {
  font-size: 10px;
}

.game-mini :deep(.game-rating__score) {
  font-size: 13px;
}

.game-mini :deep(.game-price) {
  gap: 5px;
  font-size: 13px;
}

.game-mini :deep(.game-price strong) {
  font-size: 14px;
}

.game-mini :deep(.game-price__end) {
  font-size: 11px;
}

.game-mini .game-rank__actions {
  margin-top: auto;
}

.game-mini .game-rank__actions :deep(.feedback) {
  width: 36px;
  height: 34px;
}

.game-history {
  display: flex;
  gap: var(--s-4);
  overflow-x: auto;
  padding: var(--s-5) 2px var(--s-4);
  scroll-snap-type: x mandatory;
}

.game-history__card {
  position: relative;
  display: flex;
  flex: 0 0 155px;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.game-history__card h3 {
  font-size: var(--fs-body);
  line-height: 1.3;
  cursor: pointer;
}

.game-card-edit {
  position: absolute;
  z-index: 3;
  top: 8px;
  right: 8px;
  width: 30px;
  height: 30px;
  border: 1px solid var(--game-line);
  border-radius: 50%;
  color: var(--game-accent);
  background: oklch(.16 .03 255 / .86);
}

.game-history__date,
.game-history__card small {
  color: var(--text-faint);
  font-size: 11px;
}

.game-plan-row {
  display: flex;
  align-items: center;
  gap: 7px;
}

.game-priority-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-top: var(--s-4);
}

.game-priority-confirm {
  width: 100%;
}

@media (max-width: 960px) {
  .game-rank-top {
    grid-template-columns: 1fr;
  }

  .game-rank--hero {
    grid-template-columns: minmax(220px, 34%) minmax(0, 1fr);
    min-height: 400px;
  }

  .game-rank-mids {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: none;
  }

  .game-rank--mid {
    min-height: 210px;
  }

}

@media (max-width: 680px) {
  .game-mini__reason {
    display: none;
  }

  .games-home {
    padding-top: var(--s-4);
  }

  .game-section {
    padding-top: var(--s-6);
  }

  .game-section .section__head {
    align-items: center;
  }

  .game-intent button {
    padding: 0 13px;
    font-size: 0;
  }

  .game-intent button svg {
    width: 20px;
  }

  .game-rank--hero {
    grid-template-columns: 124px minmax(0, 1fr);
    height: auto;
    min-height: 360px;
  }

  .game-rank__body {
    padding: 14px;
    gap: 7px;
  }

  .game-rank__body h3 {
    padding-right: 18px;
    font-size: var(--fs-xl);
  }

  .game-rank__reason {
    padding: var(--s-3);
  }

  .game-rank__reason p {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }

  .game-rank__reason small {
    display: none;
  }

  .game-rank-mids {
    grid-template-columns: 1fr;
  }

  .game-rank-rail {
    gap: var(--s-3);
  }

  .game-rank-rail__row {
    grid-template-columns: 1fr;
  }

  .game-mini {
    grid-template-columns: 112px minmax(0, 1fr);
    min-height: 178px;
  }

  .game-rank--mid {
    grid-template-columns: 108px minmax(0, 1fr);
    min-height: 190px;
  }

  .game-mini h4 { min-height: 2.6em; -webkit-line-clamp: 2; }
}

@media (max-width: 400px) {
  .game-rank--hero {
    grid-template-columns: 112px minmax(0, 1fr);
  }

  .game-rank__body h3 {
    font-size: var(--fs-lg);
  }

  .game-rank--hero .game-rank__actions :deep(.feedback) {
    width: 38px;
    height: 36px;
  }
}
</style>
