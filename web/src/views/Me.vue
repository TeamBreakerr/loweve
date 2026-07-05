<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useIdentity } from '../stores/identity';
import { useMarks } from '../stores/marks';
import Poster from '../components/Poster.vue';
import Rating from '../components/Rating.vue';
import AddModal from '../components/AddModal.vue';
import EditModal from '../components/EditModal.vue';
import { ratingHref } from '../api/index';

const identity = useIdentity();
const marks = useMarks();

const modalOpen = ref(false);
function openAdd() { modalOpen.value = true; }

const editOpen = ref(false);
const editRecord = ref<any>(null);
function openEdit(m: any) { editRecord.value = m; editOpen.value = true; }

onMounted(async () => {
  marks.bindIdentityWatcher();
  await marks.load();
});
</script>

<template>
  <main class="page">
    <div class="page-hero">
      <span class="page-hero__kicker">My Records</span>
      <h1 class="page-hero__title">我的 · {{ identity.viewingName }} 的片单</h1>
      <p class="page-hero__lead">这里是你个人「看过」的记录。想看的直接放进首页的「想看就一起看」，和对方一起。</p>
    </div>

    <div class="section__head" style="margin-bottom:var(--s-6)">
      <span class="section__hint">看过 {{ marks.watched.length }} 部</span>
      <div class="section__actions">
        <button class="btn btn--rose" @click="openAdd">
          <svg class="btn__ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>添加
        </button>
      </div>
    </div>

    <p v-if="marks.loading" style="color:var(--text-faint);text-align:center;padding:var(--s-8)">加载中…</p>

    <section v-else class="tabpane is-active">
      <p v-if="!marks.watched.length" style="color:var(--text-faint);text-align:center;padding:var(--s-12) 0">
        还没记录过看过的作品。点右上「添加」开始 →
      </p>
      <div v-else class="grid grid--me">
        <article v-for="m in marks.watched" :key="m.id" class="title-card">
          <div class="title-card__pw">
            <Poster :color="'#2a2a30'" :url="m.work.primary_poster_url" :kind="m.work.is_anime ? '番剧' : ''" />
            <button class="card-edit" data-tip="编辑" data-tip-pos="below" @click="openEdit(m)">
              <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
          </div>
          <div class="title-card__name">{{ m.work.title }} <span class="year">{{ m.work.year }}</span></div>
          <div class="title-card__row">
            <span v-if="m.rating" class="mini-score"><span class="lab">我</span>{{ m.rating }}</span>
            <Rating :source="m.work.rating_source" :score="m.work.primary_rating?.toFixed(1) || '—'" :href="ratingHref(m.work)" />
          </div>
        </article>
      </div>
    </section>

    <AddModal v-model="modalOpen" initial-target="watched" @added="marks.load" />
    <EditModal v-model="editOpen" type="mark" :record="editRecord" @changed="marks.load" />
  </main>
</template>

<style scoped>
/* 从 styles/loweve.css「二级页面专用样式」段搬入（T10 批 3，纯剪切，未改声明）。
   .title-card .poster / .title-card:hover .poster 留在 loweve.css（跨组件选择器，
   .poster 属于子组件 components/Poster.vue，见该文件注释）。*/
.tabpane{ display:none; }
.tabpane.is-active{ display:block; animation:fade .35s var(--ease); }
@keyframes fade{ from{ opacity:0; transform:translateY(6px);} to{ opacity:1; transform:none; } }

.grid--me{ grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:var(--s-5); }
.title-card{ display:flex; flex-direction:column; gap:var(--s-2); }
/* .title-card__pw 从 styles/loweve.css「卡片角标编辑按钮」段搬入（T10 批 5，纯剪切，未改
   声明；批 3 建本 <style scoped> 块时的漏项，本批补上）。*/
.title-card__pw{ position:relative; }
.title-card__name{ font-family:var(--font-serif); font-weight:600; font-size:var(--fs-body); line-height:1.3; }
.title-card__name .year{ color:var(--text-faint); font-weight:400; font-family:var(--font-sans); font-size:var(--fs-sm); }
.title-card__row{ display:flex; align-items:center; gap:var(--s-2); flex-wrap:wrap; }
.mini-score{ font-family:var(--font-brand); font-style:italic; font-weight:600; color:var(--gold); font-size:var(--fs-md); }
.mini-score .lab{ font-family:var(--font-sans); font-style:normal; font-size:11px; color:var(--text-faint); margin-right:3px; }
</style>
