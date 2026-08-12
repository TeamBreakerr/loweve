<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '../../api/index';
import GamePoster from './GamePoster.vue';
import GameRating from './GameRating.vue';
import GamePrice from './GamePrice.vue';
import GameContentBadge from './GameContentBadge.vue';
import ScorePicker from '../ScorePicker.vue';
import DatePicker from '../DatePicker.vue';
import { useIdentity } from '../../stores/identity';
import { groupGameSearchResults, platformLabels, shouldShowGameSearchEmpty } from '../../utils/games';

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  initialTarget: { type: String, default: 'played' },
  fromPlan: { type: Object, default: null },
  initialWork: { type: Object, default: null },
  lockTarget: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue', 'added']);
const identity = useIdentity();
const TARGETS = [
  { key: 'played', label: '我玩过' },
  { key: 'couple_playing', label: '正在玩' },
  { key: 'couple_played', label: '一起玩过' },
  { key: 'couple_plan', label: '想和你一起玩' },
];
const target = ref(props.initialTarget);
const query = ref('');
const results = ref<any[]>([]);
const selected = ref<any>(null);
const searching = ref(false);
const searchError = ref('');
const searchWarning = ref('');
const settledQuery = ref('');
const expandedGroups = ref<Record<string, boolean>>({});
const rating = ref<number | null>(null);
const comment = ref('');
const playedAt = ref<number | null>(null);
const completedAt = ref<number | null>(null);
const note = ref('');
const priority = ref(0);
const saving = ref(false);
const saveError = ref('');
const duplicateError = ref('');
let timer: ReturnType<typeof setTimeout> | null = null;
let requestNo = 0;

const targetLabel = computed(() => TARGETS.find(item => item.key === target.value)?.label || '');
const showTargetPicker = computed(() => !props.lockTarget && !props.fromPlan);
const showEmptySearch = computed(() => shouldShowGameSearchEmpty({
  query: query.value,
  settledQuery: settledQuery.value,
  searching: searching.value,
  resultCount: results.value.length,
  hasError: Boolean(searchError.value),
}));
const resultGroups = computed(() => groupGameSearchResults(results.value));

function reset() {
  if (timer) clearTimeout(timer);
  requestNo++;
  query.value = ''; results.value = []; selected.value = null; searching.value = false;
  expandedGroups.value = {};
  searchError.value = ''; searchWarning.value = ''; settledQuery.value = ''; rating.value = null; comment.value = ''; playedAt.value = null; completedAt.value = null;
  note.value = ''; priority.value = 0; saveError.value = ''; duplicateError.value = '';
  target.value = props.initialTarget;
  if (props.fromPlan?.work) {
    selected.value = props.fromPlan.work;
    query.value = props.fromPlan.work.title;
    target.value = 'couple_playing';
  } else if (props.initialWork) {
    selected.value = props.initialWork;
    query.value = props.initialWork.title || '';
  }
}
watch(() => props.modelValue, open => { if (open) reset(); });
watch(() => props.initialTarget, value => { target.value = value; });

watch(query, value => {
  if (timer) clearTimeout(timer);
  const no = ++requestNo;
  const normalizedQuery = value.trim();
  results.value = [];
  expandedGroups.value = {};
  settledQuery.value = '';
  searchError.value = '';
  searchWarning.value = '';
  if (!props.modelValue || props.fromPlan || !normalizedQuery) { searching.value = false; return; }
  searching.value = true;
  timer = setTimeout(async () => {
    try {
      const data = await api('/api/games/search?q=' + encodeURIComponent(normalizedQuery));
      if (no === requestNo) {
        results.value = data.results || [];
        searchWarning.value = data.warning || '';
        settledQuery.value = normalizedQuery;
      }
    } catch (e) {
      if (no === requestNo) {
        searchError.value = e.body?.error || e.message;
        results.value = [];
        settledQuery.value = normalizedQuery;
      }
    } finally { if (no === requestNo) searching.value = false; }
  }, 250);
});

function openGroup(group: any) {
  if (group.items.length === 1) return pick(group.items[0]);
  expandedGroups.value = { ...expandedGroups.value, [group.key]: !expandedGroups.value[group.key] };
}

async function pick(item: any) {
  selected.value = item; duplicateError.value = ''; saveError.value = '';
  await checkDuplicate();
}
async function checkDuplicate() {
  if (!selected.value) return;
  try {
    const identityParam: Record<string, string> = selected.value.id
      ? { work_id: String(selected.value.id) }
      : selected.value.igdb_id
        ? { igdb_id: String(selected.value.igdb_id) }
        : { steam_appid: String(selected.value.steam_appid) };
    const params = new URLSearchParams({ target: target.value, ...identityParam });
    const data = await api('/api/games/works/duplicate?' + params);
    duplicateError.value = data.duplicate ? data.error : '';
  } catch { duplicateError.value = ''; }
}
watch(target, () => { if (selected.value) checkDuplicate(); });

const errorText = computed(() => ({
  game_mark_exists: '这个游戏已经在你的个人记录里了',
  game_session_exists: '这个游戏已经有共同游玩记录了',
  game_plan_exists: '这个游戏已经在“想和你一起玩”里了',
}[duplicateError.value] || duplicateError.value));
const canSave = computed(() => target.value !== 'couple_played' || completedAt.value != null);

async function save() {
  if (!selected.value || duplicateError.value) return;
  saving.value = true; saveError.value = '';
  const workRef = props.fromPlan ? {}
    : selected.value.id ? { work_id: selected.value.id }
      : selected.value.igdb_id ? { igdb_id: selected.value.igdb_id }
        : { steam_appid: selected.value.steam_appid };
  try {
    let result: any;
    if (target.value === 'played') {
      result = await api('/api/games/marks', { method: 'POST', body: JSON.stringify({ ...workRef, rating: rating.value, comment: comment.value || null }) });
    } else if (target.value === 'couple_playing' || target.value === 'couple_played') {
      const url = props.fromPlan ? `/api/games/sessions?from_plan=${props.fromPlan.id}` : '/api/games/sessions';
      result = await api(url, { method: 'POST', body: JSON.stringify({
        ...workRef, played_at: target.value === 'couple_played' ? playedAt.value : playedAt.value ?? undefined,
        completed_at: target.value === 'couple_played' ? completedAt.value : null,
        rating: rating.value, review: comment.value || null,
      }) });
    } else {
      result = await api('/api/games/plan', { method: 'POST', body: JSON.stringify({ ...workRef, note: note.value || null, priority: priority.value }) });
    }
    emit('added', { target: target.value, result });
    close();
  } catch (e) {
    saveError.value = e.body?.error || e.message;
    if (String(saveError.value).endsWith('_exists')) duplicateError.value = saveError.value;
  } finally { saving.value = false; }
}
function close() { emit('update:modelValue', false); }
</script>

<template>
  <div v-if="modelValue" class="modal-overlay is-open" @pointerdown.self="close">
    <div class="modal game-modal" role="dialog" aria-modal="true">
      <div class="modal__head">
        <div><span class="game-modal__eyebrow">ALL-PLATFORM GAME</span><h3 class="modal__title">添加到 · {{ targetLabel }}</h3></div>
        <button class="modal__close" @click="close" aria-label="关闭"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="modal__body">
        <div v-if="!fromPlan && !initialWork && !selected" class="field">
          <span class="field__label"><span class="step">1</span>搜索全平台游戏</span>
          <div class="search-box">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input v-model="query" type="text" placeholder="游戏名 / Steam AppID 或商店链接…" autofocus />
          </div>
          <p v-if="searching" class="game-hint">正在查询 IGDB 全平台目录与多语言别名…</p>
          <p v-if="searchWarning === 'igdb_unconfigured'" class="game-hint">IGDB 尚未配置，当前临时只搜索 Steam。</p>
          <p v-if="searchError" class="game-hint game-hint--error">游戏目录暂时不可用，请稍后重试</p>
        </div>

        <div v-if="!selected && resultGroups.length" class="game-results">
          <section v-for="group in resultGroups" :key="group.key" class="game-result-group" :class="{ 'is-open': expandedGroups[group.key] }">
            <button class="game-result game-result--group" @click="openGroup(group)">
              <GamePoster :url="group.preview.cover_url" :fallback="group.preview.header_url" :state="group.preview.release_state" />
              <span class="game-result__body">
                <span class="game-result__heading">
                  <span><strong>{{ group.title }}</strong><small v-if="group.original_title">{{ group.original_title }}</small></span>
                  <span v-if="group.items.length > 1" class="game-result__family">本体 + {{ group.dlcCount }} 个 DLC</span>
                </span>
                <span class="game-result__platforms"><i v-for="platform in platformLabels(group.preview.platforms).slice(0,4)" :key="platform">{{ platform }}</i></span>
                <span class="game-result__facts">
                  <span class="game-result__meta"><GameRating :work="group.preview" compact /><GamePrice :work="group.preview" /></span>
                  <span class="game-result__release">{{ group.preview.release_date || '发售日未知' }}</span>
                </span>
              </span>
              <svg v-if="group.items.length > 1" class="game-result__chevron" viewBox="0 0 24 24"><path d="m8 10 4 4 4-4"/></svg>
            </button>
            <div v-if="expandedGroups[group.key] && group.items.length > 1" class="game-result-children">
              <button v-for="item in group.items" :key="item.igdb_id || `steam-${item.steam_appid}`" class="game-result-child" @click="pick(item)">
                <GamePoster :url="item.cover_url" :fallback="item.header_url" :state="item.release_state" />
                <span><b>{{ item.title }}</b><GameContentBadge :work="item" compact/><small>{{ item.content_type === 'dlc' ? '追加内容' : '游戏本体' }}</small></span>
                <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>
              </button>
            </div>
          </section>
        </div>
        <p v-else-if="!selected && showEmptySearch" class="game-hint">没有找到对应的游戏或 DLC。</p>

        <div v-if="selected" class="game-selected">
          <GamePoster :url="selected.cover_url" :fallback="selected.header_url" :state="selected.release_state" />
          <div><span class="game-selected__label">已选择</span><h4>{{ selected.title }}</h4><GameContentBadge :work="selected"/><span class="game-result__platforms"><i v-for="platform in platformLabels(selected.platforms).slice(0,5)" :key="platform">{{ platform }}</i></span><GameRating :work="selected"/><GamePrice :work="selected" /></div>
          <button v-if="!fromPlan && !initialWork" class="btn btn--ghost" @click="selected = null">换一个</button>
        </div>

        <template v-if="selected">
          <div v-if="showTargetPicker" class="field">
            <span class="field__label"><span class="step">2</span>加入哪里</span>
            <div class="target-list target-list--game">
              <button v-for="item in TARGETS" :key="item.key" class="target" :class="{ 'is-active': target === item.key }" :disabled="!!fromPlan && item.key !== 'couple_played'" @click="target = item.key">{{ item.label }}</button>
            </div>
          </div>
          <template v-if="target === 'played' || target === 'couple_playing' || target === 'couple_played'">
            <div v-if="target === 'couple_playing' || target === 'couple_played'" class="field"><span class="field__label">首次共同游玩日（{{ target === 'couple_playing' ? '留空则今天' : '可空' }}）</span><DatePicker v-model="playedAt" /></div>
            <div v-if="target === 'couple_played'" class="field"><span class="field__label">通关日（必填）</span><DatePicker v-model="completedAt" /><span v-if="completedAt == null" class="game-required">填写后记录才会进入“一起玩过”</span></div>
            <div class="field"><ScorePicker v-model="rating" :label="`${identity.viewingName} 的评分`" /></div>
            <div class="field"><span class="field__label">短评</span><textarea v-model="comment" class="review-input" placeholder="这款游戏玩起来怎么样…"></textarea></div>
          </template>
          <template v-else>
            <div class="field"><span class="field__label">优先级</span><div class="target-list target-list--priority"><button v-for="n in [0,1,2,3]" :key="n" class="target" :class="{ 'is-active': priority === n }" @click="priority = n">{{ n ? '★'.repeat(n) : '无' }}</button></div></div>
            <div class="field"><span class="field__label">备注</span><textarea v-model="note" class="review-input" placeholder="为什么想和 TA 一起玩…"></textarea></div>
          </template>
        </template>
        <p v-if="errorText" class="game-hint game-hint--error">{{ errorText }}</p>
        <p v-if="saveError && !duplicateError" class="game-hint game-hint--error">保存失败：{{ saveError }}</p>
      </div>
      <div v-if="selected" class="modal__foot"><button class="btn btn--primary game-submit" :disabled="saving || !!duplicateError || !canSave" @click="save">{{ saving ? '保存中…' : `加入「${targetLabel}」` }}</button></div>
    </div>
  </div>
</template>

<style scoped>
.game-modal{ border-color:var(--game-line); box-shadow:0 24px 80px -24px oklch(.45 .18 240 / .55); }
.game-modal__eyebrow{ color:var(--game-accent); font-size:10px; font-weight:800; letter-spacing:.16em; }
.search-box{ display:flex; align-items:center; gap:var(--s-3); margin-top:var(--s-2); padding:var(--s-3) var(--s-4); border:1px solid var(--line); border-radius:var(--r-md); background:var(--surface-2); }
.search-box:focus-within{ border-color:var(--game-line); }
.search-box svg{ flex:0 0 auto; width:18px; height:18px; stroke:var(--text-faint); fill:none; stroke-width:1.7; }
.search-box input{ flex:1; min-width:0; color:var(--text); background:none; border:0; outline:0; font-size:var(--fs-body); }
.search-box input::placeholder{ color:var(--text-faint); }
.game-results{ display:grid; gap:var(--s-2); max-height:390px; overflow:auto; }
.game-result-group{ overflow:hidden; border:1px solid var(--line-soft); border-radius:var(--r-md); background:var(--surface-2); }
.game-result-group.is-open{ border-color:var(--game-line); }
.game-result{ display:grid; width:100%; min-height:152px; grid-template-columns:96px minmax(0,1fr) auto; align-items:stretch; text-align:left; gap:var(--s-4); padding:12px; background:var(--surface-2); transition:all .18s; }
.game-result:hover{ border-color:var(--game-line); transform:translateY(-1px); }
.game-result--group :deep(> .game-poster){ width:96px; height:100%; min-height:128px; aspect-ratio:auto; border-radius:10px; box-shadow:none; }
.game-result__body{ min-width:0; display:flex; flex-direction:column; align-items:flex-start; gap:8px; }
.game-result__heading{ display:flex; width:100%; min-width:0; align-items:flex-start; justify-content:space-between; gap:10px; }
.game-result__heading>span:first-child{ display:flex; min-width:0; flex-direction:column; gap:2px; }
.game-result__body strong{ color:var(--game-accent); font-size:16px; line-height:1.25; }
.game-result__body small,.game-result__release{ color:var(--text-faint); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.game-result__facts{ display:flex; width:100%; align-items:flex-end; justify-content:space-between; gap:10px; margin-top:auto; }
.game-result__meta{ display:flex; min-width:0; align-items:center; gap:8px; flex-wrap:wrap; }
.game-result__release{ flex:0 0 auto; font-size:11px; font-variant-numeric:tabular-nums; }
.game-result__platforms{ display:flex; flex-wrap:wrap; gap:4px; }
.game-result__platforms i{ padding:2px 7px; border:1px solid var(--line-soft); border-radius:var(--r-pill); color:var(--text-faint); font-size:10px; font-style:normal; }
.game-result__family{ flex:0 0 auto; padding:3px 8px; border:1px solid var(--game-line); border-radius:var(--r-pill); color:var(--game-accent); background:var(--game-tint); font-size:10px; }
.game-result__chevron{ align-self:center; width:20px; fill:none; stroke:var(--game-accent); stroke-width:1.8; transition:transform .18s; }
.game-result-group.is-open .game-result__chevron{ transform:rotate(180deg); }
.game-result-children{ display:grid; gap:1px; padding:0 8px 8px 20px; }
.game-result-child{ display:grid; grid-template-columns:38px minmax(0,1fr) 18px; align-items:center; gap:10px; padding:7px 9px; text-align:left; border-top:1px solid var(--line-soft); background:oklch(.18 .026 250 / .45); }
.game-result-child:hover{ background:var(--game-tint); }
.game-result-child :deep(.game-poster){ width:38px; border-radius:6px; box-shadow:none; }
.game-result-child>span{ display:flex; min-width:0; flex-wrap:wrap; align-items:center; gap:5px; }
.game-result-child b{ overflow:hidden; flex-basis:100%; color:var(--text); font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
.game-result-child small{ color:var(--text-faint); font-size:10px; }
.game-result-child>svg{ width:16px; fill:none; stroke:var(--text-faint); stroke-width:1.8; }
.game-selected{ display:grid; grid-template-columns:76px 1fr auto; align-items:center; gap:var(--s-3); padding:var(--s-3); border:1px solid var(--game-line); background:linear-gradient(135deg,var(--game-tint),var(--surface-2)); border-radius:var(--r-lg); }
.game-selected>div{ display:flex; flex-direction:column; align-items:flex-start; gap:5px; min-width:0; }
.game-selected h4{ font-size:var(--fs-md); line-height:1.25; }
.game-selected__label{ color:var(--game-accent); font-size:10px; font-weight:700; letter-spacing:.1em; }
.target-list{ display:grid; gap:var(--s-2); }
.target-list--game{ grid-template-columns:repeat(2,1fr); }
.target-list--priority{ grid-template-columns:repeat(4,1fr); }
.game-hint{ color:var(--text-faint); font-size:var(--fs-sm); }
.game-hint--error{ color:var(--rose-bright); }
.game-required{ color:var(--game-accent); font-size:var(--fs-sm); }
.game-submit{ width:100%; }
@media(max-width:560px){
  .game-result{ min-height:132px; grid-template-columns:76px minmax(0,1fr) auto; gap:10px; padding:10px; }
  .game-result--group :deep(> .game-poster){ width:76px; min-height:110px; }
  .game-result__heading{ flex-direction:column; gap:5px; }
  .game-result__facts{ align-items:flex-start; flex-direction:column; gap:5px; }
  .game-selected{ grid-template-columns:64px 1fr; }.game-selected>.btn{ grid-column:1/-1; }.target-list--game{ grid-template-columns:1fr; }
}
</style>
