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
