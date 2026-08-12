<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useIdentity } from '../../stores/identity';
import { useGamePlan } from '../../stores/gamePlan';
import { useGameSessions } from '../../stores/gameSessions';
import GamePoster from '../../components/games/GamePoster.vue';
import GameRating from '../../components/games/GameRating.vue';
import GamePrice from '../../components/games/GamePrice.vue';
import GameContentBadge from '../../components/games/GameContentBadge.vue';
import Priority from '../../components/Priority.vue';
import GameAddModal from '../../components/games/GameAddModal.vue';
import GameEditModal from '../../components/games/GameEditModal.vue';

const router=useRouter(); const identity=useIdentity(); const plan=useGamePlan(); const sessions=useGameSessions();
const visible=computed(()=>plan.list.filter(item=>item.status==='pending'));
const addOpen=ref(false); const startOpen=ref(false); const startItem=ref<any>(null); const editOpen=ref(false); const editItem=ref<any>(null);
onMounted(()=>plan.load());
function start(item:any){ startItem.value=item; startOpen.value=true; }
function edit(item:any){ editItem.value=item; editOpen.value=true; }
async function started(){ await Promise.all([plan.load(),sessions.load()]); }
</script>

<template>
<main class="page game-plan-page"><router-link class="back-link" to="/games"><svg viewBox="0 0 24 24"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>返回游戏首页</router-link><div class="game-plan-hero"><span>QUEUE FOR TWO</span><h1>想和你一起玩</h1><p>这里保留还没开始的共同游戏；第一次共同游玩后会自动移入“正在玩”。</p></div><div class="section__head"><span class="section__hint">待玩 {{ visible.length }} 款</span><button class="btn btn--rose" @click="addOpen=true"><svg class="btn__ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>添加游戏</button></div><p v-if="plan.loading" class="plan-empty">加载中…</p><p v-else-if="!visible.length" class="plan-empty">还没有想一起玩的游戏。</p><div v-else class="game-plan-grid"><article v-for="item in visible" :key="item.id" class="game-plan-card"><div class="game-plan-card__visual"><GamePoster :url="item.work.cover_url" :fallback="item.work.header_url" :state="item.work.release_state" @click="router.push(`/games/work/${item.work_id}`)"/><span class="game-plan-card__state is-pending">待玩</span><button @click="edit(item)">✎</button></div><div class="game-plan-card__body"><h3 @click="router.push(`/games/work/${item.work_id}`)">{{ item.work.title }}</h3><GameContentBadge :work="item.work"/><div class="game-plan-card__row"><Priority :value="item.priority"/><span>{{ identity.userById(item.added_by)?.display_name }} 添加</span></div><GameRating :work="item.work" compact/><GamePrice :work="item.work"/><p v-if="item.note">{{ item.note }}</p><button class="btn btn--primary start-button" @click="start(item)"><svg class="btn__ic" viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z"/></svg>开始一起玩</button></div></article></div><GameAddModal v-model="addOpen" initial-target="couple_plan" lock-target @added="plan.load"/><GameAddModal v-model="startOpen" initial-target="couple_playing" :from-plan="startItem" @added="started"/><GameEditModal v-model="editOpen" type="plan" :record="editItem" @changed="plan.load"/></main>
</template>

<style scoped>
.game-plan-page{ padding-top:var(--s-8); }.game-plan-hero{ margin:var(--s-5) 0 var(--s-10); padding:var(--s-8); border-radius:var(--r-xl); background:radial-gradient(circle at 85% 20%,oklch(.58 .18 285 / .15),transparent 28%),linear-gradient(135deg,var(--game-tint),var(--surface)); border:1px solid var(--game-line); }.game-plan-hero span{ color:var(--game-accent); font-size:10px; font-weight:800; letter-spacing:.18em; }.game-plan-hero h1{ font-size:clamp(30px,5vw,44px); }.game-plan-hero p{ color:var(--text-dim); }.plan-empty{ padding:var(--s-12); text-align:center; color:var(--text-faint); }.game-plan-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); gap:var(--s-5); }.game-plan-card{ display:grid; grid-template-columns:130px 1fr; min-height:250px; overflow:hidden; border:1px solid var(--line-soft); border-radius:var(--r-lg); background:var(--surface); }.game-plan-card__visual{ position:relative; }.game-plan-card__visual :deep(.game-poster){ height:100%; border-radius:0; box-shadow:none; cursor:pointer; }.game-plan-card__visual>button{ position:absolute; z-index:3; right:8px; top:8px; width:30px; height:30px; color:var(--game-accent); border:1px solid var(--game-line); background:oklch(.16 .03 250 / .88); border-radius:50%; }.game-plan-card__state{ position:absolute; z-index:2; left:8px; bottom:8px; padding:3px 8px; border-radius:var(--r-pill); font-size:10px; font-weight:700; background:oklch(.16 .03 250 / .88); }.game-plan-card__state.is-pending{ color:var(--text-dim); }.game-plan-card__state.is-playing{ color:oklch(.85 .17 145); box-shadow:0 0 12px oklch(.7 .16 145 / .28); }.game-plan-card__body{ display:flex; flex-direction:column; align-items:flex-start; gap:9px; padding:var(--s-4); }.game-plan-card h3{ cursor:pointer; font-size:var(--fs-lg); line-height:1.25; }.game-plan-card__row{ display:flex; align-items:center; gap:8px; color:var(--text-faint); font-size:11px; }.game-plan-card__body>p{ color:var(--text-dim); font-size:12px; }.start-button{ margin-top:auto; width:100%; justify-content:center; }
.game-plan-card__visual :deep(.game-poster){ width:100%; min-width:0; aspect-ratio:auto; }
</style>
