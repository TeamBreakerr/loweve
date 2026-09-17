<script setup lang="ts">
// 站内确认框（全局单例，App.vue 挂载）。视觉沿用 .modal 体系：同一遮罩、圆角、描边、pop 动画，
// 叠在编辑弹窗之上（z-index 高于 .modal-overlay 的 80）。Esc = 取消，Enter = 确定；
// 默认焦点落在「取消」上，误按不至于删东西。
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { confirmState, settleConfirm } from '../composables/useConfirm';

const cancelBtn = ref<HTMLButtonElement | null>(null);
watch(() => confirmState.open, (open) => { if (open) nextTick(() => cancelBtn.value?.focus()); });

function onKey(e: KeyboardEvent) {
  if (!confirmState.open) return;
  if (e.key === 'Escape') { e.preventDefault(); settleConfirm(false); }
  else if (e.key === 'Enter') { e.preventDefault(); settleConfirm(true); }
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div v-if="confirmState.open" class="modal-overlay is-open confirm-overlay" @pointerdown.self="settleConfirm(false)">
    <div class="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <div class="confirm__icon" :class="{ 'confirm__icon--danger': confirmState.danger }" aria-hidden="true">
        <svg v-if="confirmState.danger" viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
        <svg v-else viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>
      </div>
      <h3 id="confirm-title" class="confirm__title">{{ confirmState.title }}</h3>
      <p v-if="confirmState.message" class="confirm__msg">{{ confirmState.message }}</p>
      <div class="confirm__actions">
        <button ref="cancelBtn" class="btn btn--ghost confirm__cancel" @click="settleConfirm(false)">{{ confirmState.cancelLabel }}</button>
        <button class="btn confirm__ok" :class="confirmState.danger ? 'confirm__ok--danger' : 'btn--primary'" @click="settleConfirm(true)">{{ confirmState.confirmLabel }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-overlay{ z-index:90; }
.confirm{ max-width:380px; padding:var(--s-6) var(--s-6) var(--s-5); text-align:center; }
.confirm__icon{
  width:44px; height:44px; margin:0 auto var(--s-4); border-radius:50%;
  display:grid; place-items:center;
  color:var(--rose); background:var(--rose-tint); border:1px solid var(--rose-line);
}
.confirm__icon svg{ width:22px; height:22px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
.confirm__icon--danger{ color:var(--rose-bright); }
.confirm__title{ font-family:var(--font-serif); font-weight:600; font-size:var(--fs-lg); color:var(--text); line-height:1.35; }
.confirm__msg{ margin-top:var(--s-2); font-size:var(--fs-sm); color:var(--text-dim); line-height:1.6; }
.confirm__actions{ display:flex; gap:var(--s-3); margin-top:var(--s-5); }
.confirm__actions .btn{ flex:1; justify-content:center; padding:11px 16px; }
.confirm__cancel:focus-visible{ outline:2px solid var(--rose-line); outline-offset:2px; }
/* 不可撤销：确认键描边+文字用警示色，底色不铺满，避免和「保存」类主按钮混淆 */
.confirm__ok--danger{ color:var(--rose-bright); border-color:var(--rose); background:var(--rose-tint); font-weight:600; }
.confirm__ok--danger:hover{ background:var(--rose); color:oklch(0.16 0.02 30); border-color:var(--rose); }
</style>
