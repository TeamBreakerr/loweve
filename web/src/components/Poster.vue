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
