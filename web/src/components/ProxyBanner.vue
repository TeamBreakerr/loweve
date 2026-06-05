<script setup>
import { useIdentity } from '../stores/identity.js';
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
