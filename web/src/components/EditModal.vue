<script setup>
// 编辑/删除已添加的记录。type: mark(个人看过) | session(共看) | plan(想看就一起看)
// 评分用 ScorePicker；session 只编辑当前 viewer 那侧；后端 PUT/DELETE 已就绪。
import { ref, watch, computed } from 'vue';
import { useIdentity } from '../stores/identity.js';
import { useMarks } from '../stores/marks.js';
import { useSessions } from '../stores/sessions.js';
import { usePlan } from '../stores/plan.js';
import Poster from './Poster.vue';
import ScorePicker from './ScorePicker.vue';
import DatePicker from './DatePicker.vue';

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  type: { type: String, default: 'mark' },   // mark | session | plan
  record: { type: Object, default: null },
});
const emit = defineEmits(['update:modelValue', 'changed']);

const identity = useIdentity();
const marks = useMarks();
const sessions = useSessions();
const plan = usePlan();

const rating = ref(null);
const text = ref('');         // mark.comment / session.review(我那侧) / plan.note
const jointNote = ref('');    // session.joint_note
const watchedAt = ref(null);
const status = ref('');       // mark: watched|wish ; plan: pending|watching|done|dropped
const priority = ref(0);
const saving = ref(false);
const errorMsg = ref('');

const work = computed(() => props.record?.work || null);
const isViewerA = computed(() => identity.viewing === 1);
const titleLabel = computed(() => ({ mark: '编辑记录', session: '编辑共看记录', plan: '编辑计划' }[props.type]));

function todayInt() { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
function intToDateInput(n) { if (!n) return ''; return `${Math.floor(n/10000)}-${String(Math.floor(n/100)%100).padStart(2,'0')}-${String(n%100).padStart(2,'0')}`; }
function dateInputToInt(s) { if (!s) return null; const [y,m,d] = s.split('-').map(Number); return y*10000 + m*100 + d; }

function fillFrom(r) {
  if (!r) return;
  if (props.type === 'mark') {
    rating.value = r.rating ?? null;
    text.value = r.comment || '';
    status.value = r.status;
  } else if (props.type === 'session') {
    rating.value = (isViewerA.value ? r.rating_a : r.rating_b) ?? null;
    text.value = (isViewerA.value ? r.review_a : r.review_b) || '';
    jointNote.value = r.joint_note || '';
    watchedAt.value = r.watched_at ?? null;     // 空就保持空，别默认今天
  } else if (props.type === 'plan') {
    text.value = r.note || '';
    priority.value = r.priority || 0;
    status.value = r.status;
  }
  errorMsg.value = '';
}
watch(() => props.modelValue, (open) => { if (open) fillFrom(props.record); });
watch(() => props.record, (r) => { if (props.modelValue) fillFrom(r); });

const PLAN_STATUS = [['pending','待看'],['watching','在看'],['done','看完'],['dropped','弃了']];

async function save() {
  saving.value = true; errorMsg.value = '';
  try {
    if (props.type === 'mark') {
      await marks.update(props.record.id, { rating: rating.value, comment: text.value || null, status: status.value });
    } else if (props.type === 'session') {
      const patch = { joint_note: jointNote.value || null, watched_at: watchedAt.value };
      if (isViewerA.value) { patch.rating_a = rating.value; patch.review_a = text.value || null; }
      else { patch.rating_b = rating.value; patch.review_b = text.value || null; }
      await sessions.update(props.record.id, patch);
    } else if (props.type === 'plan') {
      await plan.update(props.record.id, { note: text.value || null, priority: priority.value, status: status.value });
    }
    emit('changed');
    close();
  } catch (e) { errorMsg.value = e.body?.error || e.message; }
  finally { saving.value = false; }
}

async function del() {
  if (!window.confirm('确定删除这条记录？')) return;
  saving.value = true; errorMsg.value = '';
  try {
    if (props.type === 'mark') await marks.remove(props.record.id);
    else if (props.type === 'session') await sessions.remove(props.record.id);
    else if (props.type === 'plan') await plan.remove(props.record.id);
    emit('changed');
    close();
  } catch (e) { errorMsg.value = e.body?.error || e.message; }
  finally { saving.value = false; }
}

function close() { emit('update:modelValue', false); }
</script>

<template>
  <div v-if="modelValue" class="modal-overlay is-open" @click.self="close">
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal__head">
        <h3 class="modal__title">{{ titleLabel }}</h3>
        <button class="modal__close" @click="close" aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="modal__body">
        <div v-if="work" style="display:flex;gap:var(--s-3);align-items:center;padding-bottom:var(--s-2)">
          <Poster :color="'#2a2a30'" :url="work.primary_poster_url" :kind="work.is_anime ? '番剧' : ''" style="width:46px" />
          <div style="font-family:var(--font-serif);font-weight:600;font-size:var(--fs-md)">
            {{ work.title }} <span class="year">{{ work.year }}</span>
          </div>
        </div>

        <!-- mark：个人看过，编辑评分 + 短评 -->
        <template v-if="type === 'mark'">
          <div class="field">
            <ScorePicker v-model="rating" label="我的评分" />
          </div>
          <div class="field">
            <span class="field__label">短评</span>
            <textarea class="review-input" v-model="text" placeholder="写一句感想…"></textarea>
          </div>
        </template>

        <!-- session -->
        <template v-else-if="type === 'session'">
          <div class="field">
            <span class="field__label">看完日期（可空，只记到年或月也行）</span>
            <DatePicker v-model="watchedAt" />
          </div>
          <div class="field">
            <ScorePicker v-model="rating" :label="`${identity.viewingName} 的评分`" />
          </div>
          <div class="field">
            <span class="field__label">{{ identity.viewingName }} 的短评</span>
            <textarea class="review-input" v-model="text" :placeholder="`${identity.viewingName} 的短评…`"></textarea>
          </div>
          <div class="field">
            <span class="field__label">联合备注</span>
            <textarea class="review-input" v-model="jointNote" placeholder="我们的感想…"></textarea>
          </div>
        </template>

        <!-- plan -->
        <template v-else-if="type === 'plan'">
          <div class="field">
            <span class="field__label">状态</span>
            <div class="target-list" style="grid-template-columns:repeat(4,1fr)">
              <button v-for="s in PLAN_STATUS" :key="s[0]" class="target" :class="{ 'is-active': status === s[0] }" @click="status = s[0]">{{ s[1] }}</button>
            </div>
          </div>
          <div class="field">
            <span class="field__label">优先级</span>
            <div class="target-list" style="grid-template-columns:repeat(4,1fr)">
              <button v-for="n in [0,1,2,3]" :key="n" class="target" :class="{ 'is-active': priority === n }" @click="priority = n">{{ n === 0 ? '无' : '★'.repeat(n) }}</button>
            </div>
          </div>
          <div class="field">
            <span class="field__label">备注</span>
            <textarea class="review-input" v-model="text" placeholder="为什么想一起看…"></textarea>
          </div>
        </template>

        <p v-if="errorMsg" style="color:var(--rose-bright);font-size:var(--fs-sm)">{{ errorMsg }}</p>
      </div>
      <div class="modal__foot">
        <button class="btn btn--primary" style="flex:1" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
        <button class="btn btn--ghost" :disabled="saving" style="color:var(--rose-bright);border-color:var(--rose-line)" @click="del">删除</button>
      </div>
    </div>
  </div>
</template>
