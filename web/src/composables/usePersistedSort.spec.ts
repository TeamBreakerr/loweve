import { describe, it, expect, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { usePersistedSort } from './usePersistedSort';

// vitest 跑在 node 环境，没有 localStorage；用最小内存实现顶上
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  };
});

describe('usePersistedSort', () => {
  it('无记录时默认 recent', () => {
    expect(usePersistedSort('k').value).toBe('recent');
  });
  it('切换后写入 localStorage，再次创建时读回', async () => {
    const mode = usePersistedSort('k');
    mode.value = 'rating';
    await nextTick();
    expect(store.get('k')).toBe('rating');
    expect(usePersistedSort('k').value).toBe('rating');
  });
  it('非法值回落 recent', () => {
    store.set('k', 'bogus');
    expect(usePersistedSort('k').value).toBe('recent');
  });
  it('localStorage 不可用时不抛错、按默认', () => {
    (globalThis as any).localStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const mode = usePersistedSort('k');
    expect(mode.value).toBe('recent');
    expect(() => { mode.value = 'rating'; }).not.toThrow();
  });
});
