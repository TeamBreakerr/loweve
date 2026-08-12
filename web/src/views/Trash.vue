<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api/index';
import { useIdentity } from '../stores/identity';
import Poster from '../components/Poster.vue';
import type { TrashItem } from '../types';

const identity = useIdentity();
const items = ref<TrashItem[]>([]);
const loading = ref(false);
const busyId = ref<number | null>(null);
const error = ref('');

const TYPE_LABELS = {
  mark: '个人记录',
  session: '一起看过',
  plan: '想看就一起看',
};

function itemLabel(item: TrashItem) {
  if (item.entity_type === 'mark') {
    const name = identity.userById(item.payload.user_id)?.display_name;
    return name ? `${name}的个人记录` : TYPE_LABELS.mark;
  }
  return TYPE_LABELS[item.entity_type];
}

function deletedTime(value: number) {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api('/api/trash');
    items.value = data.items || [];
  } catch (e) {
    error.value = e.body?.error || e.message;
  } finally {
    loading.value = false;
  }
}

async function restore(item: TrashItem) {
  busyId.value = item.id;
  error.value = '';
  try {
    await api(`/api/trash/${item.id}/restore`, { method: 'POST' });
    items.value = items.value.filter(entry => entry.id !== item.id);
  } catch (e) {
    error.value = e.body?.error === 'restore_conflict'
      ? `“${item.work.title}”已经在对应列表里，无法重复恢复。`
      : (e.body?.error || e.message);
  } finally {
    busyId.value = null;
  }
}

async function removeForever(item: TrashItem) {
  if (!window.confirm(`永久删除“${item.work.title}”？此操作无法恢复。`)) return;
  busyId.value = item.id;
  error.value = '';
  try {
    await api(`/api/trash/${item.id}`, { method: 'DELETE' });
    items.value = items.value.filter(entry => entry.id !== item.id);
  } catch (e) {
    error.value = e.body?.error || e.message;
  } finally {
    busyId.value = null;
  }
}

onMounted(load);
</script>

<template>
  <main class="page">
    <router-link class="back-link" to="/settings">
      <svg viewBox="0 0 24 24"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>返回设置
    </router-link>
    <div class="page-hero">
      <span class="page-hero__kicker">Recycle Bin</span>
      <h1 class="page-hero__title">回收站</h1>
      <p class="page-hero__lead">删除的记录会先保存在这里。恢复后会回到原来的列表；永久删除不可撤销。</p>
    </div>

    <p v-if="error" class="trash-state trash-state--error">{{ error }}</p>
    <p v-if="loading" class="trash-state">加载中…</p>
    <p v-else-if="!items.length" class="trash-empty">回收站是空的。</p>

    <div v-else class="trash-list">
      <article v-for="item in items" :key="item.id" class="trash-card">
        <router-link :to="`/work/${item.work_id}`" class="trash-card__poster-link">
          <Poster :color="'#2a2a30'" :url="item.work.primary_poster_url" :kind="item.work.is_anime ? '番剧' : ''" class="trash-card__poster" />
        </router-link>
        <div class="trash-card__body">
          <div>
            <span class="trash-card__type">{{ itemLabel(item) }}</span>
            <h2 class="trash-card__title">{{ item.work.title }} <span class="year">{{ item.work.year }}</span></h2>
            <p class="trash-card__meta">
              {{ deletedTime(item.deleted_at) }} 移入回收站
              <span v-if="item.deleted_by_name"> · 操作人 {{ item.deleted_by_name }}</span>
            </p>
          </div>
          <div class="trash-card__actions">
            <button class="btn btn--rose" :disabled="busyId === item.id" @click="restore(item)">
              {{ busyId === item.id ? '处理中…' : '恢复' }}
            </button>
            <button class="btn btn--ghost trash-card__forever" :disabled="busyId === item.id" @click="removeForever(item)">永久删除</button>
          </div>
        </div>
      </article>
    </div>
  </main>
</template>

<style scoped>
.trash-state{ color:var(--text-faint); padding:var(--s-6) 0; }
.trash-state--error{ color:var(--rose-bright); padding:0 0 var(--s-4); }
.trash-empty{ text-align:center; color:var(--text-faint); padding:var(--s-12) 0; border:1px dashed var(--line); border-radius:var(--r-lg); }
.trash-list{ display:flex; flex-direction:column; gap:var(--s-3); max-width:760px; }
.trash-card{ display:flex; gap:var(--s-4); padding:var(--s-3); background:var(--surface); border:1px solid var(--line-soft); border-radius:var(--r-lg); }
.trash-card__poster-link{ flex:0 0 72px; }
.trash-card__poster{ width:72px; }
.trash-card__body{ flex:1; min-width:0; display:flex; align-items:center; justify-content:space-between; gap:var(--s-5); }
.trash-card__type{ display:inline-block; margin-bottom:5px; color:var(--rose); font-size:var(--fs-sm); }
.trash-card__title{ font-family:var(--font-serif); font-weight:600; font-size:var(--fs-md); line-height:1.3; }
.trash-card__meta{ margin-top:7px; color:var(--text-faint); font-size:var(--fs-sm); }
.trash-card__actions{ display:flex; gap:var(--s-2); flex-shrink:0; }
.trash-card__forever{ color:var(--rose-bright); border-color:var(--rose-line); }

@media (max-width:620px){
  .trash-card__body{ align-items:flex-start; flex-direction:column; gap:var(--s-3); }
  .trash-card__actions{ width:100%; }
  .trash-card__actions .btn{ flex:1; justify-content:center; }
}
</style>
