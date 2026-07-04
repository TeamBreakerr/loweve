import { describe, it, expect } from 'vitest';
import { decodeWatched, encodeWatched, fmtWatched, fmtWatchedShort } from './watchedDate';

describe('decodeWatched', () => {
  it('null/0 → 无日期', () => {
    expect(decodeWatched(null)).toEqual({ year: null, month: 0, day: 0 });
    expect(decodeWatched(0)).toEqual({ year: null, month: 0, day: 0 });
  });
  it('完整/到月/到年', () => {
    expect(decodeWatched(20260602)).toEqual({ year: 2026, month: 6, day: 2 });
    expect(decodeWatched(20260600)).toEqual({ year: 2026, month: 6, day: 0 });
    expect(decodeWatched(20260000)).toEqual({ year: 2026, month: 0, day: 0 });
  });
});

describe('encodeWatched', () => {
  it('无年 → null', () => {
    expect(encodeWatched('', 6, 2)).toBeNull();
    expect(encodeWatched(null, 6, 2)).toBeNull();
  });
  it('月越界置 0，且月为 0 时日必为 0', () => {
    expect(encodeWatched(2026, 13, 5)).toBe(20260000);
    expect(encodeWatched(2026, 0, 5)).toBe(20260000);
  });
  it('日按当月天数夹紧', () => {
    expect(encodeWatched(2026, 2, 31)).toBe(20260228);   // 2026 非闰年
    expect(encodeWatched(2024, 2, 31)).toBe(20240229);   // 2024 闰年
  });
  it('正常编码', () => {
    expect(encodeWatched(2026, 6, 2)).toBe(20260602);
    expect(encodeWatched(2026, 6, 0)).toBe(20260600);
    expect(encodeWatched('2026', '06', '02')).toBe(20260602);
  });
  it('日夹紧对 30 天月同样生效（非 2 月）', () => {
    expect(encodeWatched(2026, 4, 31)).toBe(20260430);   // 4 月 30 天
    expect(encodeWatched(2026, 11, 31)).toBe(20261130);  // 11 月 30 天
  });
  it('encode → decode 往返一致', () => {
    for (const [y, mo, d, enc] of [
      [2026, 6, 2, 20260602],
      [2026, 6, 0, 20260600],
      [2026, 0, 0, 20260000],
    ] as const) {
      expect(encodeWatched(y, mo, d)).toBe(enc);
      expect(decodeWatched(enc)).toEqual({ year: y, month: mo, day: d });
    }
  });
});

describe('fmtWatched', () => {
  it('按精度输出，可带后缀', () => {
    expect(fmtWatched(20260602, ' 看完')).toBe('2026-06-02 看完');
    expect(fmtWatched(20260600)).toBe('2026-06');
    expect(fmtWatched(20260000)).toBe('2026');
    expect(fmtWatched(null)).toBe('');
  });
});

describe('fmtWatchedShort', () => {
  it('完整→MM-DD，到月→YYYY-MM，到年→YYYY', () => {
    expect(fmtWatchedShort(20260602)).toBe('06-02');
    expect(fmtWatchedShort(20260600)).toBe('2026-06');
    expect(fmtWatchedShort(20260000)).toBe('2026');
    expect(fmtWatchedShort(0)).toBe('');
  });
});
