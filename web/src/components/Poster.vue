<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { imgProxy } from '../api/index';

const props = defineProps({
  color: { type: String, default: '' },
  kind:  { type: String, default: '' },
  url:   { type: String, default: '' },
});

const failed = ref(false);
const src = computed(() => imgProxy(props.url));   // 外链海报走本站代理+缓存
watch(() => props.url, () => { failed.value = false; });
</script>

<template>
  <div class="poster" :style="color ? { '--p1': color } : null">
    <span v-if="kind" class="poster__kind">{{ kind }}</span>
    <img v-if="src && !failed" :src="src" alt="" referrerpolicy="no-referrer" @error="failed = true" />
  </div>
</template>

<style scoped>
/* 从 styles/loweve.css「海报」段搬入（T10 批 5，纯剪切，未改声明）。*/
.poster__kind{
  position:absolute; top:7px; left:7px; z-index:1;
  font-size:10px; letter-spacing:.04em; padding:2px 7px;
  border-radius:var(--r-pill);
  background:oklch(0.16 0.02 30 / 0.78); color:oklch(0.96 0 0 / 0.95);
  border:1px solid oklch(1 0 0 / 0.22);
}
</style>
