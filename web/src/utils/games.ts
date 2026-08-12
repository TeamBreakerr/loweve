export function parseList(value: any): string[] {
  const normalize = (items: any[]) => items
    .map((item: any) => typeof item === 'string' ? item : item?.description)
    .filter(Boolean);
  if (Array.isArray(value)) return normalize(value);
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? normalize(parsed) : [];
  } catch { return []; }
}

export function releaseLabel(work: any) {
  if (work?.release_state === 'early_access') return '抢先体验';
  if (work?.release_state === 'unreleased') return work.release_date || '尚未发售';
  return work?.release_date || (work?.release_year ? String(work.release_year) : '发售日未知');
}

export function platformLabels(value: any) {
  let platforms: any = value;
  try { if (typeof value === 'string') platforms = JSON.parse(value || '[]'); } catch { platforms = []; }
  if (Array.isArray(platforms)) {
    return platforms.map((platform: any) => typeof platform === 'string'
      ? platform
      : platform?.abbreviation || platform?.name).filter(Boolean);
  }
  return [['windows', 'Windows'], ['mac', 'macOS'], ['linux', 'Linux']]
    .filter(([key]) => platforms?.[key]).map(([, label]) => label);
}

export function formatReviewCount(value: any) {
  const n = Number(value) || 0;
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`;
  return n.toLocaleString('zh-CN');
}

export function originalPrice(work: any) {
  if (work?.initial_price == null) return '';
  return `¥${(Number(work.initial_price) / 100).toFixed(2)}`;
}

export function discountEndLabel(value: any) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `优惠至 ${Number(match[2])}月${Number(match[3])}日`;
}

/** 推荐尾部最多三张一行，数量不足时均衡拆分，让每行都能铺满容器。 */
export function groupRecoTail<T>(items: T[] = []): T[][] {
  if (items.length <= 3) return items.length ? [items] : [];
  const firstRowCount = Math.ceil(items.length / 2);
  return [items.slice(0, firstRowCount), items.slice(firstRowCount)];
}

export function shouldShowGameSearchEmpty({ query, settledQuery, searching, resultCount, hasError }: {
  query: any; settledQuery: any; searching: boolean; resultCount: number; hasError: boolean;
}) {
  const current = String(query || '').trim();
  return Boolean(current)
    && String(settledQuery || '') === current
    && !searching
    && resultCount === 0
    && !hasError;
}

function normalizedGameTitle(value: any) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function searchResultIdentity(item: any) {
  if (item?.igdb_id) return `igdb:${item.igdb_id}`;
  if (item?.steam_appid) return `steam:${item.steam_appid}`;
  return `title:${normalizedGameTitle(item?.title)}`;
}

/** 本体与所属 DLC 聚为一组；版本/重制版等独立游戏仍保留自己的结果组。 */
export function groupGameSearchResults(results: any[] = []) {
  const indexed = results.map((item, index) => ({ item, index }));
  const bases = indexed.filter(({ item }) => item?.content_type !== 'dlc');
  const groups = bases.map(({ item, index }) => ({
    key: searchResultIdentity(item), title: item.title, original_title: item.original_title,
    base: item, preview: item, items: [item], dlcCount: 0, firstIndex: index,
  }));
  const orphanGroups = new Map<string, any>();

  for (const { item, index } of indexed.filter(row => row.item?.content_type === 'dlc')) {
    const parentTitle = normalizedGameTitle(item.parent_title);
    let group = groups.find(candidate =>
      (item.parent_igdb_id && Number(candidate.base?.igdb_id) === Number(item.parent_igdb_id))
      || (item.parent_steam_appid && Number(candidate.base?.steam_appid) === Number(item.parent_steam_appid))
      || (parentTitle && [candidate.base?.title, candidate.base?.original_title]
        .some(title => normalizedGameTitle(title) === parentTitle)));
    if (!group) {
      const orphanKey = item.parent_igdb_id ? `parent-igdb:${item.parent_igdb_id}`
        : item.parent_steam_appid ? `parent-steam:${item.parent_steam_appid}`
          : `parent-title:${parentTitle || searchResultIdentity(item)}`;
      group = orphanGroups.get(orphanKey);
      if (!group) {
        group = {
          key: orphanKey, title: item.parent_title || item.title, original_title: null,
          base: null, preview: item, items: [], dlcCount: 0, firstIndex: index,
        };
        orphanGroups.set(orphanKey, group);
        groups.push(group);
      }
    }
    group.items.push(item);
    group.dlcCount++;
    group.firstIndex = Math.min(group.firstIndex, index);
  }
  return groups.sort((a, b) => a.firstIndex - b.firstIndex);
}
