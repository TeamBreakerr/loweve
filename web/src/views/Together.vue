<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSessions } from '../stores/sessions.js';
import Poster from '../components/Poster.vue';
import Rating from '../components/Rating.vue';
import Dual from '../components/Dual.vue';
import AddModal from '../components/AddModal.vue';
import EditModal from '../components/EditModal.vue';
import { fmtWatched } from '../utils/watchedDate.js';
import { ratingHref } from '../api/index.js';

const router = useRouter();
const sessions = useSessions();
const modalOpen = ref(false);

const editOpen = ref(false);
const editRecord = ref(null);
function openEdit(s) { editRecord.value = s; editOpen.value = true; }

onMounted(() => sessions.load());

const grouped = computed(() => {
  const groups = {};
  sessions.list.forEach(s => {
    const year = s.watched_at ? String(Math.floor(s.watched_at / 10000)) : '未知';
    (groups[year] = groups[year] || []).push(s);
  });
  return Object.entries(groups).sort((a, b) => {
    if (a[0] === '未知') return 1;          // 未知日期排最后
    if (b[0] === '未知') return -1;
    return b[0].localeCompare(a[0]);
  });
});

const fmtDate = (n) => fmtWatched(n, ' 看完');   // 按精度：2026 / 2026-03 / 2026-06-02
</script>

<template>
  <main class="page">
    <router-link class="back-link" to="/">
      <svg viewBox="0 0 24 24"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>返回首页
    </router-link>
    <div class="page-hero">
      <span class="page-hero__kicker">Watched Together</span>
      <h1 class="page-hero__title">一起看过</h1>
      <p class="page-hero__lead">我们一起看完的每一部，连同各自的评分、联合感想和那天的日期。按时间倒序排成一条小小的回忆线。</p>
    </div>

    <div class="section__head" style="margin-bottom:var(--s-8)">
      <span class="section__hint">共 {{ sessions.list.length }} 部</span>
      <div class="section__actions">
        <button class="btn btn--rose" @click="modalOpen = true">
          <svg class="btn__ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>添加
        </button>
      </div>
    </div>

    <p v-if="sessions.loading" style="color:var(--text-faint);text-align:center;padding:var(--s-8)">加载中…</p>
    <p v-else-if="!sessions.list.length" style="color:var(--text-faint);text-align:center;padding:var(--s-12) 0">
      还没有一起看过的记录。
    </p>

    <div v-else class="timeline">
      <div v-for="[year, items] in grouped" :key="year" class="tl-group">
        <div class="tl-year">{{ year }}</div>
        <div v-for="s in items" :key="s.id" class="tl-item">
          <article class="watched-card" style="cursor:pointer;position:relative" @click="router.push(`/work/${s.work_id}`)">
            <button class="card-edit" title="编辑" @click.stop="openEdit(s)">
              <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <Poster :color="'#2a2a30'" :url="s.work?.primary_poster_url" :kind="s.work?.is_anime ? '番剧' : ''" style="width:84px" />
            <div class="watched-card__body">
              <h3 class="watched-card__title">{{ s.work?.title }} <span class="year">{{ s.work?.year }}</span></h3>
              <div v-if="s.watched_at" class="watched-card__date">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 9h18"/></svg>
                {{ fmtDate(s.watched_at) }}
              </div>
              <div class="watched-card__scores">
                <Dual :rating-a="s.rating_a ?? '–'" :rating-b="s.rating_b ?? '–'" />
                <Rating v-if="s.work" :source="s.work.rating_source" :score="s.work.primary_rating?.toFixed(1) || '—'" :href="ratingHref(s.work)" />
              </div>
              <p v-if="s.joint_note" class="watched-card__note"><span class="q">"</span>{{ s.joint_note }}<span class="q">"</span></p>
            </div>
          </article>
        </div>
      </div>
    </div>

    <AddModal v-model="modalOpen" initial-target="couple_watched" @added="sessions.load" />
    <EditModal v-model="editOpen" type="session" :record="editRecord" @changed="sessions.load" />
  </main>
</template>
