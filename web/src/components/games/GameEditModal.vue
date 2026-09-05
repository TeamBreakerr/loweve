<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGameMarks } from '../../stores/gameMarks';
import { useGameSessions } from '../../stores/gameSessions';
import { useGamePlan } from '../../stores/gamePlan';
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
const saving = ref(false);
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
}
watch(() => props.modelValue, open => { if (open) fill(); });
watch(() => props.record, () => { if (props.modelValue) fill(); });

async function save() {
  saving.value = true; error.value = '';
  try {
    if (props.type === 'mark') await marks.update(props.record.id, { rating: rating.value, comment: text.value || null });
    if (props.type === 'session') {
      await sessions.update(props.record.id, { played_at: playedAt.value, completed_at: completedAt.value });
    }
    if (props.type === 'plan') {
      await plan.update(props.record.id, { priority: priority.value, note: text.value || null });
    }
    emit('changed'); close();
  } catch (e) { error.value = e.body?.error || e.message; }
  finally { saving.value = false; }
}
async function remove() {
  if (!window.confirm('确定移入游戏回收站？之后可以恢复。')) return;
  saving.value = true;
  try {
    if (props.type === 'mark') await marks.remove(props.record.id);
    if (props.type === 'session') await sessions.remove(props.record.id);
    if (props.type === 'plan') await plan.remove(props.record.id);
    emit('changed'); close();
  } catch (e) { error.value = e.body?.error || e.message; }
  finally { saving.value = false; }
}
function close() { emit('update:modelValue', false); }
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
      <div class="modal__foot"><button class="btn btn--primary game-edit__save" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button><button class="btn btn--ghost game-edit__delete" :disabled="saving" @click="remove">移入回收站</button></div>
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
.game-edit__save{ flex:1; }.game-edit__delete,.game-edit__error{ color:var(--rose-bright); }.game-edit__delete{ border-color:var(--rose-line); }
</style>
