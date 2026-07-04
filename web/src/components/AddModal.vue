<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { api, tmdbPoster, imgProxy } from '../api/index';
import { useIdentity } from '../stores/identity';
import ScorePicker from './ScorePicker.vue';
import DatePicker from './DatePicker.vue';
import Priority from './Priority.vue';

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

// —— Step 2 选作品 ——
const selected = ref<any>(null);

// —— Step 3 选目标列表 ——
const target = ref(props.initialTarget);

// —— Step 4 详情 ——
const rating = ref<number | null>(null);
const comment = ref('');
const watchedAt = ref<number | null>(null);     // 默认空：有时忘了哪天看的
const planNote = ref('');
const planPriority = ref(0);

/* eslint-disable @typescript-eslint/no-unused-vars -- 死代码，Task 13 删除 */
function todayInt() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
function intToDateInput(n: any) {
  if (!n) return '';
  return `${Math.floor(n/10000)}-${String(Math.floor(n/100)%100).padStart(2,'0')}-${String(n%100).padStart(2,'0')}`;
}
function dateInputToInt(s: any) {
  if (!s) return null;
  const [y,m,d] = s.split('-').map(Number);
  return y*10000 + m*100 + d;
}
/* eslint-enable @typescript-eslint/no-unused-vars */

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
  rating.value = null;
  comment.value = '';
  watchedAt.value = null;
  planNote.value = '';
  planPriority.value = 0;
  saving.value = false;
  saveError.value = '';
  if (!prefillFromPlan()) {   // 普通模式才清空走搜索；from_plan 模式保留预填
    query.value = '';
    selected.value = null;
    target.value = props.initialTarget;
  }
}
watch(() => props.modelValue, (open) => { if (open) reset(); });
watch(() => props.initialTarget, (t) => { target.value = t; });

// —— 保存 ——
const saving = ref(false);
const saveError = ref('');

function close() { emit('update:modelValue', false); }

// 评分输入清空后会留 '' 或 NaN，归一成 null，避免后端 400 invalid_rating
function cleanRating(r: any) {
  return (r === '' || r == null || Number.isNaN(r)) ? null : r;
}

async function save() {
  if (!selected.value) return;
  saving.value = true;
  saveError.value = '';
  try {
    const workRef = selected.value._workId
      ? { work_id: selected.value._workId }
      : { tmdb_id: selected.value.tmdb_id, tmdb_type: selected.value.tmdb_type };
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
    emit('added', { target: target.value, result });
    close();
  } catch (e) {
    saveError.value = e.body?.error || e.message;
  } finally {
    saving.value = false;
  }
}

const targetLabel = computed(() => TARGETS.find(t => t.key === target.value)?.label || '');

function ifSelected(c: any) { return selected.value && selected.value.tmdb_id === c.tmdb_id && selected.value.tmdb_type === c.tmdb_type; }
</script>

<template>
  <div v-if="modelValue" class="modal-overlay is-open" @click.self="close">
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal__head">
        <h3 class="modal__title">添加到 · {{ targetLabel }}</h3>
        <button class="modal__close" @click="close" aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="modal__body">

        <!-- Step 1: 搜索 -->
        <div class="field" v-if="!fromPlan">
          <span class="field__label"><span class="step">1</span>搜索作品</span>
          <div class="search-box">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" v-model="query" placeholder="输入片名 / 番名…" />
          </div>
          <p v-if="searching" style="font-size:var(--fs-sm);color:var(--text-faint);margin-top:6px">搜索中…</p>
          <p v-if="searchError" style="font-size:var(--fs-sm);color:var(--rose-bright);margin-top:6px">{{ searchError === 'tmdb_not_configured' ? 'TMDB 未配置，请检查 .env' : searchError }}</p>
        </div>

        <!-- Step 2: 候选 -->
        <div class="field" v-if="!fromPlan && candidates.length">
          <span class="field__label"><span class="step">2</span>选择结果</span>
          <div class="results">
            <div v-for="c in candidates" :key="c.tmdb_type + ':' + c.tmdb_id"
                 class="result" :class="{ 'is-selected': ifSelected(c) }"
                 @click="selected = c">
              <div class="poster" :style="{ '--p1': '#2a2a30' }">
                <img v-if="c.poster_path" :src="imgProxy(tmdbPoster(c.poster_path, 'w92'))" alt="" referrerpolicy="no-referrer" />
              </div>
              <div class="result__info">
                <div class="result__name">{{ c.title }} <span class="year">{{ c.year }}</span><span v-if="c.original_title && c.original_title !== c.title" style="color:var(--text-faint);font-weight:400">  {{ c.original_title }}</span></div>
                <div class="result__sub">
                  {{ c.tmdb_type === 'movie' ? '电影' : '剧/番' }} · TMDB {{ c.vote_average?.toFixed(1) || '—' }}
                  <span v-if="c.via" style="color:var(--rose);font-weight:500"> · {{ c.via }}</span>
                </div>
              </div>
              <span class="result__check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 6 9 17l-5-5"/></svg></span>
            </div>
          </div>
        </div>

        <!-- 详情（目标列表由上下文决定，标题已显示「添加到 · X」，不再让用户四选） -->
        <div v-if="selected || fromPlan">
          <!-- 我看过 -->
          <div v-if="target === 'watched'" class="field">
            <span class="field__label"><span class="step">{{ fromPlan ? 1 : 3 }}</span>评分 & 短评（可选）</span>
            <ScorePicker v-model="rating" label="我的评分" />
            <textarea class="review-input" v-model="comment" placeholder="写一句感想…" style="margin-top:var(--s-3)"></textarea>
          </div>

          <!-- 一起看过 -->
          <div v-else-if="target === 'couple_watched'">
            <div class="field">
              <span class="field__label"><span class="step">{{ fromPlan ? 1 : 3 }}</span>看完日期（可空，只记到年或月也行）</span>
              <DatePicker v-model="watchedAt" />
            </div>
            <div class="field">
              <span class="field__label"><span class="step">{{ fromPlan ? 2 : 4 }}</span>{{ identity.viewingName }} 这侧（可选）</span>
              <ScorePicker v-model="rating" :label="`${identity.viewingName} 的评分`" />
              <textarea class="review-input" v-model="comment" :placeholder="`${identity.viewingName} 的短评…`" style="margin-top:var(--s-3)"></textarea>
            </div>
          </div>

          <!-- 想看就一起看（只需选优先级，备注/状态都不再维护）-->
          <div v-else-if="target === 'couple_plan'">
            <div class="field">
              <span class="field__label"><span class="step">3</span>优先级（可选）</span>
              <div class="rate-row">
                <button v-for="n in [0,1,2,3]" :key="n" class="target prio-opt" style="flex:0 0 auto;padding:6px 12px"
                        :class="{ 'is-active': planPriority === n }"
                        @click="planPriority = n"><span v-if="n === 0">无</span><Priority v-else :value="n" :total="n" /></button>
              </div>
            </div>
          </div>
        </div>

        <p v-if="saveError" style="color:var(--rose-bright);font-size:var(--fs-sm)">
          {{ {mark_exists:'已经在你的列表里', plan_exists:'已经在共同计划里'}[saveError] || saveError }}
        </p>
      </div>
      <div class="modal__foot">
        <button class="btn btn--primary" style="flex:1" :disabled="(!selected && !fromPlan) || saving" @click="save">
          {{ saving ? '保存中…' : `保存到「${targetLabel}」` }}
        </button>
        <button class="btn" @click="close">取消</button>
      </div>
    </div>
  </div>
</template>
