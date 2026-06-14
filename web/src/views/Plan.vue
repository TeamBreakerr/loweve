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

// 扁平清单：只显示还想看的（看过/弃了不展示），按优先级排序由后端给
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
      <p class="page-hero__lead">两个人共同的待看清单。按优先级排个序，挑一部当下都想看的，今晚就开始。点开海报进详情可调优先级或移除。</p>
    </div>

    <div class="section__head" style="margin-bottom:var(--s-6); justify-content:flex-end">
      <div class="section__actions">
        <button class="btn btn--rose" @click="addModalOpen = true">
          <svg class="btn__ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>添加
        </button>
      </div>
    </div>

    <p v-if="plan.loading" style="color:var(--text-faint);text-align:center;padding:var(--s-8)">加载中…</p>
    <p v-else-if="!visible.length" style="color:var(--text-faint);text-align:center;padding:var(--s-12) 0">
      想看清单还是空的。
    </p>

    <div v-else class="grid grid--plan">
      <article v-for="p in visible" :key="p.id" class="plan-card">
        <Poster :color="'#2a2a30'" :url="p.work?.primary_poster_url" :kind="p.work?.is_anime ? '番剧' : ''"
                style="cursor:pointer" @click="p.work_id && router.push(`/work/${p.work_id}`)" />
        <div class="plan-card__body">
          <div class="plan-card__head">
            <h3 class="plan-card__title" style="cursor:pointer" @click="p.work_id && router.push(`/work/${p.work_id}`)">{{ p.work?.title }} <span class="year">{{ p.work?.year }}</span></h3>
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
