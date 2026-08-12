<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useIdentity } from '../../stores/identity';
import { useGameMarks } from '../../stores/gameMarks';
import GamePoster from '../../components/games/GamePoster.vue';
import GameRating from '../../components/games/GameRating.vue';
import GamePrice from '../../components/games/GamePrice.vue';
import GameContentBadge from '../../components/games/GameContentBadge.vue';
import GameAddModal from '../../components/games/GameAddModal.vue';
import GameEditModal from '../../components/games/GameEditModal.vue';

const router = useRouter();
const identity = useIdentity();
const marks = useGameMarks();
const addOpen = ref(false);
const editOpen = ref(false);
const editRecord = ref<any>(null);
onMounted(() => marks.load());
watch(() => identity.viewing, () => marks.load());
function edit(item: any) { editRecord.value = item; editOpen.value = true; }
</script>

<template>
  <main class="page game-subpage">
    <div class="game-subhero"><span>MY GAME LOG</span><h1>{{ identity.viewingName }} 的游戏记录</h1><p>只要实际体验过，就可以在这里留下评分和短评，不需要等到通关。</p></div>
    <div class="section__head"><span class="section__hint">玩过 {{ marks.list.length }} 款</span><button class="btn btn--rose" @click="addOpen=true"><svg class="btn__ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>添加游戏</button></div>
    <p v-if="marks.loading" class="game-page-state">加载中…</p><p v-else-if="!marks.list.length" class="game-page-state">还没有游戏记录。</p>
    <div v-else class="game-library-grid"><article v-for="item in marks.list" :key="item.id" class="game-library-card"><div class="game-library-card__poster"><GamePoster :url="item.work.cover_url" :fallback="item.work.header_url" :state="item.work.release_state" @click="router.push(`/games/work/${item.work_id}`)"/><button class="game-library-card__edit" @click="edit(item)">✎</button></div><h3 @click="router.push(`/games/work/${item.work_id}`)">{{ item.work.title }}</h3><div class="game-library-card__record"><GameContentBadge :work="item.work"/><span v-if="item.rating" class="game-my-score">我 {{ item.rating }}</span></div><div class="game-library-card__market"><GameRating :work="item.work" compact/><GamePrice :work="item.work"/></div></article></div>
    <GameAddModal v-model="addOpen" initial-target="played" @added="marks.load"/><GameEditModal v-model="editOpen" type="mark" :record="editRecord" @changed="marks.load"/>
  </main>
</template>

<style scoped>
.game-subpage{ padding-top:var(--s-8); }.game-subhero{ margin-bottom:var(--s-10); padding:var(--s-8); border-left:3px solid var(--game-accent); background:linear-gradient(90deg,var(--game-tint),transparent); }.game-subhero>span{ color:var(--game-accent); font-size:10px; font-weight:800; letter-spacing:.18em; }.game-subhero h1{ font-size:clamp(28px,5vw,44px); margin:4px 0; }.game-subhero p{ color:var(--text-dim); }.game-library-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); align-items:stretch; gap:var(--s-6) var(--s-5); }.game-library-card{ display:flex; height:100%; flex-direction:column; align-items:flex-start; gap:7px; min-width:0; }.game-library-card__poster{ width:100%; position:relative; }.game-library-card__poster :deep(.game-poster){ cursor:pointer; transition:transform .22s; }.game-library-card:hover :deep(.game-poster){ transform:translateY(-3px); }.game-library-card__edit{ position:absolute; top:8px; right:8px; z-index:3; width:31px; height:31px; border-radius:50%; color:var(--game-accent); border:1px solid var(--game-line); background:oklch(.16 .03 250 / .86); }.game-library-card h3{ cursor:pointer; line-height:1.3; }.game-library-card__record{ display:flex; min-height:24px; flex-wrap:wrap; align-items:center; gap:6px; }.game-library-card__market{ display:flex; min-height:68px; margin-top:auto; flex-direction:column; align-items:flex-start; gap:7px; }.game-my-score{ color:var(--gold); font-family:var(--font-brand); font-weight:700; font-style:italic; }.game-page-state{ text-align:center; padding:var(--s-12); color:var(--text-faint); }
</style>
