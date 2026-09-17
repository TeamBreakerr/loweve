<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { api, tmdbPoster, imgProxy } from '../api/index';
import { useIdentity } from '../stores/identity';
import ScorePicker from './ScorePicker.vue';
import DatePicker from './DatePicker.vue';
import Priority from './Priority.vue';
import Rating from './Rating.vue';

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  initialTarget: { type: String, default: 'watched' },  // watched|couple_watched|couple_plan
  fromPlan: { type: Object, default: null },             // 可选：{id, work} 触发闭环模式
});
const emit = defineEmits(['update:modelValue', 'added']);

const identity = useIdentity();

const TARGETS = [
  { key: 'watched',         label: '我看过' },
  { key: 'couple_watched',  label: '一起看过' },
  { key: 'couple_plan',     label: '想看就一起看' },
];

// —— Step 1 搜索 ——
const query = ref('');
const candidates = ref<any[]>([]);
const searching = ref(false);
const searchError = ref('');
let searchTimer: any = null;

watch(query, (q) => {
  clearTimeout(searchTimer);
  if (!q.trim()) { candidates.value = []; return; }
  searchTimer = setTimeout(async () => {
    searching.value = true;
    searchError.value = '';
    try {
      const data = await api('/api/search?q=' + encodeURIComponent(q.trim()));
      candidates.value = data.results;
    } catch (e) {
      searchError.value = e.body?.error || e.message;
      candidates.value = [];
    } finally {
      searching.value = false;
    }
  }, 350);
});

// —— Step 1b 榜单：豆瓣 Top250 / Bangumi 动画排行，用来系统性补完记录 ——
// 榜单页缓存在模块级（弹窗重开不重拉；服务端另有 12h 缓存），本地状态徽标每次打开重新拉第一页刷新。
type ChartKey = 'douban_top250' | 'bangumi_anime';
const CHART_TABS: { key: 'search' | ChartKey; label: string }[] = [
  { key: 'search', label: '搜索' },
  { key: 'douban_top250', label: '豆瓣 Top250' },
  { key: 'bangumi_anime', label: 'Bangumi 动画榜' },
];
const mode = ref<'search' | ChartKey>('search');
const chartPages = ref<Record<ChartKey, any[]>>({ douban_top250: [], bangumi_anime: [] });
const chartMeta = ref<Record<ChartKey, { total: number | null; has_more: boolean; page: number }>>({
  douban_top250: { total: null, has_more: true, page: 0 },
  bangumi_anime: { total: null, has_more: true, page: 0 },
});
const chartLoading = ref(false);
const chartError = ref('');
const hideRecorded = ref(false);
const resolvingId = ref<string | null>(null);
const resolveError = ref('');

const chartItems = computed(() => (mode.value === 'search' ? [] : chartPages.value[mode.value]));
const visibleChartItems = computed(() => hideRecorded.value ? chartItems.value.filter(it => !isRecorded(it)) : chartItems.value);
const recordedCount = computed(() => chartItems.value.filter(isRecorded).length);
const chartMetaCur = computed(() => (mode.value === 'search' ? null : chartMeta.value[mode.value]));
// 「已记录」按当前目标列表判断：加到「我看过」看 mine，加到「一起看过」看 couple，加到「想看」看 couple/plan
function isRecorded(it: any) {
  if (target.value === 'watched') return Boolean(it.mine);
  if (target.value === 'couple_watched') return Boolean(it.couple);
  return Boolean(it.couple || it.plan);
}

// 每次「加载更多」至少补 50 条（Bangumi 接口单页只有 20，一次点击连拉几页，服务端按页缓存不重复打上游）
const LOAD_CHUNK = 50;
async function loadChart(chart: ChartKey, { reset = false } = {}) {
  if (chartLoading.value) return;
  const meta = chartMeta.value[chart];
  if (!reset && !meta.has_more) return;
  chartLoading.value = true; chartError.value = '';
  try {
    let page = reset ? 0 : meta.page, added = 0, hasMore = true, total: number | null = meta.total;
    const items = reset ? [] : [...chartPages.value[chart]];
    while (hasMore && added < LOAD_CHUNK) {
      const data = await api(`/api/charts/${chart}?page=${page + 1}`);
      page += 1; items.push(...data.items); added += data.items.length;
      hasMore = Boolean(data.has_more); total = data.total;
      if (!data.items.length) break;
    }
    chartPages.value[chart] = items;
    chartMeta.value[chart] = { total, has_more: hasMore, page };
  } catch (e) {
    chartError.value = e.body?.error || e.message;
  } finally {
    chartLoading.value = false;
  }
}
// 重开弹窗时把已加载的页原样刷一遍（服务端有缓存，很快），让「已记录」徽标反映别处（搜索添加 / 另一台设备）的变化，
// 且不丢失翻到第几页的进度——系统性补完时会反复开关弹窗。
async function refreshChart(chart: ChartKey) {
  const meta = chartMeta.value[chart];
  if (!meta.page || chartLoading.value) return;
  try {
    const pages = await Promise.all(Array.from({ length: meta.page }, (_, i) => api(`/api/charts/${chart}?page=${i + 1}`)));
    chartPages.value[chart] = pages.flatMap((d: any) => d.items);
    const last = pages[pages.length - 1];
    chartMeta.value[chart] = { total: last.total, has_more: Boolean(last.has_more), page: meta.page };
  } catch { /* 刷新失败就沿用上次的状态 */ }
}
function switchMode(m: 'search' | ChartKey) {
  mode.value = m; resolveError.value = '';
  if (m !== 'search' && !chartPages.value[m].length) loadChart(m, { reset: true });
}
// 点榜单条目 → 解析成 TMDB 候选 → 走原有选季/评分/保存流程；TMDB 找不到就把片名回填搜索框让用户手动找
async function pickChartItem(it: any) {
  if (resolvingId.value) return;
  resolvingId.value = `${it.source}:${it.source_id}`; resolveError.value = '';
  try {
    const { candidate } = await api('/api/charts/resolve', { method: 'POST', body: JSON.stringify({
      source: it.source, source_id: it.source_id, title: it.title, original_title: it.original_title, year: it.year, kind: it.kind,
    }) });
    await onSelect({ ...candidate, _chart: { source: it.source, source_id: it.source_id, rank: it.rank } });
  } catch (e) {
    const code = e.body?.error || e.message;
    if (code === 'tmdb_not_found') {
      resolveError.value = `TMDB 里没找到《${it.title}》，已把片名填进搜索框，试试手动找`;
      query.value = it.title; mode.value = 'search';
    } else {
      resolveError.value = code === 'tmdb_not_configured' ? 'TMDB 未配置，请检查 .env' : code;
    }
  } finally {
    resolvingId.value = null;
  }
}
// 保存成功后把榜单里这一条的本地状态就地标上，继续往下补不用重拉
function markChartRecorded(sel: any, t: string) {
  const c = sel?._chart; if (!c) return;
  for (const list of Object.values(chartPages.value)) {
    const it = list.find((x: any) => x.source === c.source && x.source_id === c.source_id);
    if (!it) continue;
    if (t === 'watched') it.mine = true;
    else if (t === 'couple_watched') it.couple = true;
    else it.plan = true;
  }
}

// —— Step 2 选作品 ——
const selected = ref<any>(null);
const seasons = ref<any[]>([]);                  // 选中 TV 时拉到的季列表
const seasonNumber = ref<number | null>(null);   // null=整部；N=第N季
const episodeCount = ref<number | null>(null);   // TMDB 只有一个可追踪季时显示总集数

// 选中一个候选：收起候选列表（模板据 selected 收起），若是剧集拉季列表供分季
async function onSelect(c: any) {
  selected.value = c;
  seasons.value = [];
  seasonNumber.value = null;
  episodeCount.value = null;
  if (c.tmdb_type === 'tv') {
    try {
      const data = await api('/api/tv/' + c.tmdb_id + '/seasons');
      seasons.value = data.seasons || [];
      episodeCount.value = data.track_by_season ? null : data.episode_count || null;
    } catch { seasons.value = []; }   // 拉季失败不挡添加，退化为整部
  }
}
function reselect() { selected.value = null; seasons.value = []; seasonNumber.value = null; episodeCount.value = null; }

// —— Step 3 选目标列表 ——
const target = ref(props.initialTarget);

// —— Step 4 详情 ——
const rating = ref<number | null>(null);
const comment = ref('');
const watchedAt = ref<number | null>(null);     // 留空由服务端统一补成当天
const planNote = ref('');
const planPriority = ref(0);

// —— from_plan 模式：预填（提取成函数，reset 时也要重新套用，否则开窗会被清空）——
function prefillFromPlan() {
  const fp = props.fromPlan;
  if (!fp) return false;
  target.value = 'couple_watched';
  selected.value = {
    tmdb_id: fp.work.tmdb_id,
    tmdb_type: fp.work.tmdb_type,
    title: fp.work.title,
    year: fp.work.year,
    poster_path: fp.work.primary_poster_url
      ? fp.work.primary_poster_url.replace(/^.*\/t\/p\/w\d+/, '')
      : null,
    _fromPlan: true,
    _workId: fp.work.id,
  };
  query.value = fp.work.title;
  return true;
}
watch(() => props.fromPlan, () => { prefillFromPlan(); }, { immediate: true });

// —— 重置 ——
function reset() {
  candidates.value = [];
  seasons.value = [];
  seasonNumber.value = null;
  episodeCount.value = null;
  rating.value = null;
  comment.value = '';
  watchedAt.value = null;
  planNote.value = '';
  planPriority.value = 0;
  saving.value = false;
  saveError.value = '';
  resolveError.value = ''; chartError.value = ''; resolvingId.value = null;
  if (!prefillFromPlan()) {   // 普通模式才清空走搜索；from_plan 模式保留预填
    query.value = '';
    selected.value = null;
    target.value = props.initialTarget;
    // 停留在上次的榜单页签和翻页进度；重开时静默刷新已加载的页，让「已记录」徽标反映最新状态
    if (mode.value !== 'search') refreshChart(mode.value);
  } else {
    mode.value = 'search';
  }
}
watch(() => props.modelValue, (open) => { if (open) reset(); });
watch(() => props.initialTarget, (t) => { target.value = t; });

// —— 保存 ——
const saving = ref(false);
const saveError = ref('');
const duplicateError = ref('');
const duplicateChecking = ref(false);
let duplicateTimer: any = null;
let duplicateRequest = 0;

const ERROR_LABELS: Record<string, string> = {
  mark_exists: '这部作品已经在你的个人片单里了',
  session_exists: '这部作品已经在「一起看过」里了',
  plan_exists: '这部作品已经在「想看就一起看」里了',
};
function errorLabel(code: string) { return ERROR_LABELS[code] || code; }

async function checkDuplicate() {
  const requestId = ++duplicateRequest;
  const item = selected.value;
  duplicateError.value = '';
  if (!props.modelValue || !item) { duplicateChecking.value = false; return; }

  const params = new URLSearchParams({ target: target.value });
  if (item._workId) {
    params.set('work_id', String(item._workId));
  } else {
    params.set('tmdb_id', String(item.tmdb_id));
    params.set('tmdb_type', item.tmdb_type);
    if (seasonNumber.value != null) params.set('season_number', String(seasonNumber.value));
  }

  duplicateChecking.value = true;
  try {
    const data = await api('/api/works/duplicate?' + params.toString());
    if (requestId === duplicateRequest) duplicateError.value = data.duplicate ? data.error : '';
  } catch {
    // 前置探测失败不阻塞添加；写入 API 仍会做最终重复校验。
  } finally {
    if (requestId === duplicateRequest) duplicateChecking.value = false;
  }
}

watch(
  [selected, target, seasonNumber, () => identity.viewing, () => props.modelValue],
  () => {
    clearTimeout(duplicateTimer);
    duplicateRequest++;
    saveError.value = '';
    duplicateError.value = '';
    duplicateChecking.value = Boolean(props.modelValue && selected.value);
    if (props.modelValue && selected.value) duplicateTimer = setTimeout(checkDuplicate, 120);
  },
);

function close() { emit('update:modelValue', false); }

// 评分输入清空后会留 '' 或 NaN，归一成 null，避免后端 400 invalid_rating
function cleanRating(r: any) {
  return (r === '' || r == null || Number.isNaN(r)) ? null : r;
}

async function save() {
  if (!selected.value || duplicateError.value || duplicateChecking.value) return;
  saving.value = true;
  saveError.value = '';
  try {
    const workRef = selected.value._workId
      ? { work_id: selected.value._workId }
      : { tmdb_id: selected.value.tmdb_id, tmdb_type: selected.value.tmdb_type, season_number: seasonNumber.value };
    let result;
    if (target.value === 'watched') {
      result = await api('/api/marks', {
        method: 'POST',
        body: JSON.stringify({
          ...workRef,
          status: 'watched',
          rating: cleanRating(rating.value),
          comment: comment.value || null,
        }),
      });
    } else if (target.value === 'couple_watched') {
      const url = props.fromPlan ? `/api/sessions?from_plan=${props.fromPlan.id}` : '/api/sessions';
      result = await api(url, {
        method: 'POST',
        body: JSON.stringify({
          ...(props.fromPlan ? {} : workRef),
          watched_at: watchedAt.value,
          rating: cleanRating(rating.value),
          review: comment.value || null,
        }),
      });
    } else if (target.value === 'couple_plan') {
      result = await api('/api/plan', {
        method: 'POST',
        body: JSON.stringify({
          ...workRef,
          note: planNote.value || null,
          priority: planPriority.value,
        }),
      });
    }
    markChartRecorded(selected.value, target.value);
    emit('added', { target: target.value, result });
    close();
  } catch (e) {
    saveError.value = e.body?.error || e.message;
    if (ERROR_LABELS[saveError.value]) duplicateError.value = saveError.value;
  } finally {
    saving.value = false;
  }
}

const targetLabel = computed(() => TARGETS.find(t => t.key === target.value)?.label || '');

function ifSelected(c: any) { return selected.value && selected.value.tmdb_id === c.tmdb_id && selected.value.tmdb_type === c.tmdb_type; }
</script>

<template>
  <!-- pointerdown 而非 click：拖 textarea 手柄松手在遮罩上时 click 会误关，见 EditModal -->
  <div v-if="modelValue" class="modal-overlay is-open" @pointerdown.self="close">
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal__head">
        <h3 class="modal__title">添加到 · {{ targetLabel }}</h3>
        <button class="modal__close" @click="close" aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="modal__body">

        <!-- Step 1: 搜索 / 榜单 -->
        <div class="field" v-if="!fromPlan">
          <span class="field__label"><span class="step">1</span>{{ mode === 'search' ? '搜索作品' : '从榜单里挑' }}</span>
          <div class="mode-tabs" role="tablist">
            <button v-for="t in CHART_TABS" :key="t.key" class="target mode-tab" role="tab"
                    :class="{ 'is-active': mode === t.key }" :aria-selected="mode === t.key" @click="switchMode(t.key)">{{ t.label }}</button>
          </div>
          <template v-if="mode === 'search'">
            <div class="search-box">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
              <input type="text" v-model="query" placeholder="输入片名 / 番名…" />
            </div>
            <p v-if="searching" class="search-hint search-hint--info">搜索中…</p>
            <p v-if="searchError" class="search-hint search-hint--error">{{ searchError === 'tmdb_not_configured' ? 'TMDB 未配置，请检查 .env' : searchError }}</p>
          </template>
          <p v-if="resolveError" class="search-hint search-hint--error">{{ resolveError }}</p>
        </div>

        <!-- Step 1b: 榜单列表（选中后收起，和搜索候选一样改由"已选"块展示）-->
        <div class="field" v-if="!fromPlan && mode !== 'search' && !selected">
          <div class="chart-bar">
            <span class="chart-bar__stat">
              已加载 {{ chartItems.length }}<template v-if="chartMetaCur?.total"> / {{ chartMetaCur.total }}</template>
              <template v-if="recordedCount"> · 已记录 {{ recordedCount }}</template>
            </span>
            <label class="chart-bar__toggle"><input type="checkbox" v-model="hideRecorded" />隐藏已记录</label>
          </div>
          <div class="chart-list">
            <div v-for="it in visibleChartItems" :key="it.source + ':' + it.source_id"
                 class="result chart-item" :class="{ 'is-recorded': isRecorded(it), 'is-resolving': resolvingId === it.source + ':' + it.source_id }"
                 @click="pickChartItem(it)">
              <span class="chart-item__rank">{{ it.rank ?? '—' }}</span>
              <div class="poster" :style="{ '--p1': '#2a2a30' }">
                <img v-if="it.poster_url" :src="imgProxy(it.poster_url)" alt="" referrerpolicy="no-referrer" />
              </div>
              <div class="result__info">
                <div class="result__name">{{ it.title }} <span class="year">{{ it.year }}</span><span v-if="it.original_title" class="result__original-title">  {{ it.original_title }}</span></div>
                <div class="result__sub chart-item__sub">
                  <Rating :source="it.source" :score="it.score != null ? it.score.toFixed(1) : '—'" :href="it.url" />
                  <span v-if="it.votes">{{ it.votes >= 10000 ? (it.votes / 10000).toFixed(1) + ' 万人' : it.votes + ' 人' }}</span>
                  <span v-if="it.subtitle" class="chart-item__subtitle">{{ it.subtitle }}</span>
                </div>
              </div>
              <span v-if="it.mine || it.couple || it.plan" class="chart-item__badges">
                <span v-if="it.mine" class="chart-badge chart-badge--mine">我看过</span>
                <span v-if="it.couple" class="chart-badge chart-badge--couple">一起看过</span>
                <span v-else-if="it.plan" class="chart-badge chart-badge--plan">想看</span>
              </span>
              <span v-else class="result__check chart-item__add" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg></span>
            </div>
            <p v-if="!chartLoading && !visibleChartItems.length && chartItems.length" class="search-hint search-hint--info">这一页都记录过了，点「加载更多」继续往下补</p>
            <p v-if="chartError" class="search-hint search-hint--error">榜单暂时拉不到（{{ chartError }}），稍后再试或用搜索</p>
            <button v-if="chartMetaCur?.has_more || chartLoading" class="target chart-more" :disabled="chartLoading" @click="loadChart(mode as ChartKey)">
              {{ chartLoading ? '加载中…' : '加载更多' }}
            </button>
          </div>
        </div>

        <!-- Step 2: 候选（选中即整块收起，改由下方"已选"块展示）-->
        <div class="field" v-if="!fromPlan && mode === 'search' && candidates.length && !selected">
          <span class="field__label"><span class="step">2</span>选择结果</span>
          <div class="results">
            <div v-for="c in candidates" :key="c.tmdb_type + ':' + c.tmdb_id"
                 class="result" :class="{ 'is-selected': ifSelected(c) }"
                 @click="onSelect(c)">
              <div class="poster" :style="{ '--p1': '#2a2a30' }">
                <img v-if="c.poster_path" :src="imgProxy(tmdbPoster(c.poster_path, 'w92'))" alt="" referrerpolicy="no-referrer" />
              </div>
              <div class="result__info">
                <div class="result__name">{{ c.title }} <span class="year">{{ c.year }}</span><span v-if="c.original_title && c.original_title !== c.title" class="result__original-title">  {{ c.original_title }}</span></div>
                <div class="result__sub">
                  {{ c.tmdb_type === 'movie' ? '电影' : '剧/番' }} · TMDB {{ c.vote_average?.toFixed(1) || '—' }}
                  <span v-if="c.via" class="result__via"> · {{ c.via }}</span>
                </div>
              </div>
              <span class="result__check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 6 9 17l-5-5"/></svg></span>
            </div>
          </div>
        </div>

        <!-- 已选中：收起候选，显示选中项 + 换一个 + 剧集季选择器 -->
        <div class="field" v-if="selected && !fromPlan">
          <div class="result is-selected">
            <div class="poster">
              <img v-if="selected.poster_path" :src="imgProxy(tmdbPoster(selected.poster_path, 'w92'))" alt="" referrerpolicy="no-referrer" />
              <img v-else-if="selected.poster_url" :src="imgProxy(selected.poster_url)" alt="" referrerpolicy="no-referrer" />
            </div>
            <div class="result__info">
              <div class="result__name">{{ selected.title }} <span class="year">{{ selected.year }}</span></div>
              <div class="result__sub">{{ selected.tmdb_type === 'movie' ? '电影' : '剧/番' }}<span v-if="episodeCount"> · 全 {{ episodeCount }} 集</span><span v-if="selected.via" class="result__via"> · {{ selected.via }}</span></div>
            </div>
            <button class="reselect-btn" @click="reselect">换一个</button>
          </div>
          <div v-if="seasons.length" class="season-pick">
            <button class="target season-all-opt" :class="{ 'is-active': seasonNumber === null }" @click="seasonNumber = null">整部（非单季）</button>
            <button v-for="s in seasons" :key="s.season_number" class="target season-opt"
                    :class="{ 'is-active': seasonNumber === s.season_number }" @click="seasonNumber = s.season_number">第{{ s.season_number }}季</button>
          </div>
        </div>

        <!-- 详情（目标列表由上下文决定，标题已显示「添加到 · X」，不再让用户四选） -->
        <div v-if="selected || fromPlan">
          <!-- 我看过 -->
          <div v-if="target === 'watched'" class="field">
            <span class="field__label"><span class="step">{{ fromPlan ? 1 : 3 }}</span>评分 & 短评（可选）</span>
            <ScorePicker v-model="rating" label="我的评分" />
            <textarea class="review-input review-input--gap" v-model="comment" placeholder="写一句感想…"></textarea>
          </div>

          <!-- 一起看过 -->
          <div v-else-if="target === 'couple_watched'">
            <div class="field">
              <span class="field__label"><span class="step">{{ fromPlan ? 1 : 3 }}</span>看完日期（留空默认今天，也可只记到年或月）</span>
              <DatePicker v-model="watchedAt" />
            </div>
            <div class="field">
              <span class="field__label"><span class="step">{{ fromPlan ? 2 : 4 }}</span>{{ identity.viewingName }} 这侧（可选）</span>
              <ScorePicker v-model="rating" :label="`${identity.viewingName} 的评分`" />
              <textarea class="review-input review-input--gap" v-model="comment" :placeholder="`${identity.viewingName} 的短评…`"></textarea>
            </div>
          </div>

          <!-- 想看就一起看（只需选优先级，备注/状态都不再维护）-->
          <div v-else-if="target === 'couple_plan'">
            <div class="field">
              <span class="field__label"><span class="step">3</span>优先级（可选）</span>
              <div class="rate-row">
                <button v-for="n in [0,1,2,3]" :key="n" class="target prio-opt plan-prio-opt"
                        :class="{ 'is-active': planPriority === n }"
                        @click="planPriority = n"><span v-if="n === 0">无</span><Priority v-else :value="n" :total="n" /></button>
              </div>
            </div>
          </div>
        </div>

        <p v-if="duplicateChecking" class="duplicate-note duplicate-note--checking">正在检查是否已添加…</p>
        <p v-else-if="duplicateError" class="duplicate-note duplicate-note--error">{{ errorLabel(duplicateError) }}</p>
        <p v-else-if="saveError" class="save-error">{{ errorLabel(saveError) }}</p>
      </div>
      <div class="modal__foot">
        <button class="btn btn--primary submit-btn" :disabled="(!selected && !fromPlan) || saving || duplicateChecking || Boolean(duplicateError)" @click="save">
          {{ saving ? '保存中…' : duplicateError ? '已存在，不能重复添加' : `保存到「${targetLabel}」` }}
        </button>
        <button class="btn" @click="close">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 从 styles/loweve.css「Modal」段搬入（T10 批 5，纯剪切，未改声明）。.result .poster 是本
   组件模板里的原生 <div class="poster">（非 <Poster> 子组件根节点），不算跨组件选择器，
   一并搬入。*/
.field__label .step{ width:18px; height:18px; border-radius:50%; background:var(--rose); color:oklch(0.16 0.02 30); display:grid; place-items:center; font-size:11px; font-weight:700; }
.search-box{
  display:flex; align-items:center; gap:var(--s-2);
  background:var(--surface-2); border:1px solid var(--line); border-radius:var(--r-md); padding:11px var(--s-4);
}
.search-box svg{ width:18px; height:18px; stroke:var(--text-faint); fill:none; stroke-width:1.7; }
.search-box input{ flex:1; background:none; border:none; outline:none; color:var(--text); font-size:var(--fs-body); }
.search-box input::placeholder{ color:var(--text-faint); }
.results{ display:flex; flex-direction:column; gap:6px; }
.result{
  display:flex; align-items:center; gap:var(--s-3); padding:var(--s-2);
  border-radius:var(--r-md); border:1px solid transparent; transition:all .18s;
}
.result:hover{ background:var(--surface-2); }
.result.is-selected{ background:var(--surface-3); border-color:var(--rose); }
.result .poster{ width:40px; border-radius:var(--r-xs); }
.result__info{ flex:1; }
.result__name{ font-family:var(--font-serif); font-weight:500; font-size:var(--fs-body); }
.result__sub{ font-size:var(--fs-sm); color:var(--text-faint); }
.result__check{ width:20px; height:20px; border-radius:50%; border:1.5px solid var(--line); display:grid; place-items:center; }
.result.is-selected .result__check{ background:var(--rose); border-color:var(--rose); }
.result.is-selected .result__check svg{ width:12px; height:12px; stroke:var(--bg); stroke-width:3; opacity:1; }
.result__check svg{ opacity:0; }

/* ============================================================ 内联样式收编（T12）
   以下均由原静态内联 style 属性收编而成，声明逐字节保持原值，零像素改动。
   .search-hint 是本文件新起的小 block：两个提示 <p> 原内联的 font-size:var(--fs-sm) 与
   margin-top:6px 完全同值，合并进基类；二者仅有的差异（文字颜色）保留为独立修饰类，
   未强行合并不同值。.result__original-title/.result__via 是 .result 的新增 BEM
   element（未在别处出现）。.review-input--gap 是 .review-input 的修饰类，两处 textarea
   原内联同值 margin-top:var(--s-3) 合并于此——.review-input 定义于 primitives.css 且
   未设置 margin-top，无声明冲突。.plan-prio-opt 覆盖的 .target{padding:var(--s-3)} 来自
   primitives.css（未 scoped，特异性 (0,1,0)），本类经 Vue scoped 编译后带
   [data-v-xxx] 属性选择器（特异性 (0,2,0)），稳赢；与 Home.vue 的 .want-modal__prio-opt
   取值不同（flex/padding 均不同），按规则各自独立起名，不合并。.save-error/.submit-btn
   与 EditModal.vue 同名同值的 .error-msg/.submit-btn 纯属巧合重复，两文件各自 scoped
   隔离，不构成跨文件共享基类，未合并。*/
.search-hint{ font-size:var(--fs-sm); margin-top:6px; }
.search-hint--info{ color:var(--text-faint); }
.search-hint--error{ color:var(--rose-bright); }
.result__original-title{ color:var(--text-faint); font-weight:400; margin-left:6px; }
.result__via{ color:var(--rose); font-weight:500; }
.review-input--gap{ margin-top:var(--s-3); }
.plan-prio-opt{ flex:0 0 auto; padding:6px 12px; }
.save-error{ color:var(--rose-bright); font-size:var(--fs-sm); }
.duplicate-note{ padding:9px 12px; border-radius:var(--r-md); font-size:var(--fs-sm); }
.duplicate-note--checking{ color:var(--text-faint); background:var(--surface-2); border:1px solid var(--line-soft); }
.duplicate-note--error{ color:var(--rose-bright); background:var(--rose-tint); border:1px solid var(--rose-line); }
.submit-btn{ flex:1; }

/* 榜单页签 + 榜单列表 */
.mode-tabs{ display:flex; gap:6px; margin-bottom:var(--s-2); }
.mode-tab{ flex:0 0 auto; padding:6px 12px; border-radius:var(--r-pill); }
.chart-bar{ display:flex; align-items:center; justify-content:space-between; gap:var(--s-3); font-size:var(--fs-sm); color:var(--text-faint); }
.chart-bar__toggle{ display:inline-flex; align-items:center; gap:6px; cursor:pointer; color:var(--text-dim); }
.chart-bar__toggle input{ accent-color:var(--rose); }
.chart-list{ display:flex; flex-direction:column; gap:6px; max-height:52vh; overflow:auto; padding-right:2px; scrollbar-width:thin; scrollbar-color:var(--surface-3) transparent; }
.chart-item{ cursor:pointer; }
.chart-item.is-recorded{ opacity:.55; }
.chart-item.is-recorded:hover{ opacity:.85; }
.chart-item.is-resolving{ background:var(--surface-3); border-color:var(--rose-line); cursor:progress; }
.chart-item__rank{ flex:0 0 28px; text-align:right; font-family:var(--font-brand); font-style:italic; font-weight:600; font-size:var(--fs-md); color:var(--gold); }
.chart-item__sub{ display:flex; flex-wrap:wrap; align-items:center; gap:6px 8px; margin-top:3px; }
.chart-item__subtitle{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:260px; }
.chart-item__badges{ display:flex; flex-direction:column; align-items:flex-end; gap:3px; flex-shrink:0; }
.chart-badge{ font-size:11px; padding:2px 8px; border-radius:var(--r-pill); border:1px solid var(--line-soft); background:var(--surface-2); color:var(--text-dim); white-space:nowrap; }
.chart-badge--mine{ color:var(--gold); border-color:oklch(0.82 0.115 78 / .35); }
.chart-badge--couple{ color:var(--rose); border-color:var(--rose-line); background:var(--rose-tint); }
.chart-badge--plan{ color:var(--text-dim); }
.chart-item__add svg{ opacity:1; width:12px; height:12px; stroke:var(--text-faint); stroke-width:2.5; }
.chart-item:hover .chart-item__add{ border-color:var(--rose); }
.chart-item:hover .chart-item__add svg{ stroke:var(--rose); }
.chart-more{ flex:0 0 auto; padding:8px 12px; }
.chart-more:disabled{ opacity:.6; cursor:progress; }

/* 分季 + 搜索选中收起 */
.reselect-btn{ margin-left:auto; flex-shrink:0; font-size:var(--fs-sm); color:var(--rose); padding:4px 12px; border:1px solid var(--line); border-radius:var(--r-pill); background:var(--surface-2); transition:all .18s; }
.reselect-btn:hover{ color:oklch(0.16 0.02 30); background:var(--rose); border-color:var(--rose); }
.season-pick{ display:flex; flex-wrap:wrap; gap:6px; margin-top:var(--s-3); }
.season-all-opt,.season-opt{ flex:0 0 auto; padding:6px 12px; }
</style>
