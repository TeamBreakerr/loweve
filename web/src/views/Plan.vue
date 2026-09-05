<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { usePlan } from '../stores/plan';
import { useIdentity } from '../stores/identity';
import Poster from '../components/Poster.vue';
import Rating from '../components/Rating.vue';
import Priority from '../components/Priority.vue';
import AddModal from '../components/AddModal.vue';
import { ratingHref } from '../api/index';

const router = useRouter();
const plan = usePlan();
const identity = useIdentity();

// 扁平清单：只显示还想看的（看过/弃了不展示），后端按添加时间从新到旧返回。
const visible = computed(() => plan.list.filter(p => p.status !== 'done' && p.status !== 'dropped'));
const addModalOpen = ref(false);

onMounted(() => plan.load());
</script>

<template>
  <main class="page">
    <router-link class="back-link" to="/">
      <svg viewBox="0 0 24 24"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>返回首页
    </router-link>
    <div class="page-hero">
      <span class="page-hero__kicker">Want to Watch</span>
      <h1 class="page-hero__title">想看就一起看</h1>
      <p class="page-hero__lead">两个人共同的待看清单，最近添加的排在前面。挑一部当下都想看的，今晚就开始。点开海报进详情可调优先级或移除。</p>
    </div>

    <div class="section__head section__head--plan-actions">
      <div class="section__actions">
        <button class="btn btn--rose" @click="addModalOpen = true">
          <svg class="btn__ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>添加
        </button>
      </div>
    </div>

    <p v-if="plan.loading" class="plan-state-note plan-state-note--loading">加载中…</p>
    <p v-else-if="!visible.length" class="plan-state-note plan-state-note--empty">
      想看清单还是空的。
    </p>

    <div v-else class="grid grid--plan">
      <article v-for="p in visible" :key="p.id" class="plan-card">
        <Poster :color="'#2a2a30'" :url="p.work?.primary_poster_url" :kind="p.work?.is_anime ? '番剧' : ''"
                class="plan-card__poster" @click="p.work_id && router.push(`/work/${p.work_id}`)" />
        <div class="plan-card__body">
          <div class="plan-card__head">
            <h3 class="plan-card__title" @click="p.work_id && router.push(`/work/${p.work_id}`)">{{ p.work?.title }} <span class="year">{{ p.work?.year }}</span></h3>
            <Priority :value="p.priority" />
          </div>
          <div class="plan-card__row">
            <Rating v-if="p.work" :source="p.work.rating_source" :score="p.work.primary_rating?.toFixed(1) || '—'" :href="ratingHref(p.work)" />
            <span class="adder" :data-who="identity.whoKey(p.added_by)">
              <span class="adder__dot">{{ identity.userById(p.added_by)?.display_name?.[0] || (p.added_by === 1 ? 'A' : 'B') }}</span>{{ identity.userById(p.added_by)?.display_name || '' }} 添加
            </span>
          </div>
        </div>
      </article>
    </div>

    <AddModal v-model="addModalOpen" initial-target="couple_plan" @added="plan.load" />
  </main>
</template>

<style scoped>
/* .grid--plan 样式，从 styles/loweve.css「卡片网格」段搬入（T10 批 4，响应式段清点顺手
   归位：批 1-3 未覆盖 Plan.vue 这块样式，本次借响应式清点补上，纯剪切未改声明，报
   DONE_WITH_CONCERNS）。*/
.grid--plan{ grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); }
@media (max-width:680px){
  .grid--plan{ grid-template-columns:1fr; }
}

/* .plan-card(+:hover)/__body/__head/__title(+.year)/__row 从 styles/loweve.css「一起想看 /
   计划卡片」段搬入（T10 批 5，纯剪切，未改声明）。.plan-card .poster 留在 loweve.css（跨
   组件选择器，.poster 属于子组件 components/Poster.vue，见该文件注释）。*/
.plan-card{
  display:flex; gap:var(--s-3); padding:var(--s-3);
  background:var(--surface);
  border-radius:var(--r-lg); box-shadow:var(--shadow-card);
  transition:transform .22s var(--ease);
}
.plan-card:hover{ transform:translateY(-3px); }
.plan-card__body{ flex:1; min-width:0; display:flex; flex-direction:column; gap:7px; }
.plan-card__head{ display:flex; align-items:flex-start; gap:var(--s-2); }
.plan-card__title{ font-family:var(--font-serif); font-weight:600; font-size:var(--fs-body); line-height:1.3; flex:1; cursor:pointer; }
.plan-card__title .year{ color:var(--text-faint); font-weight:400; font-family:var(--font-sans); font-size:var(--fs-sm); }
.plan-card__row{ display:flex; align-items:center; gap:var(--s-2); flex-wrap:wrap; font-size:var(--fs-sm); color:var(--text-faint); }

/* ============================================================ 内联样式收编（T12）
   以下均由原静态内联 style 属性收编而成，声明逐字节保持原值，零像素改动。
   .plan-card__title 的 cursor:pointer 直接并入既有本地规则（本文件专属类，未在别处
   出现，无需新起修饰类）。.plan-card__poster 落到 <Poster> 子组件根节点（单根组件，
   已验证同 Home.vue .hcard__poster 手法），loweve.css 里 .plan-card .poster{width:72px}
   与本类是不同属性（width vs cursor），无声明冲突，无需比特异性。
   .section__head 是跨文件共用类（primitives.css，Home/Work/Me/Together/Plan 等共用），
   按规则不并入基类，改用本文件专属修饰类 .section__head--plan-actions，覆盖基类
   margin-bottom:var(--s-5) 为 var(--s-6)、新增 justify-content:flex-end（基类未设）。
   经 Vue scoped 编译后为 (0,2,0)，稳赢 primitives.css 的 (0,1,0)；primitives.css 里
   另有 max-width:680px 下的 .section__head{flex-wrap:wrap} 覆写，不涉及 margin-bottom/
   justify-content 两个属性，无交集。
   .plan-state-note 合并两处原内联共有的 color:var(--text-faint);text-align:center；
   padding 值不同（var(--s-8) vs var(--s-12) 0），拆成 --loading/--empty 两个修饰类。*/
.section__head--plan-actions{ margin-bottom:var(--s-6); justify-content:flex-end; }
.plan-card__poster{ cursor:pointer; }
.plan-state-note{ color:var(--text-faint); text-align:center; }
.plan-state-note--loading{ padding:var(--s-8); }
.plan-state-note--empty{ padding:var(--s-12) 0; }
</style>
