<script setup lang="ts">
import { useIdentity } from '../stores/identity';
const identity = useIdentity();
</script>

<template>
  <div class="proxy-banner" aria-live="polite">
    <div class="proxy-banner__inner">
      <span class="dot"></span>
      <span>你正在以 <strong>{{ identity.viewingName }}</strong> 的身份查看与维护数据，所有改动都会记到 ta 名下，注意别误操作哦。</span>
      <button class="proxy-banner__exit" @click="identity.exitProxy">返回我自己</button>
    </div>
  </div>
</template>

<style scoped>
/* 从 styles/loweve.css「顶栏」段搬入（T10 批 1，纯剪切，未改声明）。
   body.viewing-partner .proxy-banner{ display:block; } 留在 loweve.css
   （见该文件注释，DONE_WITH_CONCERNS），与下面的 display:none 配合生效。*/
.proxy-banner{
  display:none;
  background:var(--rose);
  border-bottom:1px solid var(--rose);
}
.proxy-banner__inner{
  max-width:var(--maxw); margin:0 auto;
  padding:var(--s-3) var(--s-5);
  display:flex; align-items:center; gap:var(--s-3);
  font-size:var(--fs-sm); color:oklch(0.18 0.02 30);
}
.proxy-banner .dot{ width:8px; height:8px; border-radius:50%; background:oklch(0.18 0.02 30); flex-shrink:0; }
.proxy-banner strong{ color:oklch(0.12 0.02 30); font-weight:700; }
.proxy-banner__exit{
  margin-left:auto; font-size:var(--fs-sm); color:oklch(0.18 0.02 30); font-weight:500;
  border:1px solid oklch(0.18 0.02 30 / 0.45); padding:4px 12px; border-radius:var(--r-pill);
  transition:background .2s;
}
.proxy-banner__exit:hover{ background:oklch(0.18 0.02 30 / 0.14); }
</style>
