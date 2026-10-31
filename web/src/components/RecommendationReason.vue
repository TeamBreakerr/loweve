<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';

const props = defineProps<{ text: string; workTitle: string }>();
const preview = ref<HTMLElement | null>(null);
const dialog = ref<HTMLDialogElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const truncated = ref(false);
let observer: ResizeObserver | undefined;
// 展开按钮绝对定位叠在正文底部，出现与否都不改变任何尺寸。按钮若占文档流，卡片高度
// 又随内容变化（如手机单列），会出现「放不下→出按钮→撑高放得下→收按钮→又放不下」
// 每帧来回切换，整页跟着抖。
function measure() {
  const el = preview.value;
  truncated.value = Boolean(el && el.scrollHeight > el.clientHeight + 1);
}
function open() { dialog.value?.showModal(); }
function close() { dialog.value?.close(); }
onMounted(() => {
  observer = new ResizeObserver(measure);
  if (preview.value) observer.observe(preview.value);
  measure();
});
watch(() => props.text, async () => { close(); await nextTick(); measure(); });
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div class="recommendation-reason" :class="{ 'is-truncated': truncated }">
    <p ref="preview" class="recommendation-reason__preview">{{ text }}</p>
    <button v-if="truncated" ref="trigger" type="button" class="recommendation-reason__expand" aria-haspopup="dialog" @click.stop="open">展开推荐语 ↗</button>
    <Teleport to="body">
      <dialog ref="dialog" class="recommendation-reason__dialog" :aria-label="`${workTitle}的完整推荐语`" @click="e => { if (e.target === dialog) close(); }" @close="trigger?.focus()">
        <div class="recommendation-reason__content">
          <header><h3>{{ workTitle }}</h3><button type="button" aria-label="关闭推荐语" @click="close">×</button></header>
          <p>{{ text }}</p>
        </div>
      </dialog>
    </Teleport>
  </div>
</template>

<style scoped>
.recommendation-reason { position: relative; min-height: 0; display: flex; flex-direction: column; flex: 0 1 auto; }
.recommendation-reason__preview { margin: 0; min-height: 0; flex: 0 1 auto; overflow: hidden; line-height: 1.5; overflow-wrap: anywhere; }
/* 截断时末尾约一行渐隐成透明，给叠在上面的展开按钮让出位置 */
.is-truncated .recommendation-reason__preview { -webkit-mask: linear-gradient(180deg, #000 calc(100% - 36px), transparent calc(100% - 20px)); mask: linear-gradient(180deg, #000 calc(100% - 36px), transparent calc(100% - 20px)); }
.recommendation-reason__expand { position: absolute; left: 0; bottom: 0; border: 0; background: none; color: var(--game-accent, var(--rose)); font: inherit; font-size: 12px; padding: 2px 0; cursor: pointer; }
.recommendation-reason__expand:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.recommendation-reason__dialog { margin: auto; padding: 0; width: min(540px, calc(100vw - 32px)); max-height: 80dvh; border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--surface); color: var(--text); overflow: auto; }
.recommendation-reason__dialog::backdrop { background: rgb(0 0 0 / 65%); backdrop-filter: blur(4px); }
.recommendation-reason__content { padding: 24px; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
h3 { margin: 0; font-family: var(--font-serif); font-size: 22px; }
header button { border: 0; background: none; color: var(--text); font-size: 26px; cursor: pointer; padding: 0 6px; }
.recommendation-reason__content > p { margin: 0; line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-dim); }
</style>
