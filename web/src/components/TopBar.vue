<script setup lang="ts">
import { useIdentity } from '../stores/identity';
import { useRoute, useRouter } from 'vue-router';

const identity = useIdentity();
const route = useRoute();
const router = useRouter();

function pickWho(id: any) {
  // 顶栏切换的是"看谁的视角"（viewing）。切到对方时 ProxyBanner 高亮提示「正在代维护」。
  // 本机身份（me/cookie）在 设置→我是谁 里设定一次。
  identity.setViewing(id);
}
</script>

<template>
  <header class="topbar">
    <div class="topbar__inner">
      <router-link class="brand" to="/" aria-label="loweve 小放映厅">
        <span class="brand__mark">loweve</span>
        <span class="brand__sub">小放映厅</span>
      </router-link>
      <nav class="nav">
        <router-link class="nav__item" to="/" :class="{ 'is-active': route.path === '/' }">首页</router-link>
        <router-link class="nav__item" to="/me" :class="{ 'is-active': route.path === '/me' }">我的</router-link>
      </nav>
      <div class="topbar__spacer"></div>
      <router-link class="btn btn--icon btn--ghost" to="/settings" title="设置" aria-label="设置" style="margin-right:var(--s-2)">
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
