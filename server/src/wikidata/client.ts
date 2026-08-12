// Wikidata 仅用于把 IGDB 未收录的中文简称映射到正式多语言标题；
// 搜索结果的作品身份与 DLC 关系仍必须由 IGDB 返回并验证。
const API = 'https://www.wikidata.org/w/api.php';
const REQUEST_TIMEOUT_MS = 12_000;
const CACHE_MS = 30 * 60 * 1000;
const VIDEO_GAME_ENTITY = 'Q7889';

function unique(values: any[]) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function isVideoGame(entity: any) {
  return (entity?.claims?.P31 || []).some((claim: any) =>
    claim?.mainsnak?.datavalue?.value?.id === VIDEO_GAME_ENTITY);
}

export function createWikidataClient({
  fetch = globalThis.fetch,
  now = () => Date.now(),
}: { fetch?: any; now?: () => number } = {}) {
  const cache = new Map<string, { at: number; value: any[] }>();

  async function getJson(params: Record<string, string>) {
    const url = new URL(API);
    for (const [key, value] of Object.entries({ format: 'json', origin: '*', ...params })) {
      url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'User-Agent': 'loweve/1.0 (game title alias lookup)',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
      },
    });
    if (!response.ok) throw new Error(`wikidata_upstream_${response.status}`);
    return response.json();
  }

  async function searchGameAliases(query: any) {
    const key = String(query || '').trim();
    if (!key) return [];
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_MS) return hit.value;

    const searched = await getJson({
      action: 'wbsearchentities', search: key, language: 'zh', uselang: 'zh', limit: '5', type: 'item',
    });
    const ids = unique((searched?.search || []).map((item: any) => item?.id))
      .filter(id => /^Q\d+$/.test(id)).slice(0, 5);
    if (!ids.length) return [];

    const payload = await getJson({
      action: 'wbgetentities', ids: ids.join('|'), props: 'labels|claims',
      languages: 'en|mul|zh-cn|zh-hans|zh', languagefallback: '1',
    });
    const value = ids.map(id => {
      const entity = payload?.entities?.[id];
      if (!isVideoGame(entity)) return null;
      const labels = entity?.labels || {};
      const localizedTitle = labels['zh-cn']?.value || labels['zh-hans']?.value || labels.zh?.value || null;
      const lookupTitles = unique([
        labels.en?.value, labels.mul?.value, localizedTitle,
      ]);
      return lookupTitles.length ? { id, localized_title: localizedTitle, lookup_titles: lookupTitles } : null;
    }).filter(Boolean);
    cache.set(key, { at: now(), value });
    return value;
  }

  return { searchGameAliases };
}
