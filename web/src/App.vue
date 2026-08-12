<script setup lang="ts">
import { onMounted, watch, watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import { useIdentity } from './stores/identity';
import { useSpace } from './stores/space';
import TopBar from './components/TopBar.vue';
import ProxyBanner from './components/ProxyBanner.vue';

const identity = useIdentity();
const route = useRoute();
const space = useSpace();
onMounted(() => identity.load());
watch(() => route.meta.space, value => {
  if (value === 'games' || value === 'media') space.set(value);
}, { immediate: true });

// 把身份状态同步到 <body> 的 dataset/class，让全局 CSS 选择器生效
watchEffect(() => {
  const body = document.body;
  body.dataset.me = identity.meKey || '';
  body.dataset.viewing = identity.viewingKey || '';
  body.classList.toggle('viewing-partner', identity.isViewingPartner);
  body.classList.toggle('game-mode', space.isGames);
});
</script>

<template>
  <!-- 优先级双色爱心的共享渐变：左 = 用户A 色，右 = 用户B 色，供 Priority.vue 引用 -->
  <svg class="prio-gradient-svg" width="0" height="0" aria-hidden="true">
    <defs>
      <linearGradient id="prio-dual" x1="0" y1="0" x2="1" y2="0">
        <stop class="prio-gradient-svg__stop-a" offset="50%" />
        <stop class="prio-gradient-svg__stop-b" offset="50%" />
      </linearGradient>
    </defs>
  </svg>
  <TopBar />
  <ProxyBanner />
  <router-view v-if="identity.loaded" />
  <footer v-if="identity.loaded">
    <div class="brand__mark">loweve</div>
    <p class="footer__tagline">{{ space.isGames ? '双人游戏舱' : '小放映厅' }} · 只属于 {{ identity.userById(1)?.display_name || 'A' }} &amp; {{ identity.userById(2)?.display_name || 'B' }} 的两个人</p>
  </footer>
</template>

<style scoped>
/* 从 loweve.css 迁入（T10 批 6 完工检查项）。footer .brand__mark 特异性 (0,1,1) 恒胜
   残余文件里的 .brand__mark 基类与 mobile override，层叠关系与迁移前一致。 */
footer{ text-align:center; padding:var(--s-12) var(--s-5) var(--s-16); color:var(--text-faint); font-size:var(--fs-sm); }
footer .brand__mark{ font-size:20px; }

/* T12 批 4：内联样式收编。以下选择器均为本文件独有元素/类名，无跨文件同名规则，
   scoped attr 选择器即可命中，无特异性冲突。 */
.prio-gradient-svg{ position:absolute; }
.prio-gradient-svg__stop-a{ stop-color:var(--user-a); }
.prio-gradient-svg__stop-b{ stop-color:var(--user-b); }
.footer__tagline{ margin-top:8px; }
</style>
