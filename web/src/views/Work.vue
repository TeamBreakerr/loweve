<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, imgProxy, ratingHref } from '../api/index';
import { useIdentity } from '../stores/identity';
import type { Work, WorkDetails } from '../types';
import Poster from '../components/Poster.vue';
import Rating from '../components/Rating.vue';
import EditModal from '../components/EditModal.vue';
import AddModal from '../components/AddModal.vue';
import Priority from '../components/Priority.vue';
import HotReviews from '../components/HotReviews.vue';

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
    backdropBroken.value = false;
    work.value = await api(`/api/works/${route.params.id}`);
  } catch (e) {
    error.value = e.body?.error || e.message;
    work.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(loadWork);
watch([() => route.params.id, () => identity.viewing], loadWork);

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
  if (!window.confirm('确定从清单移入回收站？之后可在「设置 → 回收站」恢复。')) return;
  await api(`/api/plan/${planActive.value.id}`, { method: 'DELETE' });
  await loadWork();
}

const tags = computed(() => {
  if (!work.value) return [];
  try { return JSON.parse(work.value.genres || '[]'); } catch { return []; }
});
const details = computed<WorkDetails>(() => work.value?.details || {});
const backdropBroken = ref(false);
const backdropUrl = computed(() => (!backdropBroken.value && details.value.backdrop_url) || work.value?.primary_poster_url || '');
function onBackdropError() { backdropBroken.value = true; }
function formatDate(value?: string | null) {
  if (!value) return '';
  const parts = value.split('-');
  if (parts.length < 2) return value;
  return `${parts[0]}年${Number(parts[1])}月${parts[2] ? `${Number(parts[2])}日` : ''}`;
}

function formatCount(value?: number | null) {
  if (!value) return '';
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function languageLabel(value?: string | null) {
  const labels: Record<string, string> = { zh: '中文', ja: '日语', en: '英语', ko: '韩语', fr: '法语', es: '西班牙语' };
  return value ? labels[value] || value.toUpperCase() : '';
}

function sourceLabel(source?: string) {
  return source === 'douban' ? '豆瓣' : source === 'bangumi' ? 'Bangumi' : 'TMDB';
}

const castNames = computed(() => details.value.cast?.map(person => person.name).join('、') || '');

const secondaryRating = computed<{ source: string; score: number; count: number | null } | null>(() => {
  if (!work.value || !details.value) return null;
  if (work.value.rating_source !== 'tmdb' && details.value.tmdb_rating) {
    return { source: 'tmdb', score: details.value.tmdb_rating, count: details.value.tmdb_rating_count || null };
  }
  if (work.value.rating_source !== 'douban' && details.value.douban_rating) {
    return { source: 'douban', score: details.value.douban_rating, count: details.value.douban_rating_count || null };
  }
  if (work.value.rating_source !== 'bangumi' && details.value.bangumi_rating) {
    return { source: 'bangumi', score: details.value.bangumi_rating, count: details.value.bangumi_rating_count || null };
  }
  return null;
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
      <article class="work-hero" :class="{ 'work-hero--poster-bg': !details.backdrop_url || backdropBroken }">
        <img v-if="backdropUrl" class="work-hero__backdrop" :src="imgProxy(backdropUrl)" alt="" aria-hidden="true" @error="onBackdropError" />
        <div class="work-hero__veil" aria-hidden="true"></div>
        <div class="work-hero__inner">
          <div class="work-hero__poster">
            <Poster :color="'#2a2a30'" :url="work.primary_poster_url" :kind="work.is_anime ? '番剧' : ''" />
          </div>
          <div class="work-hero__body">
            <div class="work-hero__eyebrow">
              <span>{{ work.tmdb_type === 'movie' ? '电影' : '剧集' }}</span>
              <span v-if="work.year">{{ work.year }}</span>
              <span v-if="work.runtime">{{ work.runtime }} 分钟</span>
            </div>
            <h1 class="work-hero__title">{{ work.title }}</h1>
            <p v-if="work.original_title && work.original_title !== work.title" class="work-hero__original">{{ work.original_title }}</p>
            <div class="work-hero__tags">
              <span v-for="t in tags" :key="t" class="tag work-hero__tag">{{ t }}</span>
              <Rating :source="work.rating_source" :score="work.primary_rating?.toFixed(1) || '—'" :href="ratingHref(work)" />
            </div>
            <p v-if="details.tagline" class="work-hero__tagline">“{{ details.tagline }}”</p>
            <p class="work-hero__overview">{{ work.overview || '这部作品暂时还没有简介。' }}</p>
            <div class="work-hero__links">
              <a v-if="work.douban_url" class="work-source-link work-source-link--douban" :href="work.douban_url" target="_blank" rel="noreferrer">豆瓣条目 <span>↗</span></a>
              <a v-if="work.bangumi_id" class="work-source-link work-source-link--bangumi" :href="`https://bgm.tv/subject/${work.bangumi_id}`" target="_blank" rel="noreferrer">Bangumi <span>↗</span></a>
              <a v-if="details.tmdb_url" class="work-source-link" :href="details.tmdb_url" target="_blank" rel="noreferrer">TMDB <span>↗</span></a>
              <a v-if="details.trailer_url" class="work-source-link" :href="details.trailer_url" target="_blank" rel="noreferrer">预告片 <span>▶</span></a>
            </div>
          </div>
        </div>
      </article>

      <section class="section work-info">
        <div class="section__head">
          <h2 class="section__title">影片资料</h2>
          <span class="section__hint">资料来自 TMDB · 评分来自 {{ sourceLabel(work.rating_source) }}</span>
        </div>
        <div class="work-info__grid">
          <article class="work-rating-card">
            <p class="work-info__label">观众评分</p>
            <div class="work-rating-card__main">
              <span class="work-rating-card__score">{{ work.primary_rating?.toFixed(1) || '—' }}</span>
              <span class="work-rating-card__ten">/ 10</span>
            </div>
            <p class="work-rating-card__source">
              {{ sourceLabel(work.rating_source) }}
              <span v-if="work.primary_rating_count">· {{ formatCount(work.primary_rating_count) }} 人评价</span>
            </p>
            <div v-if="secondaryRating" class="work-rating-card__secondary">
              <span>{{ sourceLabel(secondaryRating.source) }}</span>
              <strong>{{ secondaryRating.score.toFixed(1) }}</strong>
              <span v-if="secondaryRating.count">{{ formatCount(secondaryRating.count) }} 人</span>
            </div>
          </article>

          <article class="work-facts-card">
            <p class="work-info__label">基本信息</p>
            <dl class="work-facts">
              <div v-if="details.release_date"><dt>上映</dt><dd>{{ formatDate(details.release_date) }}</dd></div>
              <div v-if="work.runtime"><dt>片长</dt><dd>{{ work.runtime }} 分钟</dd></div>
              <div v-if="details.countries?.length"><dt>地区</dt><dd>{{ details.countries.join(' / ') }}</dd></div>
              <div v-if="details.original_language"><dt>原声</dt><dd>{{ languageLabel(details.original_language) }}</dd></div>
              <div v-if="details.status"><dt>状态</dt><dd>{{ details.status === 'Released' ? '已上映' : details.status }}</dd></div>
              <div v-if="details.imdb_id"><dt>IMDb</dt><dd><a :href="`https://www.imdb.com/title/${details.imdb_id}/`" target="_blank" rel="noreferrer">{{ details.imdb_id }} ↗</a></dd></div>
            </dl>
          </article>

          <article v-if="details.directors?.length || details.cast?.length || details.production_companies?.length" class="work-credits-card">
            <p class="work-info__label">主创与制作</p>
            <div v-if="details.directors?.length" class="work-credit-row">
              <span>导演</span><p>{{ details.directors.join('、') }}</p>
            </div>
            <div v-if="details.cast?.length" class="work-credit-row">
              <span>主演</span><p>{{ castNames }}</p>
            </div>
            <div v-if="details.production_companies?.length" class="work-credit-row">
              <span>制作</span><p>{{ details.production_companies.join('、') }}</p>
            </div>
          </article>
        </div>
      </section>

      <HotReviews :endpoint="`/api/works/${work.id}/hot-reviews`" />

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
            <button v-if="m.user_id === identity.viewing" class="card-edit" data-tip="编辑" data-tip-pos="below" @click="openEdit('mark', m)">
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

      <p v-if="!work.all_marks.length" class="state-note state-note--faint">
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
.work-hero{ position:relative; isolation:isolate; overflow:hidden; min-height:500px; margin-bottom:var(--s-10); border:1px solid var(--line); border-radius:var(--r-xl); background:var(--surface); box-shadow:var(--shadow-pop); }
.work-hero__backdrop{ position:absolute; inset:0; z-index:0; width:100%; height:100%; max-width:none; object-fit:cover; object-position:center; filter:saturate(.82); transform:scale(1.03); }
.work-hero__veil{ position:absolute; inset:0; z-index:1; background:
  linear-gradient(90deg, oklch(0.12 0.012 40 / .98) 0%, oklch(0.12 0.012 40 / .78) 34%, oklch(0.12 0.012 40 / .50) 67%, oklch(0.12 0.012 40 / .75) 100%),
  linear-gradient(0deg, oklch(0.12 0.012 40 / .98) 0%, transparent 48%, oklch(0.12 0.012 40 / .32) 100%); }
.work-hero--poster-bg .work-hero__veil{ background:linear-gradient(90deg, oklch(0.12 0.012 40 / .94), oklch(0.12 0.012 40 / .82)); }
.work-hero__inner{ position:relative; z-index:2; min-height:500px; display:grid; grid-template-columns:minmax(185px, 250px) minmax(0, 1fr); align-items:end; gap:var(--s-8); padding:var(--s-8); }
.work-hero__poster{ width:100%; filter:drop-shadow(0 18px 28px oklch(0 0 0 / .5)); }
.work-hero__poster :deep(.poster){ width:100%; border-color:oklch(1 0 0 / .16); box-shadow:var(--shadow-poster); }
.work-hero__body{ max-width:760px; padding-bottom:var(--s-2); }
.work-hero__eyebrow{ display:flex; align-items:center; gap:var(--s-2); color:var(--rose-bright); font-size:var(--fs-sm); letter-spacing:.08em; text-transform:uppercase; }
.work-hero__eyebrow span+span::before{ content:'·'; color:var(--text-faint); margin-right:var(--s-2); }
.work-hero__title{ margin-top:var(--s-3); font-family:var(--font-serif); font-weight:700; font-size:clamp(36px, 5vw, 68px); line-height:1.05; letter-spacing:-.025em; text-wrap:balance; text-shadow:0 3px 25px oklch(0 0 0 / .45); }
.work-hero__original{ color:var(--text-dim); font-size:var(--fs-md); margin-top:var(--s-2); }
.work-hero__tags{ display:flex; align-items:center; flex-wrap:wrap; gap:var(--s-2); margin-top:var(--s-5); }
.work-hero__tag{ background:oklch(0.16 0.02 40 / .62); border-color:oklch(1 0 0 / .16); }
.work-hero__tagline{ color:var(--gold); font-family:var(--font-serif); font-size:var(--fs-lg); margin-top:var(--s-5); }
.work-hero__overview{ color:oklch(0.90 0.008 70 / .88); line-height:1.8; max-width:720px; margin-top:var(--s-3); display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; }
.work-hero__links{ display:flex; flex-wrap:wrap; gap:var(--s-2); margin-top:var(--s-5); }
.work-source-link{ display:inline-flex; align-items:center; gap:6px; border:1px solid oklch(1 0 0 / .22); border-radius:var(--r-pill); padding:6px 11px; color:var(--text-dim); background:oklch(0.12 0.012 40 / .45); font-size:var(--fs-sm); transition:background .18s, border-color .18s, color .18s, transform .18s; }
.work-source-link:hover{ color:var(--text); border-color:var(--rose); background:oklch(0.24 0.03 35 / .72); transform:translateY(-1px); }
.work-source-link span{ color:var(--rose-bright); font-size:12px; }
.work-source-link--douban{ border-color:oklch(0.74 0.085 150 / .4); }
.work-source-link--bangumi{ border-color:oklch(0.76 0.09 350 / .4); }
.work-info{ margin-bottom:var(--s-10); }
.work-info__grid{ display:grid; grid-template-columns:minmax(175px, .8fr) minmax(270px, 1.35fr) minmax(260px, 1.25fr); gap:var(--s-4); }
.work-rating-card, .work-facts-card, .work-credits-card{ min-height:190px; padding:var(--s-5); border:1px solid var(--line-soft); border-radius:var(--r-lg); background:linear-gradient(145deg, var(--surface), var(--surface-2)); }
.work-info__label{ color:var(--text-faint); font-size:var(--fs-sm); letter-spacing:.06em; margin-bottom:var(--s-4); }
.work-rating-card__main{ display:flex; align-items:baseline; gap:5px; }
.work-rating-card__score{ color:var(--gold); font-family:var(--font-brand); font-style:italic; font-weight:600; font-size:52px; line-height:1; }
.work-rating-card__ten{ color:var(--text-faint); font-family:var(--font-brand); font-size:var(--fs-md); }
.work-rating-card__source{ color:var(--text-dim); font-size:var(--fs-sm); margin-top:var(--s-2); }
.work-rating-card__secondary{ display:flex; align-items:center; gap:var(--s-2); margin-top:var(--s-5); padding-top:var(--s-3); border-top:1px solid var(--line-soft); color:var(--text-faint); font-size:var(--fs-sm); }
.work-rating-card__secondary strong{ color:var(--gold); font-family:var(--font-brand); font-style:italic; font-size:var(--fs-lg); }
.work-facts{ display:grid; grid-template-columns:1fr 1fr; gap:var(--s-3) var(--s-5); }
.work-facts div{ min-width:0; }
.work-facts dt{ color:var(--text-faint); font-size:var(--fs-cap); margin-bottom:2px; }
.work-facts dd{ color:var(--text); font-size:var(--fs-sm); overflow-wrap:anywhere; }
.work-facts dd a{ color:var(--rose-bright); }
.work-credit-row{ display:grid; grid-template-columns:38px minmax(0,1fr); gap:var(--s-2); margin-top:var(--s-3); color:var(--text-dim); font-size:var(--fs-sm); line-height:1.55; }
.work-credit-row span{ color:var(--rose-bright); }
.work-credit-row p{ min-width:0; }
.record-grid{ display:grid; grid-template-columns:1fr 1fr; gap:var(--s-4); margin-bottom:var(--s-4); }
.record{ background:var(--surface); border:1px solid var(--line-soft); border-radius:var(--r-lg); padding:var(--s-5); position:relative; }
.record__head{ display:flex; align-items:center; gap:var(--s-3); margin-bottom:var(--s-4); }
.record__avatar{ width:34px; height:34px; border-radius:50%; display:grid; place-items:center; font-family:var(--font-brand); font-style:italic; font-weight:700; color:var(--bg); }
.record[data-who="a"] .record__avatar{ background:var(--user-a); }
.record[data-who="b"] .record__avatar{ background:var(--user-b); }
.record__score{ margin-left:auto; margin-right:26px; font-family:var(--font-brand); font-style:italic; font-weight:600; font-size:var(--fs-2xl); color:var(--gold); line-height:1; }   /* 留出右上角编辑按钮的位置，避免重合 */
.record__review{ color:var(--text-dim); line-height:1.7; font-size:var(--fs-body); }
@media (max-width:980px){
  .work-info__grid{ grid-template-columns:1fr 1fr; }
  .work-credits-card{ grid-column:1 / -1; }
}

@media (max-width:680px){
  .work-hero{ min-height:0; }
  .work-hero__inner{ min-height:0; grid-template-columns:1fr; align-items:start; gap:var(--s-5); padding:var(--s-5); }
  .work-hero__poster{ width:150px; margin:0 auto; }
  .work-hero__body{ padding-bottom:0; }
  .work-hero__title{ font-size:clamp(34px, 11vw, 48px); }
  .work-hero__overview{ -webkit-line-clamp:7; }
  .work-info__grid{ grid-template-columns:1fr; }
  .work-credits-card{ grid-column:auto; }
  .record-grid{ grid-template-columns:1fr; }
  .work-facts{ gap:var(--s-3) var(--s-4); }
}

/* ============================================================ 内联样式收编（T12）
   以下均由原静态内联 style 属性收编而成，声明逐字节保持原值，零像素改动。
   .record 是本文件本地类（未在别处使用，Settings.vue 仅共用 __who/__role 子类，
   见上方 T10 注释），原内联 position:relative 直接并入既有本地规则，无需新起修饰类。
   .state-note 合并三处 text-align:center;padding:var(--s-8) 完全同值的内联（加载中 /
   详情页整体错误 / 无任何记录），差异仅在文字颜色，拆成 .state-note--faint（两处，
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
</style>
