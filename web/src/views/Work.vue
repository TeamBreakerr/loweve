<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ratingHref } from '../api/index';
import { useIdentity } from '../stores/identity';
import type { Work } from '../types';
import Poster from '../components/Poster.vue';
import Rating from '../components/Rating.vue';
import EditModal from '../components/EditModal.vue';
import AddModal from '../components/AddModal.vue';
import Priority from '../components/Priority.vue';

const route = useRoute();
const router = useRouter();
const identity = useIdentity();

const work = ref<Work | null>(null);
const loading = ref(false);
const error = ref('');

// 编辑已添加的记录（个人标记 / 共看记录）
const editOpen = ref(false);
const editType = ref('mark');
const editRecord = ref<any>(null);
function openEdit(type: any, record: any) {
  editType.value = type;
  editRecord.value = { ...record, work: work.value };
  editOpen.value = true;
}

async function loadWork() {
  loading.value = true;
  error.value = '';
  try {
    work.value = await api(`/api/works/${route.params.id}`);
  } catch (e) {
    error.value = e.body?.error || e.message;
    work.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(loadWork);
watch(() => route.params.id, loadWork);

// —— 想看清单管理（在详情页直接调优先级 / 移除 / 标记一起看过）——
const planActive = computed(() =>
  work.value?.plan && work.value.plan.status !== 'done' && work.value.plan.status !== 'dropped' ? work.value.plan : null);
const finishOpen = ref(false);
const fromPlanObj = computed<any>(() => planActive.value ? { id: planActive.value.id, work: work.value } : null);
async function setPriority(n: number) {
  if (!planActive.value) return;
  await api(`/api/plan/${planActive.value.id}`, { method: 'PUT', body: JSON.stringify({ priority: n }) });
  await loadWork();
}
async function removePlan() {
  if (!planActive.value) return;
  await api(`/api/plan/${planActive.value.id}`, { method: 'DELETE' });
  await loadWork();
}

const tags = computed(() => {
  if (!work.value) return [];
  try { return JSON.parse(work.value.genres || '[]'); } catch { return []; }
});
const subtitle = computed(() => {
  if (!work.value) return '';
  const parts = [work.value.original_title, work.value.year, work.value.runtime ? `${work.value.runtime} 分钟` : null].filter(Boolean);
  return parts.join(' · ');
});

function statusLabel(s: any) { return s === 'watched' ? '看过' : s === 'wish' ? '想看' : s; }

// 返回到来源页（从哪点进来回哪去）；无历史则回首页
function goBack() {
  if (window.history.length > 1) router.back();
  else router.push('/');
}
</script>

<template>
  <main class="page">
    <a class="back-link back-link--btn" @click="goBack">
      <svg viewBox="0 0 24 24"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>返回
    </a>

    <p v-if="loading" class="state-note state-note--faint">加载中…</p>
    <p v-else-if="error" class="state-note state-note--error">{{ error === 'not_found' ? '作品不存在' : error }}</p>

    <template v-else-if="work">
      <div class="work-top">
        <Poster :color="'#2a2a30'" :url="work.primary_poster_url" :kind="work.is_anime ? '番剧' : ''" />
        <div class="work-meta">
          <h1 class="work-meta__title">{{ work.title }}</h1>
          <p class="work-meta__sub">{{ subtitle }}</p>
          <div class="work-meta__tags">
            <span v-for="t in tags" :key="t" class="tag">{{ t }}</span>
            <Rating :source="work.rating_source" :score="work.primary_rating?.toFixed(1) || '—'" :href="ratingHref(work)" />
          </div>
        </div>
      </div>

      <!-- 在想看清单里：直接调优先级 / 标记一起看过 / 移除 -->
      <section v-if="planActive" class="section">
        <div class="section__head"><h2 class="section__title">在想看清单里</h2></div>
        <div class="plan-active-bar">
          <span class="plan-active-bar__label">优先级</span>
          <div class="rate-row rate-row--tight">
            <button v-for="n in [0,1,2,3]" :key="n" class="target prio-opt work-prio-opt"
                    :class="{ 'is-active': planActive.priority === n }" @click="setPriority(n)"><span v-if="n === 0">无</span><Priority v-else :value="n" :total="n" /></button>
          </div>
          <div class="plan-active-bar__actions">
            <button class="btn btn--rose" @click="finishOpen = true">标记为一起看过</button>
            <button class="btn btn--ghost" @click="removePlan">从清单移除</button>
          </div>
        </div>
      </section>

      <section v-if="work.all_marks.length" class="section">
        <div class="section__head"><h2 class="section__title">各自的记录</h2></div>
        <div class="record-grid">
          <article v-for="m in work.all_marks" :key="m.id" class="record" :data-who="identity.whoKey(m.user_id)">
            <button class="card-edit" data-tip="编辑" data-tip-pos="below" @click="openEdit('mark', m)">
              <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <div class="record__head">
              <span class="record__avatar">{{ identity.userById(m.user_id)?.display_name?.[0] || '' }}</span>
              <div>
                <div class="record__who">{{ identity.userById(m.user_id)?.display_name }}</div>
                <div class="record__role">{{ statusLabel(m.status) }}</div>
              </div>
              <span v-if="m.rating" class="record__score">{{ m.rating }}</span>
            </div>
            <p v-if="m.comment" class="record__review">{{ m.comment }}</p>
          </article>
        </div>
      </section>

      <section v-if="work.sessions.length" class="section">
        <div class="section__head"><h2 class="section__title">共看记录</h2></div>
        <div v-for="s in work.sessions" :key="s.id" class="joint">
          <button class="card-edit" data-tip="编辑" data-tip-pos="below" @click="openEdit('session', s)">
            <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <div class="joint__label">
            <svg viewBox="0 0 24 24"><path d="M12 21s-8-4.5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.5-8 11-8 11Z"/></svg>
            一起看 · 各自短评
          </div>
          <p v-if="s.review_a" class="joint__review"><strong class="joint__who--a">{{ identity.userById(1)?.display_name }}:</strong> {{ s.review_a }}<span v-if="s.rating_a"> ({{ s.rating_a }})</span></p>
          <p v-if="s.review_b" class="joint__review"><strong class="joint__who--b">{{ identity.userById(2)?.display_name }}:</strong> {{ s.review_b }}<span v-if="s.rating_b"> ({{ s.rating_b }})</span></p>
        </div>
      </section>

      <p v-if="!work.all_marks.length && !work.sessions.length" class="state-note state-note--faint">
        还没有任何记录。
      </p>
    </template>

    <EditModal v-model="editOpen" :type="editType" :record="editRecord" @changed="loadWork" />
    <AddModal v-model="finishOpen" :from-plan="fromPlanObj" @added="loadWork" />
  </main>
</template>

<style scoped>
/* 从 styles/loweve.css「二级页面专用样式」段搬入（T10 批 3，纯剪切，未改声明）。
   .record 原判 primitives，经 css-usage-report.txt 人工复核改判为 scoped: Work.vue，
   一并按改判结果搬迁。.work-top .poster 留在 loweve.css（跨组件选择器，.poster 属于子组件
   components/Poster.vue，见该文件注释）；.record__who/.record__role 也留在 loweve.css
   （与 Settings.vue 语义无关复用，见该文件注释，暂不搬迁）。*/
.work-top{ display:grid; grid-template-columns:220px 1fr; gap:var(--s-8); margin-bottom:var(--s-10); }
.work-meta__title{ font-family:var(--font-serif); font-weight:700; font-size:var(--fs-2xl); line-height:1.1; }
.work-meta__sub{ color:var(--text-dim); margin:var(--s-2) 0 var(--s-4); }
.work-meta__tags{ display:flex; gap:6px; flex-wrap:wrap; margin-bottom:var(--s-5); }
.record-grid{ display:grid; grid-template-columns:1fr 1fr; gap:var(--s-4); margin-bottom:var(--s-4); }
.record{ background:var(--surface); border:1px solid var(--line-soft); border-radius:var(--r-lg); padding:var(--s-5); position:relative; }
.record__head{ display:flex; align-items:center; gap:var(--s-3); margin-bottom:var(--s-4); }
.record__avatar{ width:34px; height:34px; border-radius:50%; display:grid; place-items:center; font-family:var(--font-brand); font-style:italic; font-weight:700; color:var(--bg); }
.record[data-who="a"] .record__avatar{ background:var(--user-a); }
.record[data-who="b"] .record__avatar{ background:var(--user-b); }
.record__score{ margin-left:auto; margin-right:26px; font-family:var(--font-brand); font-style:italic; font-weight:600; font-size:var(--fs-2xl); color:var(--gold); line-height:1; }   /* 留出右上角编辑按钮的位置，避免重合 */
.record__review{ color:var(--text-dim); line-height:1.7; font-size:var(--fs-body); }
.joint{ background:var(--surface); border:1px solid var(--line); border-radius:var(--r-lg); padding:var(--s-5) var(--s-6); margin-bottom:var(--s-4); position:relative; }
.joint__label{ display:flex; align-items:center; gap:7px; font-size:var(--fs-sm); color:var(--rose-bright); letter-spacing:.04em; margin-bottom:var(--s-3); }
.joint__label svg{ width:16px; height:16px; stroke:currentColor; fill:none; stroke-width:1.7; }

@media (max-width:680px){
  .work-top{ grid-template-columns:120px 1fr; gap:var(--s-5); }
  .work-meta__title{ font-size:var(--fs-xl); }
  .record-grid{ grid-template-columns:1fr; }
}

/* ============================================================ 内联样式收编（T12）
   以下均由原静态内联 style 属性收编而成，声明逐字节保持原值，零像素改动。
   .record/.joint 是本文件本地类（未在别处使用，Settings.vue 仅共用 __who/__role 子类，
   见上方 T10 注释），原内联 position:relative（.record）与 margin-bottom:var(--s-4);
   position:relative（.joint）直接并入既有本地规则，无需新起修饰类。.joint__review 合并
   两处同值的原内联 margin-top:var(--s-3);color:var(--text-dim)；其内嵌 <strong> 的
   color:var(--user-a)/var(--user-b) 两处取值不同，各自起 .joint__who--a/--b。
   .state-note 合并三处 text-align:center;padding:var(--s-8) 完全同值的内联（加载中 /
   共看记录页整体错误 / 无任何记录），差异仅在文字颜色，拆成 .state-note--faint（两处，
   text-faint）与 .state-note--error（一处，rose-bright）。
   .back-link/.rate-row/.target+.prio-opt 是跨文件共用类（.back-link 见 loweve.css，
   4 文件共用；.rate-row/.target/.prio-opt 见 primitives.css，AddModal/Home 等共用），
   按规则不并入基类，改用本文件专属修饰类：.back-link--btn（补 cursor:pointer——本处是
   无 href 的裸 <a>，基类未设 cursor）、.rate-row--tight（gap 从基类 var(--s-5) 覆盖为
   var(--s-2)）、.work-prio-opt（覆盖 .target 的 padding:var(--s-3) 为 6px 12px，并新增
   flex:0 0 auto；与 AddModal.vue 的 .plan-prio-opt 取值巧合相同，两文件各自 scoped
   隔离，按规则不合并）。三者经 Vue scoped 编译后均为 (0,2,0)，稳赢 primitives/loweve.css
   的 (0,1,0)，与视口/加载顺序无关。
   .plan-active-bar(__label/__actions) 是本文件新起的 block（未在别处出现）。*/
.back-link--btn{ cursor:pointer; }
.state-note{ text-align:center; padding:var(--s-8); }
.state-note--faint{ color:var(--text-faint); }
.state-note--error{ color:var(--rose-bright); }
.plan-active-bar{ display:flex; flex-wrap:wrap; align-items:center; gap:var(--s-4); background:var(--surface); border-radius:var(--r-lg); padding:var(--s-4) var(--s-5); }
.plan-active-bar__label{ font-size:var(--fs-sm); color:var(--text-dim); }
.plan-active-bar__actions{ display:flex; gap:var(--s-2); margin-left:auto; }
.rate-row--tight{ gap:var(--s-2); }
.work-prio-opt{ flex:0 0 auto; padding:6px 12px; }
.joint__review{ margin-top:var(--s-3); color:var(--text-dim); }
.joint__who--a{ color:var(--user-a); }
.joint__who--b{ color:var(--user-b); }
</style>
