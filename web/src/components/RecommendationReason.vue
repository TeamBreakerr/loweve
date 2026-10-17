<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';

const props = defineProps<{ text: string; workTitle: string }>();
const container = ref<HTMLElement | null>(null);
const preview = ref<HTMLElement | null>(null);
const dialog = ref<HTMLDialogElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const truncated = ref(false);
let observer: ResizeObserver | undefined;
function measure() {
  const el = preview.value;
  // 与整块可用空间比较，而不是与预留展开按钮后的高度比较，避免按钮出现后无法消失。
  truncated.value = Boolean(el && container.value && el.scrollHeight > container.value.clientHeight + 1);
}
function open() { dialog.value?.showModal(); }
function close() { dialog.value?.close(); }
onMounted(() => {
  observer = new ResizeObserver(measure);
  if (preview.value) observer.observe(preview.value);
  if (container.value) observer.observe(container.value);
  measure();
});
watch(() => props.text, async () => { close(); await nextTick(); measure(); });
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div ref="container" class="recommendation-reason">
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
.recommendation-reason { min-height: 0; display: flex; flex-direction: column; gap: 4px; flex: 0 1 auto; }
.recommendation-reason__preview { margin: 0; min-height: 0; flex: 0 1 auto; overflow: hidden; line-height: 1.5; overflow-wrap: anywhere; }
.recommendation-reason__expand { align-self: flex-start; flex: none; border: 0; background: none; color: var(--game-accent, var(--rose)); font: inherit; font-size: 12px; padding: 2px 0; cursor: pointer; }
.recommendation-reason__expand:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.recommendation-reason__dialog { margin: auto; padding: 0; width: min(540px, calc(100vw - 32px)); max-height: 80dvh; border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--surface); color: var(--text); overflow: auto; }
.recommendation-reason__dialog::backdrop { background: rgb(0 0 0 / 65%); backdrop-filter: blur(4px); }
.recommendation-reason__content { padding: 24px; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
h3 { margin: 0; font-family: var(--font-serif); font-size: 22px; }
header button { border: 0; background: none; color: var(--text); font-size: 26px; cursor: pointer; padding: 0 6px; }
.recommendation-reason__content > p { margin: 0; line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-dim); }
</style>
