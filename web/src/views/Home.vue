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
import Stars from '../components/Stars.vue';
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
function onFeedback(rec: any, emitName: any) { recos.feedback(rec, emitName); }
function openWork(rec: any) { if (rec.work_id) router.push(`/work/${rec.work_id}`); }

// —— 一起看过 ——
const sessions = useSessions();
onMounted(() => sessions.load());

const watchedModalOpen = ref(false);

// —— 想看就一起看 ——
const plan = usePlan();
onMounted(() => plan.load());

const planFilter = ref('全部');
const planFilters = ['全部', '待看', '在看', '弃了'];
const STATUS_MAP_HOME = { '全部': null, '待看': 'pending', '在看': 'watching', '弃了': 'dropped' };

const planRecent = computed(() => plan.list.slice(0, 5));
const visiblePlan = computed(() => {
  const f = STATUS_MAP_HOME[planFilter.value as keyof typeof STATUS_MAP_HOME];
  return f ? planRecent.value.filter(p => p.status === f) : planRecent.value;
});
const planCountsHome = computed(() => {
  const c = plan.list.reduce((m: Record<string, number>, x) => (m[x.status] = (m[x.status] || 0) + 1, m), {} as Record<string, number>);
  return { 全部: plan.list.length, 待看: c.pending||0, 在看: c.watching||0, 弃了: c.dropped||0 };
});
const planModalOpen = ref(false);

function statusZhHome(s: any) { return ({ pending:'待看', watching:'在看', done:'看完', dropped:'弃了' } as Record<string, string>)[s] || s; }
function startWatching(p: any) { plan.update(p.id, { status: 'watching' }); }
</script>

<template>
  <main class="page">

    <!-- ① AI 推荐 · 排片榜 -->
    <section class="section" id="reco">
      <div class="section__head">
        <h2 class="section__title">今晚为<span class="accent">你们</span>排片</h2>
        <div class="section__actions">
          <button class="btn btn--icon btn--ghost" title="换一批" @click="refresh" :disabled="recos.loading">
            <svg class="btn__ic" viewBox="0 0 24 24" :class="{ 'spin-loop': recos.loading }"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>
          </button>
        </div>
      </div>

      <div class="intent">
        <svg class="intent__ic" viewBox="0 0 24 24"><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M7 7 5.5 5.5M17 17l1.5 1.5M17 7l1.5-1.5M7 17l-1.5 1.5"/><circle cx="12" cy="12" r="4"/></svg>
        <input class="intent__input" type="text" v-model="intent" @keyup.enter="submitIntent"
               placeholder='想看什么？例如「今晚 90 分钟内的轻松治愈片」「完结的短番 12 集左右」' />
        <button class="intent__btn" title="按要求推荐" @click="submitIntent">
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
            <h4 class="rk-mini__title" style="cursor:pointer" @click="openWork(d)">{{ d.title }}</h4>
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
          <button class="btn btn--icon btn--rose" title="添加" @click="watchedModalOpen = true">
            <svg class="btn__ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <router-link class="link-more" to="/together" title="查看全部">
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
          <button class="btn btn--icon btn--rose" title="添加" @click="planModalOpen = true">
            <svg class="btn__ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <router-link class="link-more" to="/plan" title="查看全部">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </router-link>
        </div>
      </div>

      <div class="filters" style="margin-bottom:var(--s-5)">
        <button v-for="f in planFilters" :key="f" class="chip"
                :class="{ 'is-active': planFilter === f }" @click="planFilter = f">
          {{ f }}<span class="count">{{ (planCountsHome as any)[f] }}</span>
        </button>
      </div>

      <div class="hrail">
        <p v-if="!visiblePlan.length" style="color:var(--text-faint);padding:0 var(--s-3)">
          {{ planFilter === '全部' ? '想看清单还是空的。' : '这个状态下还没有作品。' }}
        </p>
        <article v-for="p in visiblePlan" :key="p.id" class="hcard" :data-status="statusZhHome(p.status)">
          <div class="hcard__pw">
            <Poster :color="'#2a2a30'" :url="p.work?.primary_poster_url" :kind="p.work?.is_anime ? '番剧' : ''" />
            <div class="hcard__corner">
              <Stars :value="p.priority" />
            </div>
          </div>
          <div class="hcard__body">
            <h3 class="hcard__title">{{ p.work?.title }} <span class="year">{{ p.work?.year }}</span></h3>
            <div class="hcard__row">
              <Rating v-if="p.work" :source="p.work.rating_source" :score="p.work.primary_rating?.toFixed(1) || '—'" :href="ratingHref(p.work)" />
              <span class="status" :data-s="statusZhHome(p.status)">{{ statusZhHome(p.status) }}</span>
              <span class="adder" :data-who="identity.whoKey(p.added_by)" :title="(identity.userById(p.added_by)?.display_name || '') + ' 添加'">
                <span class="adder__dot">{{ identity.userById(p.added_by)?.display_name?.[0] || (p.added_by === 1 ? 'A' : 'B') }}</span>
              </span>
            </div>
            <p class="hcard__note" :style="!p.note ? 'color:var(--text-faint)' : ''">{{ p.note || '还没写备注…' }}</p>
            <div class="hcard__foot">
              <button v-if="p.status === 'pending'" class="feedback feedback--want" title="开始观看" @click="startWatching(p)">
                <svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>
              </button>
              <button class="feedback" title="详情" @click="router.push(`/work/${p.work_id}`)">
                <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
              </button>
              <button class="feedback feedback--no" title="删除" @click="plan.remove(p.id)">
                <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>

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
</style>
