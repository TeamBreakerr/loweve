<script setup lang="ts">
import { computed, ref, watch, type PropType } from 'vue';
import { imgProxy } from '../../api/index';

const props = defineProps({
  url: { type: String as PropType<string | null | undefined>, default: '' },
  fallback: { type: String as PropType<string | null | undefined>, default: '' },
  state: { type: String, default: 'released' },
});
const failedPrimary = ref(false);
const failedAll = ref(false);
const current = computed(() => imgProxy(failedPrimary.value ? props.fallback : props.url));
watch(() => [props.url, props.fallback], () => { failedPrimary.value = false; failedAll.value = false; });
function fail() {
  if (!failedPrimary.value && props.fallback) failedPrimary.value = true;
  else failedAll.value = true;
}
</script>

<template>
  <div class="game-poster">
    <span v-if="state !== 'released'" class="game-poster__state">{{ state === 'early_access' ? '抢先体验' : '未发售' }}</span>
    <img v-if="current && !failedAll" :src="current" alt="" referrerpolicy="no-referrer" @error="fail" />
    <div v-else class="game-poster__placeholder">
      <svg viewBox="0 0 24 24"><path d="M8 8h8a5 5 0 0 1 4.7 6.7l-1 2.8a2 2 0 0 1-3.3.8L14 16h-4l-2.4 2.3a2 2 0 0 1-3.3-.8l-1-2.8A5 5 0 0 1 8 8Z"/><path d="M7 12v4M5 14h4M16.5 13.5h.01M18.5 15.5h.01"/></svg>
    </div>
  </div>
</template>

<style scoped>
.game-poster{ position:relative; aspect-ratio:2/3; overflow:hidden; border-radius:var(--r-poster); background:linear-gradient(145deg,var(--surface-3),var(--surface)); box-shadow:var(--shadow-poster); }
.game-poster img{ width:100%; height:100%; object-fit:cover; }
.game-poster__state{ position:absolute; z-index:2; top:8px; left:8px; padding:3px 8px; border-radius:var(--r-pill); background:oklch(0.16 0.03 255 / .88); border:1px solid var(--game-line); color:var(--game-accent); font-size:10px; font-weight:700; }
.game-poster__placeholder{ width:100%; height:100%; display:grid; place-items:center; color:var(--game-accent); background:radial-gradient(circle at 50% 35%,var(--game-tint),transparent 55%); }
.game-poster__placeholder svg{ width:36%; fill:none; stroke:currentColor; stroke-width:1.2; opacity:.72; }
</style>
