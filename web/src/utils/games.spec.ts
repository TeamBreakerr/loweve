import { describe, expect, it } from 'vitest';
import { discountEndLabel, formatReviewCount, groupGameSearchResults, groupRecoTail, originalPrice, parseList, platformLabels, releaseLabel, shouldShowGameSearchEmpty } from './games';

describe('game display helpers', () => {
  it('兼容数据库 JSON 字符串、Steam description 对象与脏数据', () => {
    expect(parseList('["合作","冒险"]')).toEqual(['合作', '冒险']);
    expect(parseList([{ description: '在线合作' }])).toEqual(['在线合作']);
    expect(parseList('not-json')).toEqual([]);
  });

  it('抢先体验明确按尚未正式发售展示', () => {
    expect(releaseLabel({ release_state: 'early_access', release_date: '2026' })).toBe('抢先体验');
    expect(releaseLabel({ release_state: 'unreleased', release_date: '2027-03-01' })).toBe('2027-03-01');
    expect(releaseLabel({ release_state: 'unreleased' })).toBe('尚未发售');
  });

  it('只展示实际支持的平台', () => {
    expect(platformLabels('{"windows":true,"mac":false,"linux":true}')).toEqual(['Windows', 'Linux']);
    expect(platformLabels('[{"name":"Game Boy Advance","abbreviation":"GBA"},{"name":"PlayStation 5"}]')).toEqual(['GBA', 'PlayStation 5']);
    expect(platformLabels('bad-json')).toEqual([]);
  });

  it('格式化评测数和 Steam 分单位原价', () => {
    expect(formatReviewCount(9876)).toBe('9,876');
    expect(formatReviewCount(12580)).toBe('1.3万');
    expect(formatReviewCount(128500)).toBe('13万');
    expect(originalPrice({ initial_price: 6800 })).toBe('¥68.00');
    expect(originalPrice({ initial_price: null })).toBe('');
  });

  it('格式化 Steam 优惠截止日', () => {
    expect(discountEndLabel('2026-08-14')).toBe('优惠至 8月14日');
    expect(discountEndLabel(null)).toBe('');
  });

  it('可变数量的推荐尾部最多三张一行并均衡铺满', () => {
    expect(groupRecoTail([])).toEqual([]);
    expect(groupRecoTail([4])).toEqual([[4]]);
    expect(groupRecoTail([4, 5, 6])).toEqual([[4, 5, 6]]);
    expect(groupRecoTail([4, 5, 6, 7])).toEqual([[4, 5], [6, 7]]);
    expect(groupRecoTail([4, 5, 6, 7, 8])).toEqual([[4, 5, 6], [7, 8]]);
    expect(groupRecoTail([4, 5, 6, 7, 8, 9])).toEqual([[4, 5, 6], [7, 8, 9]]);
  });

  it('只有当前关键词已完成查询后才显示空结果', () => {
    expect(shouldShowGameSearchEmpty({ query: '荒野之息', settledQuery: '', searching: false, resultCount: 0, hasError: false })).toBe(false);
    expect(shouldShowGameSearchEmpty({ query: '荒野之息', settledQuery: '荒野之息', searching: false, resultCount: 0, hasError: false })).toBe(true);
    expect(shouldShowGameSearchEmpty({ query: '荒野之息', settledQuery: '荒野之息', searching: true, resultCount: 0, hasError: false })).toBe(false);
  });

  it('搜索结果把本体与所属 DLC 合并成一个可展开组，版本作品仍独立', () => {
    const groups = groupGameSearchResults([
      { igdb_id: 314265, title: '生灵重塑', original_title: 'Reanimal', content_type: 'game' },
      { igdb_id: 412645, title: 'Reanimal: Chapter 1', content_type: 'dlc', parent_igdb_id: 314265, parent_title: 'Reanimal' },
      { igdb_id: 389542, title: 'Reanimal: Masks', content_type: 'dlc', parent_igdb_id: 314265, parent_title: 'Reanimal' },
      { igdb_id: 999, title: 'Reanimal Switch 2 Edition', content_type: 'game' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].title).toBe('生灵重塑');
    expect(groups[0].base?.igdb_id).toBe(314265);
    expect(groups[0].dlcCount).toBe(2);
    expect(groups[0].items.map(item => item.igdb_id)).toEqual([314265, 412645, 389542]);
    expect(groups[1].items.map(item => item.igdb_id)).toEqual([999]);
  });
});
