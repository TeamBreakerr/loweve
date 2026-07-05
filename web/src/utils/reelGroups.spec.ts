import { describe, it, expect } from 'vitest';
import { buildYears, buildGroups } from './reelGroups';
import type { Session } from '../types';

const s = (id: number, watched_at: number | null, poster = ''): Session =>
  ({ id, work_id: id, watched_at, work: { primary_poster_url: poster } }) as unknown as Session;

describe('buildYears', () => {
  it('按年降序、年内按月降序分组；无效月归 0「年内」', () => {
    const years = buildYears([s(1, 20250102), s(2, 20261100), s(3, 20260300), s(4, 20261390)]);
    expect(years.map(y => y.year)).toEqual([2026, 2025]);
    expect(years[0].months.map(m => m.m)).toEqual([11, 3, 0]);
    expect(years[0].months[2].mLabel).toBe('年内');
    expect(years[0].months[0].gid).toBe('g-2026-11');
  });
  it('无日期的排最后为「未知」组', () => {
    const years = buildYears([s(1, null), s(2, 20260100)]);
    expect(years.at(-1)!.year).toBe(0);
    expect(years.at(-1)!.months[0].mLabel).toBe('未知');
  });
  it('空输入 → 空数组', () => {
    expect(buildYears([])).toEqual([]);
  });
});

describe('buildGroups', () => {
  it('扁平化并取每组第一部的海报', () => {
    const cells = buildGroups(buildYears([s(1, 20260302, 'p1.jpg'), s(2, 20260301, 'p2.jpg')]), x => x?.work?.primary_poster_url || '');
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ y: 2026, m: 3, yLabel: '2026', mLabel: '3月', poster: 'p1.jpg' });
  });
  it('未知年份的 yLabel 是「·」', () => {
    const cells = buildGroups(buildYears([s(1, null)]), () => '');
    expect(cells[0].yLabel).toBe('·');
  });
});
