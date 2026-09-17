import { describe, it, expect } from 'vitest';
import { sortByRating } from './sortByRating';

const site = (item: { site?: number | null }) => item.site;

describe('sortByRating', () => {
  it('自己打过分的整体排在未打分的前面，即使站点分更高', () => {
    const list = [
      { id: 1, rating: null, site: 9.4 },   // 黑镜：只有豆瓣 9.4
      { id: 2, rating: 9, site: 8.0 },
      { id: 3, rating: 10, site: 8.5 },
    ];
    expect(sortByRating(list, site).map(i => i.id)).toEqual([3, 2, 1]);
  });
  it('打过分的按我的分降序，未打分的按站点分降序', () => {
    const list = [
      { id: 1, rating: null, site: 9.1 },
      { id: 2, rating: 9, site: 7.2 },
      { id: 3, rating: null, site: 9.4 },
      { id: 4, rating: 10, site: 8.1 },
      { id: 5, rating: null, site: null },   // 两边都没分，垫底
    ];
    expect(sortByRating(list, site).map(i => i.id)).toEqual([4, 2, 3, 1, 5]);
  });
  it('同分按添加顺序倒序（id 大的在前），且不改动原数组', () => {
    const list = [{ id: 1, rating: 9, site: 8 }, { id: 2, rating: 9, site: 8 }];
    const out = sortByRating(list, site);
    expect(out.map(i => i.id)).toEqual([2, 1]);
    expect(list.map(i => i.id)).toEqual([1, 2]);
  });
});
