// 自动保存：改动后停手一会儿就存，替代「保存」按钮。点评室、编辑记录弹窗共用。
// - 同一时刻只有一个保存在跑；跑的途中又改了，等它完再存一次
// - 离开页面 / 关弹窗前调 settle() 把没存的存掉
// - 切到后台立刻存；页面被关 / 刷新时用 beacon（fetch keepalive）把最后的改动送出去
// 调用方提供 snapshot()（当前要存的值，可 JSON 化）和 save(value)，并在字段变化时调 touch()。
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref } from 'vue';

export type AutosaveState = 'saved' | 'pending' | 'saving' | 'error';

export interface AutosaveOptions<T> {
  snapshot: () => T;
  save: (value: T) => Promise<unknown>;
  beacon?: (value: T) => void;
  delay?: number;
  describeError?: (e: any) => string | undefined;
}

// 页面卸载时也能发完的请求（不能 await，失败也无从处理）
export function keepaliveJson(url: string, method: string, body: unknown) {
  fetch(url, {
    method, keepalive: true, credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).catch(() => {});
}

export function useAutosave<T>(opts: AutosaveOptions<T>) {
  const delay = opts.delay ?? 1000;
  const state = ref<AutosaveState>('saved');
  const error = ref('');
  const lastSavedAt = ref<number | null>(null);
  const saveCount = ref(0);          // 这一轮（reset 之后）成功存了几次，弹窗关时决定要不要通知父页面刷新
  let baseline = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<boolean> | null = null;

  const key = () => JSON.stringify(opts.snapshot());
  const isDirty = () => key() !== baseline;
  const isBusy = () => !!running;

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }
  function schedule() {
    clearTimer();
    timer = setTimeout(() => { timer = null; flush(); }, delay);
  }

  // 以当前值为「已保存」：刚从服务端填好表单时调
  function reset() {
    clearTimer();
    baseline = key();
    state.value = 'saved';
    error.value = '';
    lastSavedAt.value = null;
    saveCount.value = 0;
  }

  function touch() {
    if (isDirty()) {
      state.value = 'pending';
      schedule();
    } else if (state.value === 'pending') {
      state.value = 'saved';
      clearTimer();
    }
  }

  async function run() {
    if (!isDirty()) {
      if (state.value !== 'error') state.value = 'saved';
      return true;
    }
    const value = opts.snapshot();
    const k = JSON.stringify(value);
    state.value = 'saving';
    error.value = '';
    try {
      await opts.save(value);
      baseline = k;
      saveCount.value++;
      lastSavedAt.value = Date.now();
      state.value = isDirty() ? 'pending' : 'saved';
      return true;
    } catch (e) {
      state.value = 'error';
      error.value = opts.describeError?.(e) || e?.body?.error || e?.message || '网络问题';
      return false;
    }
  }

  function flush(): Promise<boolean> {
    clearTimer();
    if (!running) {
      running = run().finally(() => {
        running = null;
        if (isDirty() && state.value !== 'error') schedule();
      });
    }
    return running;
  }

  // 离开前：把没存的（包括正在存的途中又改的）都存掉；返回是否全部存上
  async function settle() {
    let ok = true;
    for (let i = 0; i < 3 && ok && (isDirty() || running); i++) ok = await flush();
    return ok;
  }

  // 放弃没存的改动（如要删除这条记录）
  function cancel() {
    clearTimer();
    baseline = key();
    state.value = 'saved';
  }

  function onPageHide() { if (opts.beacon && isDirty()) opts.beacon(opts.snapshot()); }
  function onVisibility() { if (document.visibilityState === 'hidden' && isDirty()) flush(); }
  if (getCurrentInstance()) {   // 组件里才挂页面事件（单测里直接调用时不挂）
    onMounted(() => {
      window.addEventListener('pagehide', onPageHide);
      document.addEventListener('visibilitychange', onVisibility);
    });
    onBeforeUnmount(() => {
      clearTimer();
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  const label = computed(() => {
    if (state.value === 'saving') return '保存中…';
    if (state.value === 'pending') return '有改动，马上自动保存…';
    if (state.value === 'error') return `没保存上：${error.value}`;
    if (!lastSavedAt.value) return '改动会自动保存';
    const d = new Date(lastSavedAt.value);
    return `已自动保存 · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });

  return { state, error, label, lastSavedAt, saveCount, isDirty, isBusy, reset, touch, flush, settle, cancel };
}
