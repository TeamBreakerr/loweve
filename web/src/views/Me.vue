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

    <div class="section__head section__head--me-actions">
      <span class="section__hint">看过 {{ marks.watched.length }} 部</span>
      <div class="section__actions">
        <button class="btn btn--rose" @click="openAdd">
          <svg class="btn__ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>添加
        </button>
      </div>
    </div>

    <p v-if="marks.loading" class="me-state-note me-state-note--loading">加载中…</p>

    <section v-else class="tabpane is-active">
      <p v-if="!marks.watched.length" class="me-state-note me-state-note--empty">
        还没记录过看过的作品。点右上「添加」开始 →
      </p>
      <div v-else class="grid grid--me">
        <article v-for="m in marks.watched" :key="m.id" class="title-card">
          <div class="title-card__pw">
            <router-link class="title-card__poster-link" :to="`/work/${m.work_id}`" :aria-label="`查看《${m.work.title}》详情`">
              <Poster :color="'#2a2a30'" :url="m.work.primary_poster_url" :kind="m.work.is_anime ? '番剧' : ''" />
            </router-link>
            <button class="card-edit" data-tip="编辑" data-tip-pos="below" @click="openEdit(m)">
              <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
          </div>
          <router-link class="title-card__name" :to="`/work/${m.work_id}`">{{ m.work.title }} <span class="year">{{ m.work.year }}</span></router-link>
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
.title-card__poster-link{ display:block; border-radius:var(--r-md); }
.title-card__poster-link:focus-visible, .title-card__name:focus-visible{ outline:2px solid var(--rose-bright); outline-offset:3px; }
.title-card__name{ display:block; color:inherit; font-family:var(--font-serif); font-weight:600; font-size:var(--fs-body); line-height:1.3; text-decoration:none; }
.title-card__name .year{ color:var(--text-faint); font-weight:400; font-family:var(--font-sans); font-size:var(--fs-sm); }
.title-card__row{ display:flex; align-items:center; gap:var(--s-2); flex-wrap:wrap; }
.mini-score{ font-family:var(--font-brand); font-style:italic; font-weight:600; color:var(--gold); font-size:var(--fs-md); }
.mini-score .lab{ font-family:var(--font-sans); font-style:normal; font-size:11px; color:var(--text-faint); margin-right:3px; }

/* ============================================================ 内联样式收编（T12 批 4）
   .section__head 是跨文件共用类（primitives.css，Home/Work/Me/Together/Plan 等共用，见
   Plan.vue 同类注释），按规则不并入基类，改用本文件专属修饰类 .section__head--me-actions，
   覆盖基类 margin-bottom:var(--s-5) 为 var(--s-6)。经 Vue scoped 编译后为 (0,2,0)，稳赢
   primitives.css 的 (0,1,0)；primitives.css 里另有 max-width:680px 下的
   .section__head{flex-wrap:wrap} 覆写，不涉及 margin-bottom，无交集。
   .me-state-note 合并两处原内联共有的 color:var(--text-faint);text-align:center；
   padding 值不同（var(--s-8) vs var(--s-12) 0），拆成 --loading/--empty 两个修饰类，
   手法同 Plan.vue 的 .plan-state-note。*/
.section__head--me-actions{ margin-bottom:var(--s-6); }
.me-state-note{ color:var(--text-faint); text-align:center; }
.me-state-note--loading{ padding:var(--s-8); }
.me-state-note--empty{ padding:var(--s-12) 0; }
</style>
