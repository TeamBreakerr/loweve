<script setup>
// 看完日期：一个输入框，填多少算多少——2024 / 2024-06 / 2024-06-02 都行。
// v-model 是 YYYYMMDD 整数，月/日未知为 00；空 → null。下方实时回显识别到的精度。
import { ref, watch, computed } from 'vue';
import { fmtWatched, decodeWatched } from '../utils/watchedDate.js';

const props = defineProps({ modelValue: { type: Number, default: null } });
const emit = defineEmits(['update:modelValue']);

// 宽松解析：年 [分隔 月 [分隔 日]]，分隔符 - / . 或 年/月。月日越界则忽略/夹紧。
function parseWatched(str) {
  const m = String(str || '').trim().match(/^(\d{1,4})\s*[-/.年]?\s*(\d{1,2})?\s*[-/.月]?\s*(\d{1,2})?/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  if (!y) return null;
  let mo = m[2] != null ? parseInt(m[2], 10) : 0;
  if (!(mo >= 1 && mo <= 12)) mo = 0;
  let d = (mo && m[3] != null) ? parseInt(m[3], 10) : 0;
  if (mo && d) { const dim = new Date(y, mo, 0).getDate(); d = d < 1 ? 0 : Math.min(d, dim); }
  return y * 10000 + mo * 100 + d;
}

const text = ref('');
// 外部值变化（打开编辑）→ 回填文本；自身输入引起的变化不覆盖（避免边打边重排）
watch(() => props.modelValue, (n) => { if (parseWatched(text.value) !== n) text.value = fmtWatched(n); }, { immediate: true });
function onInput(e) { text.value = e.target.value; emit('update:modelValue', parseWatched(e.target.value)); }

const hint = computed(() => {
  const { year, month, day } = decodeWatched(props.modelValue);
  if (!year) return '';
  if (!month) return `记到 ${year} 年`;
  if (!day) return `记到 ${year} 年 ${month} 月`;
  return `${year} 年 ${month} 月 ${day} 日`;
});
</script>

<template>
  <div class="datepick">
    <input class="input" type="text" :value="text" @input="onInput"
           placeholder="如 2024 / 2024-06 / 2024-06-02（记多少填多少）" />
    <span v-if="hint" class="datepick__hint">{{ hint }}</span>
  </div>
</template>

<style scoped>
.datepick{ display:flex; flex-direction:column; gap:6px; }
.datepick__hint{ font-size:var(--fs-sm); color:var(--text-faint); }
</style>
