<script setup lang="ts">
import { useIdentity } from '../stores/identity';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSpace } from '../stores/space';

const identity = useIdentity();
const route = useRoute();
const router = useRouter();
const space = useSpace();
const homePath = computed(() => space.isGames ? '/games' : '/');
const mePath = computed(() => space.isGames ? '/games/me' : '/me');

function switchSpace(next: 'media' | 'games') {
  space.set(next);
  router.push(next === 'games' ? '/games' : '/');
}

function pickWho(id: any) {
  // 顶栏切换的是"看谁的视角"（viewing）。切到对方时 ProxyBanner 高亮提示「正在代维护」。
  // 本机身份（me/cookie）在 设置→我是谁 里设定一次。
  identity.setViewing(id);
}
</script>

<template>
  <header class="topbar">
    <div class="topbar__inner">
      <router-link class="brand" :to="homePath" :aria-label="`loweve ${space.isGames ? '双人游戏舱' : '小放映厅'}`">
        <span class="brand__mark">loweve</span>
        <span class="brand__sub">{{ space.isGames ? '双人游戏舱' : '小放映厅' }}</span>
      </router-link>
      <div class="mode-switch" role="group" aria-label="切换影视或游戏空间">
        <button class="mode-switch__item" :class="{ 'is-active': !space.isGames }" @click="switchSpace('media')">
          <svg viewBox="0 0 24 24"><path d="M4 7h16v12H4zM8 3l3 4M16 3l-3 4"/></svg><span>影视</span>
        </button>
        <button class="mode-switch__item" :class="{ 'is-active': space.isGames }" @click="switchSpace('games')">
          <svg viewBox="0 0 24 24"><path d="M8 8h8a5 5 0 0 1 4.7 6.7l-1 2.8a2 2 0 0 1-3.3.8L14 16h-4l-2.4 2.3a2 2 0 0 1-3.3-.8l-1-2.8A5 5 0 0 1 8 8Z"/><path d="M7 12v4M5 14h4M16.5 13.5h.01M18.5 15.5h.01"/></svg><span>游戏</span>
        </button>
      </div>
      <nav class="nav">
        <router-link class="nav__item" :to="homePath" :class="{ 'is-active': route.meta.page === 'home' }">首页</router-link>
        <router-link class="nav__item" :to="mePath" :class="{ 'is-active': route.meta.page === 'me' }">我的</router-link>
      </nav>
      <div class="topbar__spacer"></div>
      <router-link class="btn btn--icon btn--ghost btn--topbar-settings" to="/settings" data-tip="设置" data-tip-pos="below" aria-label="设置">
        <svg class="btn__ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/></svg>
      </router-link>
      <div class="switcher" role="group" aria-label="切换身份">
        <span class="switcher__label">我是</span>
        <button
          v-for="u in identity.users"
          :key="u.id"
          class="who"
          :class="{ 'is-active': identity.viewing === u.id }"
          :data-who="identity.whoKey(u.id)"
          @click="pickWho(u.id)"
        >
          <span class="who__avatar">{{ u.display_name?.[0] || '' }}</span>
          <span class="who__name">{{ u.display_name }}</span>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
/* 顶栏样式，从 styles/loweve.css「顶栏」段搬入（T10 批 1，纯剪切，未改声明）。
   .brand__mark 留在 loweve.css（primitives，3 文件共用，见该文件注释）；
   body.viewing-partner 的暖色高亮规则同样留在 loweve.css（见该文件注释，DONE_WITH_CONCERNS）。*/
.topbar{
  position:sticky; top:0; z-index:40;
  background:oklch(0.18 0.009 45 / 0.82);
  backdrop-filter:blur(16px) saturate(1.2);
  -webkit-backdrop-filter:blur(16px) saturate(1.2);
  border-bottom:1px solid var(--line-soft);
  transition:background .35s var(--ease), border-color .35s var(--ease);
}
.topbar__inner{
  max-width:var(--maxw); margin:0 auto;
  padding:var(--s-3) var(--s-5);
  display:flex; align-items:center; gap:var(--s-5);
}
.brand{ display:flex; align-items:baseline; gap:var(--s-3); flex-shrink:0; }
.brand__sub{
  font-family:var(--font-serif); font-weight:500;
  font-size:var(--fs-sm); color:var(--text-dim);
  letter-spacing:.18em; padding-left:var(--s-3);
  border-left:1px solid var(--line);
}
.nav{ display:flex; gap:var(--s-1); margin-left:var(--s-4); }
.nav__item{
  font-size:var(--fs-sm); color:var(--text-dim);
  padding:var(--s-2) var(--s-3); border-radius:var(--r-pill);
  transition:color .2s, background .2s;
}
.nav__item:hover{ color:var(--text); }
.nav__item.is-active{ color:var(--text); background:var(--surface-2); }

.mode-switch{
  display:flex; align-items:center; padding:3px; gap:2px;
  background:var(--surface-2); border:1px solid var(--line-soft); border-radius:var(--r-pill);
}
.mode-switch__item{
  display:flex; align-items:center; gap:5px; padding:5px 10px; border-radius:var(--r-pill);
  color:var(--text-faint); font-size:12px; transition:all .2s var(--ease);
}
.mode-switch__item svg{ width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:1.8; }
.mode-switch__item.is-active{ color:var(--text); background:var(--surface-3); box-shadow:var(--shadow-sm); }
:global(body.game-mode) .mode-switch__item.is-active{ color:var(--game-accent); box-shadow:inset 0 0 0 1px var(--game-line); }

.topbar__spacer{ flex:1; }

/* 身份切换器 */
.switcher{
  display:flex; align-items:center; gap:var(--s-2);
  background:var(--surface-2); padding:4px;
  border-radius:var(--r-pill); border:1px solid var(--line-soft);
}
.switcher__label{
  font-size:11px; color:var(--text-faint);
  padding-left:var(--s-2); letter-spacing:.05em;
}
.who{
  display:flex; align-items:center; gap:var(--s-2);
  padding:5px 13px 5px 5px; border-radius:var(--r-pill);
  font-size:var(--fs-sm); color:var(--text-dim);
  transition:all .22s var(--ease);
}
.who__avatar{
  width:24px; height:24px; border-radius:50%;
  display:grid; place-items:center;
  font-size:11px; font-weight:700; color:var(--bg);
  font-family:var(--font-brand); font-style:italic;
}
.who[data-who="a"] .who__avatar{ background:var(--user-a); }
.who[data-who="b"] .who__avatar{ background:var(--user-b); }
.who.is-active{ color:var(--text); background:var(--surface-3); box-shadow:var(--shadow-sm); }
.who.is-active[data-who="a"]{ box-shadow:inset 0 0 0 1.5px var(--user-a); }
.who.is-active[data-who="b"]{ box-shadow:inset 0 0 0 1.5px var(--user-b); }

@media (max-width:860px){
  .brand__sub{ display:none; }
  .switcher__label{ display:none; }
  .nav{ margin-left:var(--s-2); }   /* 保留 首页/我的，仅缩边距 */
}
/* 手机：顶栏更紧凑，身份切换器只显头像不显名字，保证 首页/我的/设置/切换 都点得到 */
@media (max-width:560px){
  .topbar__inner{ flex-wrap:wrap; gap:var(--s-2); padding:var(--s-3) var(--s-4) var(--s-2); }
  .brand__mark{ font-size:24px; }
  .topbar__spacer{ display:none; }
  .nav{ order:20; flex:0 0 100%; justify-content:center; margin-left:0; padding-top:var(--s-1); border-top:1px solid var(--line-soft); }
  .nav__item{ padding:var(--s-2) var(--s-2); }
  .btn--topbar-settings{ margin-left:auto; margin-right:0; }
  .who__name{ display:none; }
  .who{ padding:4px; }
  .who__avatar{ width:22px; height:22px; }
  .switcher{ gap:2px; padding:3px; }
  .mode-switch__item{ padding:5px 7px; }
}
@media (max-width:680px){
  .topbar__inner{ padding:var(--s-3) var(--s-4); gap:var(--s-3); }
}

/* ============================================================ 内联样式收编（T12 批 4）
   .btn/.btn--icon/.btn--ghost 是跨文件共用类（primitives.css），基类均未设置
   margin-right，本文件专属修饰类 .btn--topbar-settings 新增该属性，与基类属性无交集，
   无需比特异性；scoped 编译后选择器为 (0,2,0)。*/
.btn--topbar-settings{ margin-right:var(--s-2); }
@media (max-width:560px){
  .topbar__inner{ gap:var(--s-2); padding:var(--s-3) var(--s-4) var(--s-2); }
  .btn--topbar-settings{ margin-left:auto; margin-right:0; }
}
</style>
