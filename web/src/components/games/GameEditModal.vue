<script setup lang="ts">
// 编辑游戏记录（个人记录 / 共同游玩 / 共同计划）。改动自动保存（useAutosave），没有「保存」按钮；
// 关窗前把没存的存掉，有存过才通知父页面刷新。
import { computed, ref, watch } from 'vue';
import { useGameMarks } from '../../stores/gameMarks';
import { useGameSessions } from '../../stores/gameSessions';
import { useGamePlan } from '../../stores/gamePlan';
import { confirm } from '../../composables/useConfirm';
import { keepaliveJson, useAutosave } from '../../composables/useAutosave';
import { withViewing } from '../../api/index';
import GamePoster from './GamePoster.vue';
import GameContentBadge from './GameContentBadge.vue';
import ScorePicker from '../ScorePicker.vue';
import DatePicker from '../DatePicker.vue';
import { vAutoGrow } from '../../directives/autoGrow';

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  type: { type: String, default: 'mark' },
  record: { type: Object, default: null },
});
const emit = defineEmits(['update:modelValue', 'changed']);
const marks = useGameMarks();
const sessions = useGameSessions();
const plan = useGamePlan();
const rating = ref<number | null>(null);
const text = ref('');
const playedAt = ref<number | null>(null);
const completedAt = ref<number | null>(null);
const priority = ref(0);
const deleting = ref(false);
const error = ref('');
const work = computed(() => props.record?.work || null);
const title = computed(() => ({ mark: '编辑游戏记录', session: '编辑共同游玩记录', plan: '编辑共同计划' }[props.type]));

function fill() {
  const row = props.record;
  if (!row) return;
  error.value = '';
  if (props.type === 'mark') { rating.value = row.rating ?? null; text.value = row.comment || ''; }
  if (props.type === 'session') {
    playedAt.value = row.played_at ?? null;
    completedAt.value = row.completed_at ?? null;
  }
  if (props.type === 'plan') {
    priority.value = row.priority || 0;
    text.value = row.note || '';
  }
  autosave.reset();
}
watch(() => props.modelValue, open => { if (open) fill(); });
watch(() => props.record, () => { if (props.modelValue) fill(); });

const ENDPOINT: Record<string, string> = { mark: 'marks', session: 'sessions', plan: 'plan' };
const autosave = useAutosave<Record<string, unknown>>({
  snapshot: () => props.type === 'mark' ? { rating: rating.value, comment: text.value || null }
    : props.type === 'session' ? { played_at: playedAt.value, completed_at: completedAt.value }
      : { priority: priority.value, note: text.value || null },
  save: patch => props.type === 'mark' ? marks.update(props.record.id, patch)
    : props.type === 'session' ? sessions.update(props.record.id, patch)
      : plan.update(props.record.id, patch),
  beacon: patch => keepaliveJson(withViewing(`/api/games/${ENDPOINT[props.type]}/${props.record.id}`), 'PUT', patch),
});
const { state: saveState, label: saveLabel } = autosave;
watch([rating, text, playedAt, completedAt, priority], () => { if (props.modelValue && props.record) autosave.touch(); });

async function remove() {
  if (!await confirm({ title: '移入游戏回收站？', message: '之后可在「设置 → 游戏回收站」恢复。', confirmLabel: '移入回收站' })) return;
  autosave.cancel();   // 记录要删了，没存的改动不必再存
  deleting.value = true;
  try {
    if (props.type === 'mark') await marks.remove(props.record.id);
    if (props.type === 'session') await sessions.remove(props.record.id);
    if (props.type === 'plan') await plan.remove(props.record.id);
    emit('changed'); emit('update:modelValue', false);
  } catch (e) { error.value = e.body?.error || e.message; }
  finally { deleting.value = false; }
}
// 关窗（✕ / 点遮罩 / 完成）：先把没存的存掉，存不上再问；这次存过才让父页面刷新
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  try {
    if (!await autosave.settle() && !await confirm({
      title: '没保存上', message: `${autosave.error.value}。关掉的话这次的修改会丢失。`, confirmLabel: '仍然关闭', danger: true,
    })) return;
    if (autosave.saveCount.value) emit('changed');
    emit('update:modelValue', false);
  } finally {
    closing = false;
  }
}
</script>

<template>
  <div v-if="modelValue" class="modal-overlay is-open" @pointerdown.self="close">
    <div class="modal game-edit" role="dialog" aria-modal="true">
      <div class="modal__head"><div><span class="game-edit__eyebrow">GAME RECORD</span><h3 class="modal__title">{{ title }}</h3></div><button class="modal__close" @click="close"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
      <div class="modal__body">
        <div v-if="work" class="game-summary"><GamePoster :url="work.cover_url" :fallback="work.header_url" :state="work.release_state" /><div><strong>{{ work.title }}</strong><GameContentBadge :work="work"/><small>{{ work.release_year || '' }}</small></div></div>
        <template v-if="type === 'mark'">
          <div class="field"><ScorePicker v-model="rating" label="我的评分" /></div>
          <div class="field"><span class="field__label">短评</span><textarea v-auto-grow v-model="text" class="review-input" placeholder="写一句游玩感想…"></textarea></div>
        </template>
        <template v-else-if="type === 'session'">
          <div class="field"><span class="field__label">首次共同游玩日（可空）</span><DatePicker v-model="playedAt" /></div>
          <div class="field"><span class="field__label">通关日（可空）</span><DatePicker v-model="completedAt" /><span class="game-edit__hint">{{ completedAt == null ? '未填写：显示在“正在玩”' : '已填写：显示在“一起玩过”' }}</span></div>
        </template>
        <template v-else>
          <div class="field"><span class="field__label">优先级</span><div class="edit-grid"><button v-for="n in [0,1,2,3]" :key="n" class="target" :class="{ 'is-active': priority === n }" @click="priority = n">{{ n ? '★'.repeat(n) : '无' }}</button></div></div>
          <div class="field"><span class="field__label">备注</span><textarea v-auto-grow v-model="text" class="review-input" placeholder="为什么想和 TA 一起玩…"></textarea></div>
        </template>
        <p v-if="error" class="game-edit__error">{{ error }}</p>
      </div>
      <div class="modal__foot"><span class="autosave-state" :class="`is-${saveState}`">{{ saveLabel }}</span><button v-if="saveState === 'error'" class="autosave-retry" @click="autosave.flush()">重试</button><button class="btn btn--ghost game-edit__delete" :disabled="deleting" @click="remove">移入回收站</button><button class="btn btn--primary" @click="close">完成</button></div>
    </div>
  </div>
</template>

<style scoped>
.game-edit{ border-color:var(--game-line); }
.game-edit__eyebrow{ color:var(--game-accent); font-size:10px; font-weight:800; letter-spacing:.14em; }
.game-summary{ display:flex; align-items:center; gap:var(--s-3); padding-bottom:var(--s-2); }
.game-summary :deep(.game-poster){ width:52px; flex:0 0 auto; }
.game-summary>div{ display:flex; flex-direction:column; }.game-summary small{ color:var(--text-faint); }
.game-edit__hint{ color:var(--game-accent); font-size:var(--fs-sm); }
.edit-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:var(--s-2); }
.game-edit__delete,.game-edit__error{ color:var(--rose-bright); }.game-edit__delete{ border-color:var(--rose-line); }
</style>
