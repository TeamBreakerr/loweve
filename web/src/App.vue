<script setup>
import { onMounted, watchEffect } from 'vue';
import { useIdentity } from './stores/identity.js';
import TopBar from './components/TopBar.vue';
import ProxyBanner from './components/ProxyBanner.vue';

const identity = useIdentity();
onMounted(() => identity.load());

// 把身份状态同步到 <body> 的 dataset/class，让全局 CSS 选择器生效
watchEffect(() => {
  const body = document.body;
  body.dataset.me = identity.meKey || '';
  body.dataset.viewing = identity.viewingKey || '';
  body.classList.toggle('viewing-partner', identity.isViewingPartner);
});
</script>

<template>
  <TopBar />
  <ProxyBanner />
  <router-view v-if="identity.loaded" />
  <footer v-if="identity.loaded">
    <div class="brand__mark">loweve</div>
    <p style="margin-top:8px">小放映厅 · 只属于 {{ identity.userById(1)?.display_name || 'A' }} &amp; {{ identity.userById(2)?.display_name || 'B' }} 的两个人</p>
  </footer>
</template>
