<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useGameSessions } from '../../stores/gameSessions';
import GamePoster from '../../components/games/GamePoster.vue';
import GameRating from '../../components/games/GameRating.vue';
import GameContentBadge from '../../components/games/GameContentBadge.vue';
import Dual from '../../components/Dual.vue';
import GameAddModal from '../../components/games/GameAddModal.vue';
import GameEditModal from '../../components/games/GameEditModal.vue';
import { fmtWatched } from '../../utils/watchedDate';

const router = useRouter(); const sessions = useGameSessions();
const props = defineProps({ mode: { type: String, default: 'completed' } });
const isPlaying = computed(() => props.mode === 'playing');
const items = computed(() => sessions.list.filter(item => isPlaying.value
  ? item.completed_at == null && item.plan_status !== 'dropped'
  : item.completed_at != null));
const pageTitle = computed(() => isPlaying.value ? '正在玩' : '一起玩过');
const pageKicker = computed(() => isPlaying.value ? 'NOW PLAYING TOGETHER' : 'COMPLETED TOGETHER');
const pageLead = computed(() => isPlaying.value
  ? '从第一次并肩进入游戏开始，直到你们记录通关日。'
  : '这里收录已经共同通关的游戏，时间统一显示通关日期。');
const addTarget = computed(() => isPlaying.value ? 'couple_playing' : 'couple_played');
const addOpen = ref(false); const editOpen = ref(false); const editRecord = ref<any>(null);
onMounted(() => sessions.load());
function edit(item: any){ editRecord.value=item; editOpen.value=true; }
</script>

<template>
  <main class="page game-subpage"><router-link class="back-link" to="/games"><svg viewBox="0 0 24 24"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>返回游戏首页</router-link><div class="game-subhero"><span>{{ pageKicker }}</span><h1>{{ pageTitle }}</h1><p>{{ pageLead }}</p></div><div class="section__head"><span class="section__hint">共 {{ items.length }} 款</span><button class="btn btn--rose" @click="addOpen=true"><svg class="btn__ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>添加记录</button></div><p v-if="sessions.loading" class="game-page-state">加载中…</p><p v-else-if="!items.length" class="game-page-state">{{ isPlaying ? '现在没有共同进行中的游戏。' : '还没有记录通关的共同游戏。' }}</p><div v-else class="together-grid"><article v-for="item in items" :key="item.id" class="together-card"><div class="together-card__visual"><GamePoster :url="item.work.cover_url" :fallback="item.work.header_url" :state="item.work.release_state" @click="router.push(`/games/work/${item.work_id}`)"/><span v-if="isPlaying && item.played_at" class="together-card__date">{{ fmtWatched(item.played_at) }} 开始</span><span v-else-if="item.completed_at" class="together-card__date">{{ fmtWatched(item.completed_at) }} 通关</span><button @click="edit(item)">✎</button></div><div class="together-card__body"><h3 @click="router.push(`/games/work/${item.work_id}`)">{{ item.work.title }}</h3><GameContentBadge :work="item.work"/><Dual :rating-a="item.rating_a ?? '–'" :rating-b="item.rating_b ?? '–'"/><GameRating :work="item.work"/></div></article></div><GameAddModal v-model="addOpen" :initial-target="addTarget" @added="sessions.load"/><GameEditModal v-model="editOpen" type="session" :record="editRecord" @changed="sessions.load"/></main>
</template>

<style scoped>
.game-subpage{ padding-top:var(--s-8); }.game-subhero{ margin:var(--s-5) 0 var(--s-10); padding:var(--s-8); border:1px solid var(--game-line); border-radius:var(--r-xl); background:linear-gradient(135deg,var(--game-tint),var(--surface)); }.game-subhero span{ color:var(--game-accent); font-size:10px; font-weight:800; letter-spacing:.16em; }.game-subhero h1{ font-size:clamp(30px,5vw,44px); }.game-subhero p,.game-page-state{ color:var(--text-faint); }.game-page-state{ text-align:center; padding:var(--s-12); }.together-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:var(--s-5); }.together-card{ display:grid; grid-template-columns:120px 1fr; min-height:210px; border:1px solid var(--line-soft); background:var(--surface); border-radius:var(--r-lg); overflow:hidden; }.together-card__visual{ position:relative; }.together-card__visual :deep(.game-poster){ height:100%; border-radius:0; box-shadow:none; cursor:pointer; }.together-card__visual>button{ position:absolute; z-index:3; right:8px; top:8px; width:30px; height:30px; color:var(--game-accent); border:1px solid var(--game-line); background:oklch(.16 .03 250 / .86); border-radius:50%; }.together-card__date{ position:absolute; z-index:2; bottom:8px; left:8px; padding:3px 7px; border-radius:var(--r-pill); background:oklch(.16 .03 250 / .88); color:var(--text-dim); font-size:10px; }.together-card__body{ display:flex; flex-direction:column; align-items:flex-start; justify-content:center; gap:var(--s-3); padding:var(--s-4); }.together-card h3{ cursor:pointer; line-height:1.3; font-size:var(--fs-lg); }
.together-card__visual :deep(.game-poster){ width:100%; min-width:0; aspect-ratio:auto; }
</style>
