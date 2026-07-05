<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useRecos } from '../stores/recos';
import { useSessions } from '../stores/sessions';
import { usePlan } from '../stores/plan';
import { useIdentity } from '../stores/identity';
import Poster from '../components/Poster.vue';
import Rating from '../components/Rating.vue';
import FeedbackBtns from '../components/FeedbackBtns.vue';
import Priority from '../components/Priority.vue';
import AddModal from '../components/AddModal.vue';
import EditModal from '../components/EditModal.vue';
import WatchedTimeline from '../components/WatchedTimeline.vue';
import { ratingHref } from '../api/index';

const router = useRouter();

const editOpen = ref(false);
const editType = ref('session');
const editRecord = ref<any>(null);
function openEdit(type: any, record: any) { editType.value = type; editRecord.value = record; editOpen.value = true; }

const identity = useIdentity();

// —— AI 推荐排片榜 ——
const recos = useRecos();
const intent = ref('');
onMounted(() => recos.load());
const hero = computed(() => recos.items[0]);
const mids = computed(() => recos.items.slice(1, 3));
const minis = computed(() => recos.items.slice(3));
function refresh() { intent.value.trim() ? recos.custom(intent.value.trim()) : recos.refresh(); }
function submitIntent() { if (intent.value.trim()) recos.custom(intent.value.trim()); }
// 爱心(想看)→ 先弹优先级，选完再加入「想看就一起看」；没兴趣/看过即时处理
const wantPickerOpen = ref(false);
const wantRec = ref<any>(null);
const wantPriority = ref(0);
function onFeedback(rec: any, emitName: any) {
  if (emitName === 'want') { wantRec.value = rec; wantPriority.value = 0; wantPickerOpen.value = true; }
  else recos.feedback(rec, emitName);
}
function confirmWant() {
  if (wantRec.value) recos.feedback(wantRec.value, 'want', wantPriority.value);
  wantPickerOpen.value = false; wantRec.value = null;
}
function openWork(rec: any) { if (rec.work_id) router.push(`/work/${rec.work_id}`); }

// —— 一起看过 ——
const sessions = useSessions();
onMounted(() => sessions.load());

const watchedModalOpen = ref(false);

// —— 想看就一起看（扁平清单：只显示还想看的，已看过/弃了不展示）——
const plan = usePlan();
onMounted(() => plan.load());
const visiblePlan = computed(() =>
  plan.list.filter(p => p.status !== 'done' && p.status !== 'dropped').slice(0, 5));
const planModalOpen = ref(false);
</script>

<template>
  <main class="page">

    <!-- ① AI 推荐 · 排片榜 -->
    <section class="section" id="reco">
      <div class="section__head">
        <h2 class="section__title">今晚为<span class="accent">你们</span>排片</h2>
        <div class="section__actions">
          <button class="btn btn--icon btn--ghost" data-tip="换一批" @click="refresh" :disabled="recos.loading">
            <svg class="btn__ic" viewBox="0 0 24 24" :class="{ 'spin-loop': recos.loading }"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>
          </button>
        </div>
      </div>

      <div class="intent">
        <svg class="intent__ic" viewBox="0 0 24 24"><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M7 7 5.5 5.5M17 17l1.5 1.5M17 7l1.5-1.5M7 17l-1.5 1.5"/><circle cx="12" cy="12" r="4"/></svg>
        <input class="intent__input" type="text" v-model="intent" @keyup.enter="submitIntent"
               placeholder='想看什么？例如「今晚 90 分钟内的轻松治愈片」「完结的短番 12 集左右」' />
        <button class="intent__btn" data-tip="按要求推荐" @click="submitIntent">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>
      </div>

      <!-- 生成中：会蹦的爆米花 + 流光「思考」文字 -->
      <div v-if="recos.loading" class="reco-think">
        <svg class="popcorn" viewBox="0 0 48 48" aria-hidden="true">
          <defs><clipPath id="pcCup"><path d="M14 24 H34 L31 44 H17 Z"/></clipPath></defs>
          <g clip-path="url(#pcCup)">
            <rect x="14" y="24" width="20" height="20" fill="#f2ebe0"/>
            <rect x="16.5" y="24" width="3.2" height="20" fill="#e0584f"/>
            <rect x="23" y="24" width="3.2" height="20" fill="#e0584f"/>
            <rect x="29.5" y="24" width="3.2" height="20" fill="#e0584f"/>
          </g>
          <path d="M14 24 H34 L31 44 H17 Z" fill="none" stroke="#d6504a" stroke-width="1.6" stroke-linejoin="round"/>
          <line x1="13" y1="24" x2="35" y2="24" stroke="#d6504a" stroke-width="2.4" stroke-linecap="round"/>
          <g class="pc-corn">
            <circle class="pc-k pc-k1" cx="18" cy="20" r="4.2"/>
            <circle class="pc-k pc-k2" cx="24" cy="15" r="5"/>
            <circle class="pc-k pc-k3" cx="30" cy="20" r="4.2"/>
            <circle class="pc-k pc-k4" cx="24" cy="21" r="4.4"/>
          </g>
        </svg>
        <span class="reco-think__txt">正在为你们挑片…</span>
      </div>
      <template v-else>
      <p v-if="!recos.items.length" style="color:var(--text-faint);padding:var(--s-4) var(--s-3)">
        {{ recos.error === 'llm_unconfigured' ? '推荐未启用' : '推荐暂时不可用，点右上角换一批重试' }}
      </p>
      <template v-else>

      <!-- 1 号大卡 + 2/3 号中卡 -->
      <div class="reco-top">
        <article v-if="hero" class="rk rk-hero">
          <span class="rk-num">1</span>
          <Poster :color="'#2a2a30'" :url="hero.poster_url" :kind="hero.is_anime ? '番剧' : ''" />
          <div class="rk-hero__body">
            <h3 class="rk-hero__title" style="cursor:pointer" @click="openWork(hero)">{{ hero.title }} <span class="year">{{ hero.year }}</span></h3>
            <div class="rk-meta">
              <span v-if="hero.is_anime" class="tag">番剧</span>
              <Rating :source="hero.rating_source" :score="hero.primary_rating ? hero.primary_rating.toFixed(1) : '—'" :href="ratingHref(hero)" />
            </div>
            <div class="rk-reason">
              <span class="label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-8-4.5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.5-8 11-8 11Z"/></svg>
                为什么推给你们
              </span>
              <div>{{ hero.reason }}</div>
            </div>
            <div class="rk-actions"><FeedbackBtns @want="onFeedback(hero,'want')" @no="onFeedback(hero,'no')" @seen="onFeedback(hero,'seen')" /></div>
          </div>
        </article>
        <div class="rk-mids">
          <article v-for="(d, i) in mids" :key="d.id" class="rk rk-mid">
            <span class="rk-num">{{ i + 2 }}</span>
            <Poster :color="'#2a2a30'" :url="d.poster_url" :kind="d.is_anime ? '番剧' : ''" />
            <div class="rk-mid__body">
              <h3 class="rk-mid__title" style="cursor:pointer" @click="openWork(d)">{{ d.title }} <span class="year">{{ d.year }}</span></h3>
              <Rating :source="d.rating_source" :score="d.primary_rating ? d.primary_rating.toFixed(1) : '—'" :href="ratingHref(d)" style="align-self:flex-start" />
              <div class="rk-reason">{{ d.reason }}</div>
              <div class="rk-actions"><FeedbackBtns @want="onFeedback(d,'want')" @no="onFeedback(d,'no')" @seen="onFeedback(d,'seen')" /></div>
            </div>
          </article>
        </div>
      </div>

      <!-- 4–10 名横向小卡 -->
      <div class="reco-rail">
        <article v-for="(d, i) in minis" :key="d.id" class="rk-mini">
          <div class="rk-mini__pw">
            <span class="rk-num">{{ i + 4 }}</span>
            <Poster :color="'#2a2a30'" :url="d.poster_url" :kind="d.is_anime ? '番剧' : ''" />
            <div v-if="d.reason" class="rk-mini__reason">
              <span class="rk-mini__reason-hd">
                <svg viewBox="0 0 24 24"><path d="M12 21s-8-4.5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.5-8 11-8 11Z"/></svg>
                为什么推给你们
              </span>
              <p>{{ d.reason }}</p>
            </div>
          </div>
          <div class="rk-mini__body">
            <h4 class="rk-mini__title" style="cursor:pointer" @click="openWork(d)">{{ d.title }} <span class="year">{{ d.year }}</span></h4>
            <Rating :source="d.rating_source" :score="d.primary_rating ? d.primary_rating.toFixed(1) : '—'" :href="ratingHref(d)" style="align-self:flex-start" />
            <div class="rk-mini__foot"><FeedbackBtns @want="onFeedback(d,'want')" @no="onFeedback(d,'no')" @seen="onFeedback(d,'seen')" /></div>
          </div>
        </article>
      </div>
      </template>
      </template>
    </section>

    <!-- ② 一起看过 -->
    <section class="section" id="together">
      <div class="section__head">
        <h2 class="section__title">一起看过</h2>
        <div class="section__actions">
          <button class="btn btn--icon btn--rose" data-tip="添加" @click="watchedModalOpen = true">
            <svg class="btn__ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <router-link class="link-more" to="/together" data-tip="查看全部">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </router-link>
        </div>
      </div>

      <WatchedTimeline :sessions="sessions.list" @edit="s => openEdit('session', s)" />
    </section>

    <!-- ③ 想看就一起看 -->
    <section class="section" id="plan">
      <div class="section__head">
        <h2 class="section__title">想看就一起看</h2>
        <div class="section__actions">
          <button class="btn btn--icon btn--rose" data-tip="添加" @click="planModalOpen = true">
            <svg class="btn__ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <router-link class="link-more" to="/plan" data-tip="查看全部">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </router-link>
        </div>
      </div>

      <div class="hrail">
        <p v-if="!visiblePlan.length" style="color:var(--text-faint);padding:0 var(--s-3)">
          想看清单还是空的。
        </p>
        <article v-for="p in visiblePlan" :key="p.id" class="hcard">
          <div class="hcard__pw">
            <Poster :color="'#2a2a30'" :url="p.work?.primary_poster_url" :kind="p.work?.is_anime ? '番剧' : ''"
                    style="cursor:pointer" @click="p.work_id && router.push(`/work/${p.work_id}`)" />
          </div>
          <div class="hcard__body">
            <h3 class="hcard__title" style="cursor:pointer" @click="p.work_id && router.push(`/work/${p.work_id}`)">{{ p.work?.title }} <span class="year">{{ p.work?.year }}</span></h3>
            <div class="hcard__row">
              <Rating v-if="p.work" :source="p.work.rating_source" :score="p.work.primary_rating?.toFixed(1) || '—'" :href="ratingHref(p.work)" />
              <Priority :value="p.priority" />
              <span class="adder" :data-who="identity.whoKey(p.added_by)" :data-tip="(identity.userById(p.added_by)?.display_name || '') + ' 添加'" style="margin-left:auto">
                <span class="adder__dot">{{ identity.userById(p.added_by)?.display_name?.[0] || (p.added_by === 1 ? 'A' : 'B') }}</span>
              </span>
            </div>
          </div>
        </article>
      </div>
    </section>

    <!-- 推荐爱心 → 选优先级再加入想看 -->
    <div v-if="wantPickerOpen" class="modal-overlay is-open" @click.self="wantPickerOpen = false">
      <div class="modal" style="max-width:380px" role="dialog" aria-modal="true">
        <div class="modal__head">
          <h3 class="modal__title">加入想看 · 优先级</h3>
          <button class="modal__close" @click="wantPickerOpen = false" aria-label="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="modal__body">
          <p style="color:var(--text-dim);font-size:var(--fs-body)">{{ wantRec?.title }}<span v-if="wantRec?.year" class="year"> {{ wantRec.year }}</span></p>
          <div class="rate-row">
            <button v-for="n in [0,1,2,3]" :key="n" class="target prio-opt" style="flex:1;padding:9px 0"
                    :class="{ 'is-active': wantPriority === n }" @click="wantPriority = n">
              <span v-if="n === 0">无</span><Priority v-else :value="n" :total="n" />
            </button>
          </div>
        </div>
        <div class="modal__foot">
          <button class="btn btn--primary" style="flex:1" @click="confirmWant">加入想看</button>
          <button class="btn" @click="wantPickerOpen = false">取消</button>
        </div>
      </div>
    </div>

    <AddModal v-model="watchedModalOpen" initial-target="couple_watched" @added="sessions.load" />
    <AddModal v-model="planModalOpen" initial-target="couple_plan" @added="plan.load" />
    <EditModal v-model="editOpen" :type="editType" :record="editRecord" @changed="editType === 'plan' ? plan.load() : sessions.load()" />
  </main>
</template>

<style scoped>
.spin-once { animation: spin 0.6s cubic-bezier(.22,.61,.36,1); }
.spin-loop { animation: spin 0.9s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* 推荐生成中：会蹦的爆米花 + 流光「思考」文字 */
.reco-think {
  display: flex; align-items: center; justify-content: center; gap: 12px;
  padding: var(--s-10) var(--s-3); font-size: var(--fs-md);
}
.popcorn { width: 44px; height: 44px; flex-shrink: 0; }
.pc-corn { fill: #f6e6a6; }
.pc-k {
  transform-box: fill-box; transform-origin: center bottom;
  animation: pcPop 1.05s ease-in-out infinite;
}
.pc-k2 { animation-delay: .12s; }
.pc-k3 { animation-delay: .26s; }
.pc-k4 { animation-delay: .4s; }
@keyframes pcPop {
  0%, 100% { transform: translateY(0) scale(1); }
  45% { transform: translateY(-2.6px) scale(1.16); }
}
.reco-think__txt {
  background: linear-gradient(100deg, var(--text-faint) 36%, var(--text) 50%, var(--text-faint) 64%);
  background-size: 220% 100%;
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  animation: thinkShimmer 2s linear infinite;
}
@keyframes thinkShimmer { from { background-position: 220% 0; } to { background-position: -220% 0; } }

/* ============================================================ 布局骨架（Home.vue 专属部分） */
/* 从 styles/loweve.css「布局骨架」段搬入（T10 批 5，纯剪切，未改声明）。.section__title
   本身是 primitives 类，但 .section__title .accent 最右侧 .accent 只在本文件出现。*/
.section__title .accent{ color:var(--rose); }
.link-more{ font-size:var(--fs-sm); color:var(--rose); display:inline-flex; align-items:center; justify-content:center; gap:4px; width:34px; height:34px; border:1px solid var(--line); border-radius:var(--r-pill); background:var(--surface-2); transition:all .2s; }
.link-more:hover{ color:oklch(0.16 0.02 30); background:var(--rose); border-color:var(--rose); }
.link-more svg{ width:16px; height:16px; }

/* ============================================================ ① AI 推荐 */
.intent{
  display:flex; gap:var(--s-2); margin-bottom:var(--s-5);
  background:var(--surface); border:1px solid var(--line-soft);
  border-radius:var(--r-pill); padding:2px 4px 2px var(--s-5);
  align-items:center; box-shadow:var(--shadow-sm);
  max-width:680px;
}
.intent__ic{ width:18px; height:18px; stroke:var(--rose); fill:none; stroke-width:1.7; flex-shrink:0; }
.intent__input{
  flex:1; background:none; border:none; outline:none;
  color:var(--text); font-size:var(--fs-body); min-width:0;
}
.intent__input::placeholder{ color:var(--text-faint); }
.intent__btn{
  background:var(--rose); border:1px solid var(--rose);
  color:oklch(0.16 0.02 30); font-weight:600; font-size:var(--fs-sm);
  padding:5px 16px; border-radius:var(--r-pill); white-space:nowrap;
  transition:background .2s, transform .2s;
}
.intent__btn:hover{ background:var(--rose-bright); border-color:var(--rose-bright); transform:translateY(-1px); }

/* ============================================================
   首页改版：推荐「排片榜」（按名次定大小）+ 横向卡片轨道
   ============================================================ */
/* —— 推荐顶部：1 号大卡 + 2/3 号中卡 —— */
.reco-top{ display:grid; grid-template-columns:1.55fr 1fr; gap:var(--s-4); margin-bottom:var(--s-4); }
.rk{ position:relative; background:var(--surface); border-radius:var(--r-lg); overflow:hidden; }
.rk-num{ position:absolute; z-index:2; font-family:var(--font-brand); font-style:italic; font-weight:600; line-height:.78; color:var(--rose); pointer-events:none; }

.rk-hero{ display:flex; gap:0; height:100%; }
.rk-hero .rk-num{ top:18px; right:24px; font-size:90px; }
.rk-hero__body{ flex:1; min-width:0; display:flex; flex-direction:column; gap:var(--s-3); padding:var(--s-5); }
.rk-hero__title{ font-family:var(--font-serif); font-weight:700; font-size:var(--fs-xl); line-height:1.15; padding-right:70px; }
/* .rk-hero__title .year / .rk-mid__title .year 从 styles/loweve.css 搬入（T10 批 6，纯剪切，
   未改声明）。.year 本身是 primitives 类，但这两条复合选择器最右侧的宿主 .rk-hero__title/
   .rk-mid__title 都只在本文件出现，同批 5 第 6 项同构处理。*/
.rk-hero__title .year{ color:var(--text-faint); font-weight:400; font-family:var(--font-sans); font-size:var(--fs-md); }
.rk-meta{ display:flex; align-items:center; gap:var(--s-2); flex-wrap:wrap; }
.rk-reason{ font-size:var(--fs-body); line-height:1.6; color:var(--text-dim); }
.rk-reason .label{ display:inline-flex; align-items:center; gap:6px; color:var(--rose); font-size:var(--fs-sm); margin-bottom:6px; }
.rk-reason .label svg{ width:15px; height:15px; stroke:currentColor; fill:none; stroke-width:1.8; }
.rk-actions{ display:flex; gap:var(--s-2); margin-top:auto; justify-content:flex-end; }

.rk-mids{ display:flex; flex-direction:column; gap:var(--s-4); }
.rk-mid{ display:flex; gap:0; flex:1; }
.rk-mid .rk-num{ top:12px; right:16px; font-size:40px; }
.rk-mid__body{ flex:1; min-width:0; display:flex; flex-direction:column; gap:7px; padding:var(--s-4); }
.rk-mid__title{ font-family:var(--font-serif); font-weight:600; font-size:var(--fs-md); line-height:1.2; padding-right:36px; }
.rk-mid__title .year{ color:var(--text-faint); font-weight:400; font-family:var(--font-sans); font-size:var(--fs-sm); }
.rk-mid .rk-reason{ font-size:var(--fs-sm); line-height:1.5; }
.rk-mid .rk-actions{ gap:6px; }

/* —— 推荐尾部 4–10：横向小卡轨道 —— */
.reco-rail{ display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:var(--s-3); padding-bottom:var(--s-4); }
.reco-rail::-webkit-scrollbar{ height:8px; }
.reco-rail::-webkit-scrollbar-thumb{ background:var(--surface-3); border-radius:var(--r-pill); }
.rk-mini{ background:var(--surface); border-radius:var(--r-md); overflow:hidden; display:flex; flex-direction:column; transition:transform .25s var(--ease); }
.rk-mini:hover{ transform:translateY(-4px); }
.rk-mini__pw{ position:relative; }
/* 小卡推荐评语：悬浮 ~0.4s 后磨砂玻璃浮层上滑淡入，移开即收 */
.rk-mini__reason{
  position:absolute; inset:0; z-index:2; padding:13px 13px 14px;
  display:flex; flex-direction:column; gap:8px;
  background:linear-gradient(180deg, oklch(0.15 0.025 25 / 0.74), oklch(0.10 0.02 28 / 0.97) 58%);
  backdrop-filter:blur(7px) saturate(1.05); -webkit-backdrop-filter:blur(7px) saturate(1.05);
  opacity:0; pointer-events:none; transform:translateY(8px);
  transition:opacity .28s ease, transform .28s ease;
}
.rk-mini:hover .rk-mini__reason{ opacity:1; transform:translateY(0); transition-delay:.4s; }
.rk-mini__reason-hd{
  display:inline-flex; align-items:center; gap:5px; flex:0 0 auto;
  color:var(--rose); font-size:12px; font-weight:700; letter-spacing:.02em;
}
.rk-mini__reason-hd svg{ width:13px; height:13px; fill:var(--rose); stroke:none; }
.rk-mini__reason p{
  margin:0; color:oklch(0.93 0.012 60); font-size:var(--fs-sm); line-height:1.6;
  overflow-y:auto; flex:1 1 auto;
}
.rk-mini .rk-num{ top:5px; left:9px; font-size:30px; color:oklch(0.98 0.06 25); }
.rk-mini__body{ padding:var(--s-3); display:flex; flex-direction:column; gap:8px; }
.rk-mini__title{ font-family:var(--font-serif); font-weight:600; font-size:var(--fs-sm); line-height:1.25; }
.rk-mini__foot{ display:flex; gap:5px; margin-top:auto; }

/* —— 横向卡片轨道：想看就一起看 —— */
.hrail{ display:flex; gap:var(--s-4); overflow-x:auto; padding:4px 4px var(--s-4); margin:0 -4px; scroll-snap-type:x mandatory; scrollbar-width:thin; }
.hrail::-webkit-scrollbar{ height:8px; }
.hrail::-webkit-scrollbar-thumb{ background:var(--surface-3); border-radius:var(--r-pill); }

@media (max-width:680px){
  .intent{ flex-wrap:wrap; border-radius:var(--r-lg); padding:var(--s-3); }
  .intent__input{ flex-basis:100%; padding:4px 0; }
  .intent__btn{ width:100%; justify-content:center; }
}
@media (max-width:860px){
  .reco-top{ grid-template-columns:1fr; }
  .rk-mid{ gap:var(--s-4); padding:var(--s-4); }
  .rk-mid__body{ padding:0; }
}
@media (max-width:680px){
  .rk-hero{ flex-direction:column; gap:var(--s-4); }
  .rk-hero__title{ padding-right:0; }
  .rk-hero .rk-num{ font-size:60px; top:12px; right:16px; }
}
</style>
