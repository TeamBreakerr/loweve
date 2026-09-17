// 列表排序方式的本地持久化：刷新/重开页面后仍保持上次选的排序。
// 纯个人偏好，只存浏览器 localStorage（与 stores/space.ts 的 loweve-space 同一手法），不上服务端。
import { ref, watch } from 'vue';

export type SortMode = 'recent' | 'rating';
const MODES: SortMode[] = ['recent', 'rating'];

function readMode(key: string): SortMode {
  try {
    const saved = localStorage.getItem(key);
    return MODES.includes(saved as SortMode) ? (saved as SortMode) : 'recent';
  } catch { return 'recent'; }   // 隐私模式 / 禁用存储时按默认
}

export function usePersistedSort(key: string) {
  const sortMode = ref<SortMode>(readMode(key));
  watch(sortMode, (mode) => {
    try { localStorage.setItem(key, mode); } catch { /* 存不了就只在本次会话生效 */ }
  });
  return sortMode;
}
