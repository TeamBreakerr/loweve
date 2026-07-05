<script setup lang="ts">
// 1–10 评分选择器：一排可点数字，选中高亮影院金；再点已选中的数字 = 取消（设 null）
defineProps({
  modelValue: { type: [Number, null], default: null },
  label: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);
function pick(n: any) { emit('update:modelValue', n); }
function clear() { emit('update:modelValue', null); }
</script>

<template>
  <div class="score-pick">
    <span v-if="label" class="score-pick__label">{{ label }}</span>
    <div class="score-pick__row">
      <button
        v-for="n in 10" :key="n" type="button"
        class="score-pick__n"
        :class="{ 'is-active': modelValue === n }"
        @click="modelValue === n ? clear() : pick(n)"
      >{{ n }}</button>
    </div>
  </div>
</template>

<style scoped>
/* 评分选择器样式，从 styles/loweve.css「评分选择器」段搬入（T10 批 4，纯剪切，未改声明）。*/
.score-pick{ display:flex; flex-direction:column; gap:8px; }
.score-pick__label{ font-size:13px; color:var(--text-faint); }
.score-pick__row{ display:flex; flex-wrap:wrap; gap:6px; }
.score-pick__n{
  width:34px; height:34px; border-radius:var(--r-sm);
  border:1px solid var(--line-soft); background:var(--surface-2);
  color:var(--text-dim); font-family:var(--font-brand); font-style:italic;
  font-size:var(--fs-md); line-height:1; transition:all .15s var(--ease);
}
.score-pick__n:hover{ color:var(--text); border-color:var(--line); transform:translateY(-1px); }
.score-pick__n.is-active{ background:var(--gold); border-color:var(--gold); color:oklch(0.16 0.03 80); font-weight:700; }
</style>
