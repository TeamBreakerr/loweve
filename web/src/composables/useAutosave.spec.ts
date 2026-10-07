import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAutosave } from './useAutosave';

// 被保存的「表单」：一个可变对象，snapshot 取它的当前值
function setup(save: (v: any) => Promise<unknown>) {
  const data = { text: '原文' };
  const a = useAutosave({ snapshot: () => ({ ...data }), save, delay: 1000 });
  a.reset();
  const edit = (text: string) => { data.text = text; a.touch(); };
  return { a, edit, data };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useAutosave', () => {
  it('停手一段时间才存，连续改只存最后一次', async () => {
    const save = vi.fn(async () => {});
    const { a, edit } = setup(save);
    edit('一'); edit('一二'); edit('一二三');
    expect(a.state.value).toBe('pending');
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ text: '一二三' });
    expect(a.state.value).toBe('saved');
    expect(a.saveCount.value).toBe(1);
    expect(a.label.value).toMatch(/^已自动保存 · \d\d:\d\d$/);
  });

  it('改回原样就不存', async () => {
    const save = vi.fn(async () => {});
    const { a, edit } = setup(save);
    edit('改了'); edit('原文');
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
    expect(a.state.value).toBe('saved');
  });

  it('保存途中又改了：等它完再存一次新的', async () => {
    let finish!: () => void;
    const save = vi.fn((_v: any) => new Promise<void>(r => { finish = r; }));
    const { a, edit } = setup(save);
    edit('第一版');
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.state.value).toBe('saving');
    edit('第二版');
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.state.value).toBe('pending');
    await vi.advanceTimersByTimeAsync(1000);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(save.mock.calls.map(c => c[0].text)).toEqual(['第一版', '第二版']);
    expect(a.state.value).toBe('saved');
  });

  it('存失败显示原因、不自动重试；再改一下或点重试会再存', async () => {
    const save = vi.fn().mockRejectedValueOnce(Object.assign(new Error('x'), { body: { error: 'invalid_rating' } })).mockResolvedValue(undefined);
    const { a, edit } = setup(save);
    edit('坏的');
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.state.value).toBe('error');
    expect(a.label.value).toBe('没保存上：invalid_rating');
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(await a.flush()).toBe(true);
    expect(a.state.value).toBe('saved');
  });

  it('settle 立即存掉没存的；cancel 放弃；reset 以当前为已保存', async () => {
    const save = vi.fn(async () => {});
    const { a, edit } = setup(save);
    edit('马上要走');
    expect(await a.settle()).toBe(true);
    expect(save).toHaveBeenCalledWith({ text: '马上要走' });

    edit('要删了');
    a.cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(a.isDirty()).toBe(false);

    edit('服务端新值'); a.reset();
    expect(a.isDirty()).toBe(false);
    expect(a.saveCount.value).toBe(0);
  });

  it('settle 存不上返回 false', async () => {
    const { a, edit } = setup(async () => { throw new Error('offline'); });
    edit('x');
    expect(await a.settle()).toBe(false);
    expect(a.error.value).toBe('offline');
  });
});
