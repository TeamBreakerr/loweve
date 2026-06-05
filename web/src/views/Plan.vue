<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { usePlan } from '../stores/plan';
import { useSessions } from '../stores/sessions';
import { useIdentity } from '../stores/identity';
import Poster from '../components/Poster.vue';
import Rating from '../components/Rating.vue';
import Stars from '../components/Stars.vue';
import AddModal from '../components/AddModal.vue';
import EditModal from '../components/EditModal.vue';
import { ratingHref } from '../api/index';

const router = useRouter();
const plan = usePlan();
const sessions = useSessions();
const identity = useIdentity();

const editOpen = ref(false);
const editRecord = ref(null);
function openEdit(p) { editRecord.value = p; editOpen.value = true; }

const planFilter = ref('全部');
const planFilters = ['全部', '待看', '在看', '弃了'];
const STATUS_MAP = { '全部': null, '待看': 'pending', '在看': 'watching', '弃了': 'dropped' };

const visible = computed(() => {
  const s = STATUS_MAP[planFilter.value];
  return s ? plan.list.filter(p => p.status === s) : plan.list;
});
const planCounts = computed(() => {
  const c = plan.list.reduce((m: Record<string, number>, x) => (m[x.status] = (m[x.status] || 0) + 1, m), {} as Record<string, number>);
  return { 全部: plan.list.length, 待看: c.pending||0, 在看: c.watching||0, 弃了: c.dropped||0 };
});

const addModalOpen = ref(false);
const finishModalOpen = ref(false);
const finishingPlan = ref(null);

function startWatching(p) { plan.update(p.id, { status: 'watching' }); }
function openFinish(p) {
  finishingPlan.value = { id: p.id, work: p.work };
  finishModalOpen.value = true;
}
async function onFinished() {
  await Promise.all([plan.load(), sessions.load()]);
  finishingPlan.value = null;
}

onMounted(() => plan.load());

function statusZh(s) { return { pending:'待看', watching:'在看', done:'看完', dropped:'弃了' }[s] || s; }
</script>

<template>
  <main class="page">
    <router-link class="back-link" to="/">
      <svg viewBox="0 0 24 24"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>返回首页
    </router-link>
    <div class="page-hero">
      <span class="page-hero__kicker">Want to Watch</span>
      <h1 class="page-hero__title">想看就一起看</h1>
      <p class="page-hero__lead">两个人共同的待看清单。按优先级排个序，挑一部当下都想看的，今晚就开始。</p>
    </div>

    <div class="section__head" style="margin-bottom:var(--s-6)">
      <div class="filters">
        <button v-for="f in planFilters" :key="f" class="chip"
                :class="{ 'is-active': planFilter === f }" @click="planFilter = f">
          {{ f }}<span class="count">{{ planCounts[f] }}</span>
        </button>
      </div>
      <div class="section__actions">
        <button class="btn btn--rose" @click="addModalOpen = true">
          <svg class="btn__ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>添加
        </button>
      </div>
    </div>

    <p v-if="plan.loading" style="color:var(--text-faint);text-align:center;padding:var(--s-8)">加载中…</p>
    <p v-else-if="!visible.length" style="color:var(--text-faint);text-align:center;padding:var(--s-12) 0">
      {{ planFilter === '全部' ? '想看清单还是空的。' : '这个状态下还没有作品。' }}
    </p>

    <div v-else class="grid grid--plan">
      <article v-for="p in visible" :key="p.id" class="plan-card" :data-status="statusZh(p.status)">
        <Poster :color="'#2a2a30'" :url="p.work?.primary_poster_url" :kind="p.work?.is_anime ? '番剧' : ''" />
        <div class="plan-card__body">
          <div class="plan-card__head">
            <h3 class="plan-card__title">{{ p.work?.title }} <span class="year">{{ p.work?.year }}</span></h3>
            <Stars :value="p.priority" />
          </div>
          <div class="plan-card__row">
            <Rating v-if="p.work" :source="p.work.rating_source" :score="p.work.primary_rating?.toFixed(1) || '—'" :href="ratingHref(p.work)" />
            <span class="adder" :data-who="identity.whoKey(p.added_by)">
              <span class="adder__dot">{{ identity.userById(p.added_by)?.display_name?.[0] || (p.added_by === 1 ? 'A' : 'B') }}</span>{{ identity.userById(p.added_by)?.display_name || '' }} 添加
            </span>
            <span class="status" :data-s="statusZh(p.status)">{{ statusZh(p.status) }}</span>
          </div>
          <p class="plan-card__note" :style="!p.note ? 'color:var(--text-faint)' : ''">{{ p.note || '还没写备注…' }}</p>
          <div class="plan-card__actions">
            <button v-if="p.status === 'pending'" class="btn btn--rose" @click="startWatching(p)">开始观看</button>
            <button v-else-if="p.status === 'watching'" class="btn btn--rose" @click="openFinish(p)">看完了</button>
            <button v-else-if="p.status === 'dropped'" class="btn btn--ghost" @click="plan.update(p.id, {status:'pending'})">恢复</button>
            <button class="btn btn--ghost" @click="openEdit(p)">编辑</button>
            <button class="btn btn--ghost" @click="router.push(`/work/${p.work_id}`)">详情</button>
          </div>
        </div>
      </article>
    </div>

    <AddModal v-model="addModalOpen" initial-target="couple_plan" @added="plan.load" />
    <AddModal v-model="finishModalOpen" :from-plan="finishingPlan" @added="onFinished" />
    <EditModal v-model="editOpen" type="plan" :record="editRecord" @changed="plan.load" />
  </main>
</template>
