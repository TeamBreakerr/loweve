<script setup lang="ts">
// 编辑/删除已添加的记录。type: mark(个人看过) | session(共看) | plan(想看就一起看)
// 评分用 ScorePicker；session 只编辑当前 viewer 那侧；后端 PUT/DELETE 已就绪。
import { ref, watch, computed } from 'vue';
import { useIdentity } from '../stores/identity';
import { useMarks } from '../stores/marks';
import { useSessions } from '../stores/sessions';
import { usePlan } from '../stores/plan';
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

const rating = ref<number | null>(null);
const text = ref('');         // mark.comment / session.review(我那侧) / plan.note
const watchedAt = ref<number | null>(null);
const status = ref('');       // mark: watched|wish ; plan: pending|watching|done|dropped
const priority = ref(0);
const saving = ref(false);
const errorMsg = ref('');

const work = computed(() => props.record?.work || null);
const isViewerA = computed(() => identity.viewing === 1);
const titleLabel = computed(() => ({ mark: '编辑记录', session: '编辑共看记录', plan: '编辑计划' }[props.type]));

function fillFrom(r: any) {
  if (!r) return;
  if (props.type === 'mark') {
    rating.value = r.rating ?? null;
    text.value = r.comment || '';
    status.value = r.status;
  } else if (props.type === 'session') {
    rating.value = (isViewerA.value ? r.rating_a : r.rating_b) ?? null;
    text.value = (isViewerA.value ? r.review_a : r.review_b) || '';
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
      const patch: any = { watched_at: watchedAt.value };   // 联合备注已下线：不下发，后端按"为空则保留"逻辑不会抹除旧值
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
        <div v-if="work" class="work-summary">
          <Poster :color="'#2a2a30'" :url="work.primary_poster_url" :kind="work.is_anime ? '番剧' : ''" class="work-summary__poster" />
          <div class="work-summary__title">
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
        </template>

        <!-- plan -->
        <template v-else-if="type === 'plan'">
          <div class="field">
            <span class="field__label">状态</span>
            <div class="target-list target-list--4col">
              <button v-for="s in PLAN_STATUS" :key="s[0]" class="target" :class="{ 'is-active': status === s[0] }" @click="status = s[0]">{{ s[1] }}</button>
            </div>
          </div>
          <div class="field">
            <span class="field__label">优先级</span>
            <div class="target-list target-list--4col">
              <button v-for="n in [0,1,2,3]" :key="n" class="target" :class="{ 'is-active': priority === n }" @click="priority = n">{{ n === 0 ? '无' : '★'.repeat(n) }}</button>
            </div>
          </div>
          <div class="field">
            <span class="field__label">备注</span>
            <textarea class="review-input" v-model="text" placeholder="为什么想一起看…"></textarea>
          </div>
        </template>

        <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>
      </div>
      <div class="modal__foot">
        <button class="btn btn--primary submit-btn" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
        <button class="btn btn--ghost delete-btn" :disabled="saving" @click="del">删除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* .target-list 样式，从 styles/loweve.css「Modal」段搬入（T10 批 4，响应式段清点顺手
   归位：批 1-3 未覆盖 EditModal.vue 这块样式，本次借响应式清点补上，纯剪切未改声明，报
   DONE_WITH_CONCERNS）。*/
.target-list{ display:grid; grid-template-columns:1fr 1fr; gap:var(--s-2); }
@media (max-width:680px){
  .target-list{ grid-template-columns:1fr; }
}

/* ============================================================ 内联样式收编（T12）
   以下均由原静态内联 style 属性收编而成，声明逐字节保持原值，零像素改动。
   .work-summary 是本文件新起的 block（未在别处出现）；.work-summary__poster 落到
   <Poster> 子组件根节点（同 Home.vue .hcard__poster 手法），子组件自身与
   primitives.css 均未给 .poster 设 width，无声明冲突。.target-list--4col 覆盖两处原本
   相同的内联 grid-template-columns:repeat(4,1fr)（状态/优先级两个按钮组同值合并）；
   .target-list 与 @media 内的覆写都在本文件同一 scoped 块里，特异性同为 (0,2,0)（类+
   scoped 属性选择器）打平，故把本规则放在 @media 块之后，让它在任何视口下都稳赢——
   与原内联「无视断点、恒定 4 列」的效果一致。.error-msg/.submit-btn 与 AddModal.vue
   同值的 .save-error/.submit-btn 纯属巧合重复，两文件各自 scoped 隔离，不构成跨文件
   共享基类，未合并。.delete-btn 覆盖的 .btn{color:var(--text-dim)}/.btn--ghost{
   border-color:var(--line)} 均来自 primitives.css（未 scoped，(0,1,0)），本类经 Vue
   scoped 编译后为 (0,2,0)，稳赢；.btn:hover 同样 (0,2,0) 打平，但 primitives.css 在
   main.ts 里先于组件 scoped 样式导入，源码序上本类靠后，hover 态下依然是本类生效，与
   原内联「恒定颜色、不受 hover 影响」的效果一致。*/
.work-summary{ display:flex; gap:var(--s-3); align-items:center; padding-bottom:var(--s-2); }
.work-summary__poster{ width:46px; }
.work-summary__title{ font-family:var(--font-serif); font-weight:600; font-size:var(--fs-md); }
.target-list--4col{ grid-template-columns:repeat(4,1fr); }
.error-msg{ color:var(--rose-bright); font-size:var(--fs-sm); }
.submit-btn{ flex:1; }
.delete-btn{ color:var(--rose-bright); border-color:var(--rose-line); }
</style>
