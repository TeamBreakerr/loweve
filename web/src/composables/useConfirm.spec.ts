import { describe, it, expect } from 'vitest';
import { confirm, settleConfirm, confirmState } from './useConfirm';

describe('useConfirm', () => {
  it('confirm 打开并回填文案，settle 后关闭并 resolve', async () => {
    const p = confirm({ title: '确定移入回收站？', message: '之后可恢复', confirmLabel: '移入回收站' });
    expect(confirmState.open).toBe(true);
    expect(confirmState.title).toBe('确定移入回收站？');
    expect(confirmState.confirmLabel).toBe('移入回收站');
    expect(confirmState.cancelLabel).toBe('取消');
    expect(confirmState.danger).toBe(false);
    settleConfirm(true);
    expect(confirmState.open).toBe(false);
    await expect(p).resolves.toBe(true);
  });
  it('取消 resolve false；danger 透传', async () => {
    const p = confirm({ title: '永久删除？', danger: true });
    expect(confirmState.danger).toBe(true);
    settleConfirm(false);
    await expect(p).resolves.toBe(false);
  });
  it('未答复时再次 confirm：旧的按取消收掉', async () => {
    const first = confirm({ title: 'A' });
    const second = confirm({ title: 'B' });
    await expect(first).resolves.toBe(false);
    expect(confirmState.title).toBe('B');
    settleConfirm(true);
    await expect(second).resolves.toBe(true);
  });
});
