<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ratingHref } from '../api/index.js';
import { useIdentity } from '../stores/identity.js';
import Poster from '../components/Poster.vue';
import Rating from '../components/Rating.vue';
import EditModal from '../components/EditModal.vue';

const route = useRoute();
const router = useRouter();
const identity = useIdentity();

const work = ref(null);
const loading = ref(false);
const error = ref('');

// 编辑已添加的记录（个人标记 / 共看记录）
const editOpen = ref(false);
const editType = ref('mark');
const editRecord = ref(null);
function openEdit(type, record) {
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

const tags = computed(() => {
  if (!work.value) return [];
  try { return JSON.parse(work.value.genres || '[]'); } catch { return []; }
});
const subtitle = computed(() => {
  if (!work.value) return '';
  const parts = [work.value.original_title, work.value.year, work.value.runtime ? `${work.value.runtime} 分钟` : null].filter(Boolean);
  return parts.join(' · ');
});

function statusLabel(s) { return s === 'watched' ? '看过' : s === 'wish' ? '想看' : s; }
</script>

<template>
  <main class="page">
    <router-link class="back-link" to="/together">
      <svg viewBox="0 0 24 24"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>返回
    </router-link>

    <p v-if="loading" style="color:var(--text-faint);text-align:center;padding:var(--s-8)">加载中…</p>
    <p v-else-if="error" style="color:var(--rose-bright);text-align:center;padding:var(--s-8)">{{ error === 'not_found' ? '作品不存在' : error }}</p>

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

      <section v-if="work.all_marks.length" class="section">
        <div class="section__head"><h2 class="section__title">各自的记录</h2></div>
        <div class="record-grid">
          <article v-for="m in work.all_marks" :key="m.id" class="record" style="position:relative" :data-who="identity.whoKey(m.user_id)">
            <button class="card-edit" title="编辑" @click="openEdit('mark', m)">
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
        <div v-for="s in work.sessions" :key="s.id" class="joint" style="margin-bottom:var(--s-4);position:relative">
          <button class="card-edit" title="编辑" @click="openEdit('session', s)">
            <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <div class="joint__label">
            <svg viewBox="0 0 24 24"><path d="M12 21s-8-4.5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.5-8 11-8 11Z"/></svg>
            一起看 · 联合感想
          </div>
          <p v-if="s.joint_note" class="joint__text">{{ s.joint_note }}</p>
          <p v-if="s.review_a" style="margin-top:var(--s-3);color:var(--text-dim)"><strong style="color:var(--user-a)">{{ identity.userById(1)?.display_name }}:</strong> {{ s.review_a }}<span v-if="s.rating_a"> ({{ s.rating_a }})</span></p>
          <p v-if="s.review_b" style="margin-top:var(--s-3);color:var(--text-dim)"><strong style="color:var(--user-b)">{{ identity.userById(2)?.display_name }}:</strong> {{ s.review_b }}<span v-if="s.rating_b"> ({{ s.rating_b }})</span></p>
        </div>
      </section>

      <p v-if="!work.all_marks.length && !work.sessions.length" style="color:var(--text-faint);text-align:center;padding:var(--s-8)">
        还没有任何记录。
      </p>
    </template>

    <EditModal v-model="editOpen" :type="editType" :record="editRecord" @changed="loadWork" />
  </main>
</template>
