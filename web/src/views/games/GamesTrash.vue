<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api/index';
import GamePoster from '../../components/games/GamePoster.vue';
import GameContentBadge from '../../components/games/GameContentBadge.vue';

const items=ref<any[]>([]); const loading=ref(false); const error=ref('');
const LABEL:any={mark:'个人玩过',session:'一起玩过',plan:'想和你一起玩'};
async function load(){ loading.value=true; try{items.value=(await api('/api/games/trash')).items||[];}finally{loading.value=false;} }
onMounted(load);
async function restore(item:any){ error.value=''; try{await api(`/api/games/trash/${item.id}/restore`,{method:'POST'}); await load();}catch(e){error.value=e.body?.error==='restore_conflict'?'目标列表中已经有这款游戏，无法重复恢复。':(e.body?.error||e.message);} }
async function remove(item:any){ if(!window.confirm('永久删除这条游戏记录快照？此操作无法恢复。'))return; await api(`/api/games/trash/${item.id}`,{method:'DELETE'}); await load(); }
</script>

<template>
  <main class="page game-trash"><router-link class="back-link" to="/settings"><svg viewBox="0 0 24 24"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>返回设置</router-link><div class="game-trash__hero"><span>GAME RECYCLE BIN</span><h1>游戏回收站</h1><p>这里只保存游戏记录快照，影视回收站仍保持完全独立。</p></div><p v-if="error" class="game-trash__error">{{ error }}</p><p v-if="loading" class="game-trash__state">加载中…</p><p v-else-if="!items.length" class="game-trash__state">游戏回收站是空的。</p><div v-else class="game-trash__list"><article v-for="item in items" :key="item.id" class="game-trash__item"><GamePoster :url="item.work?.cover_url" :fallback="item.work?.header_url" :state="item.work?.release_state"/><div class="game-trash__body"><span>{{ LABEL[item.entity_type] }}</span><h3>{{ item.work?.title }}</h3><GameContentBadge :work="item.work"/><small>{{ new Date(item.deleted_at).toLocaleString('zh-CN') }} 删除</small></div><div class="game-trash__actions"><button class="btn btn--primary" @click="restore(item)">恢复</button><button class="btn btn--ghost" @click="remove(item)">永久删除</button></div></article></div></main>
</template>

<style scoped>
.game-trash{ padding-top:var(--s-8); }.game-trash__hero{ margin:var(--s-5) 0 var(--s-8); padding:var(--s-8); border:1px solid var(--game-line); border-radius:var(--r-xl); background:linear-gradient(135deg,var(--game-tint),var(--surface)); }.game-trash__hero span{ color:var(--game-accent); font-size:10px; font-weight:800; letter-spacing:.16em; }.game-trash__hero h1{ font-size:clamp(30px,5vw,44px); }.game-trash__hero p,.game-trash__state{ color:var(--text-faint); }.game-trash__state{ text-align:center; padding:var(--s-12); }.game-trash__error{ color:var(--rose-bright); margin-bottom:var(--s-4); }.game-trash__list{ display:grid; gap:var(--s-3); }.game-trash__item{ display:grid; grid-template-columns:64px 1fr auto; gap:var(--s-4); align-items:center; padding:var(--s-3); border:1px solid var(--line-soft); border-radius:var(--r-lg); background:var(--surface); }.game-trash__body{ min-width:0; }.game-trash__body span{ color:var(--game-accent); font-size:10px; font-weight:700; }.game-trash__body small{ color:var(--text-faint); }.game-trash__actions{ display:flex; gap:8px; }.game-trash__actions .btn--ghost{ color:var(--rose-bright); }@media(max-width:560px){.game-trash__item{grid-template-columns:54px 1fr}.game-trash__actions{grid-column:1/-1}.game-trash__actions .btn{flex:1;justify-content:center}}
</style>
