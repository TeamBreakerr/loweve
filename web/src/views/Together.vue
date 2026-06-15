<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useSessions } from '../stores/sessions';
import AddModal from '../components/AddModal.vue';
import EditModal from '../components/EditModal.vue';
import TogetherReel from '../components/TogetherReel.vue';

const sessions = useSessions();
const modalOpen = ref(false);

const editOpen = ref(false);
const editRecord = ref<any>(null);
function openEdit(s: any) { editRecord.value = s; editOpen.value = true; }

onMounted(() => sessions.load());
</script>

<template>
  <main class="page">
    <router-link class="back-link" to="/">
      <svg viewBox="0 0 24 24"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>返回首页
    </router-link>
    <div class="page-hero">
      <span class="page-hero__kicker">Watched Together</span>
      <h1 class="page-hero__title">一起看过</h1>
      <p class="page-hero__lead">我们一起看完的每一部，连同各自的评分和那天的日期。转动左边那卷胶片，一格格连续翻看过去的每个月。</p>
    </div>

    <div class="section__head" style="margin-bottom:var(--s-6)">
      <span class="section__hint">共 {{ sessions.list.length }} 部</span>
      <div class="section__actions">
        <button class="btn btn--ticket" @click="modalOpen = true">
          <svg class="btn__ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>添加记录
        </button>
      </div>
    </div>

    <p v-if="sessions.loading" style="color:var(--text-faint);text-align:center;padding:var(--s-8)">加载中…</p>
    <p v-else-if="!sessions.list.length" style="color:var(--text-faint);text-align:center;padding:var(--s-12) 0">
      还没有一起看过的记录。
    </p>

    <TogetherReel v-else :sessions="sessions.list" @edit="openEdit" />

    <AddModal v-model="modalOpen" initial-target="couple_watched" @added="sessions.load" />
    <EditModal v-model="editOpen" type="session" :record="editRecord" @changed="sessions.load" />
  </main>
</template>

<style scoped>
/* 「添加记录」做成胶片标签：玫红底 + 上下齿孔 */
.btn--ticket {
  position: relative; display: inline-flex; align-items: center; gap: 6px;
  background: var(--rose); color: oklch(0.16 0.02 30); font-weight: 600;
  border: none; border-radius: var(--r-xs); padding: 11px 18px; white-space: nowrap;
  transition: background .2s var(--ease), transform .12s;
}
.btn--ticket .btn__ic { width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 2; }
.btn--ticket::before, .btn--ticket::after {
  content: ""; position: absolute; left: 7px; right: 7px; height: 4px;
  background-image: radial-gradient(circle, oklch(0.16 0.02 30 / 0.5) 0 1.3px, transparent 1.7px);
  background-size: 8px 4px; background-position: center; pointer-events: none;
}
.btn--ticket::before { top: 3px; } .btn--ticket::after { bottom: 3px; }
.btn--ticket:hover { background: var(--rose-bright); transform: translateY(-1px); }
</style>
