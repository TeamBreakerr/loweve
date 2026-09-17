// 站内确认框：替代原生 window.confirm（系统样式与深色放映厅风格不搭）。
// 全局只挂一个 <ConfirmDialog>（App.vue），任何地方 `await confirm({...})` 拿到 true/false。
import { reactive, readonly } from 'vue';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;   // 默认「确定」
  cancelLabel?: string;    // 默认「取消」
  danger?: boolean;        // 不可撤销的操作：确认按钮换成警示色
}

const state = reactive({
  open: false,
  title: '',
  message: '',
  confirmLabel: '确定',
  cancelLabel: '取消',
  danger: false,
});
let resolver: ((ok: boolean) => void) | null = null;

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  // 前一个还没答就来了新的：把旧的按取消收掉，避免悬挂的 Promise
  resolver?.(false);
  Object.assign(state, {
    open: true,
    title: opts.title,
    message: opts.message ?? '',
    confirmLabel: opts.confirmLabel ?? '确定',
    cancelLabel: opts.cancelLabel ?? '取消',
    danger: Boolean(opts.danger),
  });
  return new Promise<boolean>((resolve) => { resolver = resolve; });
}

export function settleConfirm(ok: boolean) {
  state.open = false;
  const r = resolver; resolver = null;
  r?.(ok);
}

export const confirmState = readonly(state);
