import { STEAM_OFFER_PARSER_VERSION } from '../steam/client.js';

const REFRESH_MS = 6 * 60 * 60 * 1000;

const GAME_COLUMNS = [
  'igdb_id', 'steam_appid', 'catalog_source', 'content_type', 'parent_igdb_id', 'parent_steam_appid',
  'parent_title', 'title', 'original_title', 'release_date', 'release_year',
  'release_state', 'is_free', 'short_description', 'about_game', 'developers', 'publishers', 'genres',
  'platforms', 'play_modes', 'supports_together', 'cover_url', 'header_url', 'price_currency',
  'initial_price', 'current_price', 'discount_percent', 'price_formatted', 'discount_end_date', 'review_score', 'review_desc',
  'review_positive', 'review_negative', 'review_total', 'review_percent', 'recent_review_score',
  'recent_review_desc', 'recent_review_positive', 'recent_review_negative', 'recent_review_total',
  'recent_review_percent', 'catalog_rating', 'catalog_rating_count', 'critic_rating', 'critic_rating_count',
  'igdb_url', 'external_links', 'igdb_raw', 'steam_raw', 'reviews_raw', 'fetched_at', 'updated_at',
];

const STEAM_ENRICH_COLUMNS = [
  'is_free', 'price_currency', 'initial_price', 'current_price', 'discount_percent', 'price_formatted', 'discount_end_date',
  'review_score', 'review_desc', 'review_positive', 'review_negative', 'review_total', 'review_percent',
  'recent_review_score', 'recent_review_desc', 'recent_review_positive', 'recent_review_negative',
  'recent_review_total', 'recent_review_percent', 'steam_raw', 'reviews_raw', 'store_country',
];

function parseJson(value: any, fallback: any) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function gameOfferNeedsRefresh(work: any) {
  if (Number(work?.discount_percent) <= 0) return false;
  const parserVersion = Number(parseJson(work?.steam_raw, {})?._loweve_offer_parser_version) || 0;
  return work?.discount_end_date == null || parserVersion < STEAM_OFFER_PARSER_VERSION;
}

function normalizedRecord(data: any) {
  const now = Date.now();
  const defaults: Record<string, any> = {
    igdb_id: null, steam_appid: null, catalog_source: data?.igdb_id ? 'igdb' : 'steam',
    content_type: 'game', parent_igdb_id: null, parent_steam_appid: null, parent_title: null,
    title: '', original_title: null, release_date: null, release_year: null, release_state: 'unreleased',
    is_free: 0, short_description: null, about_game: null, developers: '[]', publishers: '[]', genres: '[]',
    platforms: '[]', play_modes: '[]', supports_together: 0, cover_url: null, header_url: null,
    price_currency: null, initial_price: null, current_price: null, discount_percent: 0, price_formatted: null,
    discount_end_date: null,
    review_score: null, review_desc: null, review_positive: null, review_negative: null,
    review_total: null, review_percent: null, recent_review_score: null, recent_review_desc: null,
    recent_review_positive: null, recent_review_negative: null, recent_review_total: null,
    recent_review_percent: null, catalog_rating: null, catalog_rating_count: null,
    critic_rating: null, critic_rating_count: null, igdb_url: null, external_links: '[]',
    igdb_raw: null, steam_raw: null, reviews_raw: null, fetched_at: now, updated_at: now,
  };
  const row = { ...defaults, ...(data || {}) };
  for (const key of ['developers', 'publishers', 'genres', 'platforms', 'play_modes', 'external_links']) {
    if (typeof row[key] !== 'string') row[key] = JSON.stringify(row[key] ?? []);
  }
  return row;
}

export function gameStoreUrl(appid: any) {
  return Number.isInteger(Number(appid)) && Number(appid) > 0
    ? `https://store.steampowered.com/app/${Number(appid)}/`
    : '';
}

function bestExternalUrl(row: any) {
  const links = parseJson(row?.external_links, []);
  const preferred = ['playstation_store_us', 'xbox_marketplace', 'microsoft', 'gog', 'epic_game_store', 'itch_io'];
  for (const provider of preferred) {
    const found = links.find((item: any) => item?.provider === provider && item?.url);
    if (found) return found.url;
  }
  return links.find((item: any) => item?.url)?.url || '';
}

export function withGameLinks(row: any) {
  if (!row) return row;
  const steamUrl = gameStoreUrl(row.steam_appid);
  return {
    ...row,
    store_url: steamUrl || bestExternalUrl(row) || null,
    source_url: row.igdb_url || steamUrl || null,
  };
}

function mergeIgdbWithSteam(catalog: any, steam: any) {
  if (!steam) return catalog;
  const result = { ...catalog };
  for (const key of STEAM_ENRICH_COLUMNS) result[key] = steam[key] ?? result[key] ?? null;
  result.steam_appid = steam.steam_appid || catalog.steam_appid;
  result.parent_steam_appid = catalog.parent_steam_appid || steam.parent_steam_appid || null;
  result.parent_title = catalog.parent_title || steam.parent_title || null;
  const steamHasChineseTitle = /\p{Script=Han}/u.test(String(steam.title || ''));
  result.title = steamHasChineseTitle ? steam.title : catalog.title || steam.title;
  result.original_title = steamHasChineseTitle && catalog.title !== result.title
    ? catalog.title
    : catalog.original_title || (steam.title && steam.title !== result.title ? steam.title : steam.original_title);
  result.short_description = catalog.short_description || steam.short_description;
  result.about_game = catalog.about_game || steam.about_game;
  result.developers = parseJson(catalog.developers, []).length ? catalog.developers : steam.developers;
  result.publishers = parseJson(catalog.publishers, []).length ? catalog.publishers : steam.publishers;
  result.genres = JSON.stringify([...new Set([
    ...parseJson(catalog.genres, []), ...parseJson(steam.genres, []).map((item: any) => item?.description || item),
  ].filter(Boolean))]);
  result.play_modes = parseJson(catalog.play_modes, []).length ? catalog.play_modes : steam.play_modes;
  result.supports_together = catalog.supports_together || steam.supports_together ? 1 : 0;
  result.cover_url = catalog.cover_url || steam.cover_url;
  result.header_url = steam.header_url || catalog.header_url;
  // Steam 的具体商店状态比目录首发日更适合判断当前 Steam 版本。
  if (steam.release_state === 'early_access' || catalog.release_state === 'unreleased') {
    result.release_state = steam.release_state || catalog.release_state;
  }
  result.release_date = catalog.release_date || steam.release_date;
  result.release_year = catalog.release_year || steam.release_year;
  result.fetched_at = Math.max(Number(catalog.fetched_at) || 0, Number(steam.fetched_at) || 0);
  result.updated_at = Math.max(Number(catalog.updated_at) || 0, Number(steam.updated_at) || 0);
  return result;
}

function normalizeFamilyTitle(value: any) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function catalogFamily(results: any[], base: any) {
  const names = [...new Set([base?.title, base?.original_title].map(normalizeFamilyTitle).filter(Boolean))];
  const related = results.filter(item => item !== base && [item?.title, item?.original_title]
    .map(normalizeFamilyTitle).filter(Boolean)
    .some(title => names.some(name => title.startsWith(name))));
  return [base, ...related];
}

function uniqueCatalogResults(results: any[]) {
  const seen = new Set<string>();
  return results.filter(item => {
    if (!item) return false;
    const identity = item.igdb_id ? `igdb:${item.igdb_id}` : `steam:${item.steam_appid}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

async function matchingCatalogGame(catalogResults: any[], steamGame: any, steam: any) {
  const canonicalAppid = Number(steamGame?.steam_appid);
  const exact = catalogResults.find(item => Number(item?.steam_appid) === canonicalAppid);
  if (exact) return exact;
  // IGDB 偶尔仍保存 Steam 的旧 AppID；以 Steam 返回的规范 AppID 验证是否为同一商品。
  for (const item of catalogResults.filter(entry => Number(entry?.steam_appid) > 0).slice(0, 5)) {
    try {
      const candidate = await steam.gameDetail(Number(item.steam_appid));
      if (Number(candidate?.steam_appid) === canonicalAppid) return item;
    } catch { /* 单个旧外部 ID 失效时继续验证其他候选 */ }
  }
  return null;
}

async function catalogFamilyForSteamGame(steamGame: any, igdb: any, steam: any) {
  const names = [...new Set([steamGame?.original_title, steamGame?.title]
    .map(value => String(value || '').trim()).filter(Boolean))];
  for (const name of names) {
    const catalogResults = (await igdb.search(name))?.results || [];
    const catalog = await matchingCatalogGame(catalogResults, steamGame, steam);
    if (catalog) return enrichGameSearchResults(catalogFamily(catalogResults, catalog), steam);
  }
  return [];
}

/** Steam AppID / 链接只是身份桥；最终只返回经 IGDB 目录验证过的作品。 */
export async function verifiedSteamReferenceResults(appid: any, igdb: any, steam: any) {
  if (!igdb?.search || !steam?.gameDetail) return [];
  try { return uniqueCatalogResults(await catalogFamilyForSteamGame(await steam.gameDetail(Number(appid)), igdb, steam)); }
  catch { return []; }
}

/**
 * Steam 只提供 IGDB 缺失的本地化搜索入口；候选必须用相同 Steam AppID 在 IGDB 中反查成功。
 * 因此不会把 IGDB 未收录的 Steam-only 游戏混入主目录。
 */
export async function verifiedCatalogAliasResults(query: any, igdb: any, steam: any) {
  if (!igdb?.search || !steam?.search) return [];
  let searchResult: any;
  try { searchResult = await (steam.searchCandidates || steam.search)(query); } catch { return []; }
  const steamResults: any[] = searchResult?.results || [];
  const verified = await Promise.all(steamResults.slice(0, 5).map(async steamGame => {
    const appid = Number(steamGame?.steam_appid);
    if (!Number.isInteger(appid) || appid <= 0) return null;
    const names = [...new Set([steamGame.original_title, steamGame.title].map(value => String(value || '').trim()).filter(Boolean))];
    for (const name of names) {
      try {
        const catalogResults = (await igdb.search(name))?.results || [];
        const catalog = await matchingCatalogGame(catalogResults, steamGame, steam);
        if (catalog) {
          const family = catalogFamily(catalogResults, catalog);
          const enriched = await enrichGameSearchResults(family, steam);
          return enriched.map((item: any) => Number(item?.steam_appid) === appid
            ? mergeIgdbWithSteam(item, steamGame) : item);
        }
      } catch { /* 单个候选失败不影响其他候选验证 */ }
    }
    return [];
  }));
  return uniqueCatalogResults(verified.flat());
}

/** Wikidata 只翻译中文别名；只有与正式标题精确匹配的 IGDB 作品及其家族成员才会返回。 */
export async function verifiedWikidataAliasResults(query: any, igdb: any, wikidata: any, steam: any) {
  if (!igdb?.search || !wikidata?.searchGameAliases) return [];
  let aliases: any[];
  try { aliases = await wikidata.searchGameAliases(query); } catch { return []; }
  for (const alias of aliases.slice(0, 5)) {
    for (const lookupTitle of alias?.lookup_titles || []) {
      try {
        const catalogResults = (await igdb.search(lookupTitle))?.results || [];
        const exact = catalogResults.find((item: any) => [item?.title, item?.original_title]
          .some(name => normalizeFamilyTitle(name) === normalizeFamilyTitle(lookupTitle)));
        if (!exact) continue;
        let family = catalogFamily(catalogResults, exact);
        if (alias.localized_title) {
          family = family.map(item => item === exact ? {
            ...item,
            title: alias.localized_title,
            original_title: item.title !== alias.localized_title ? item.title : item.original_title,
          } : item);
        }
        return uniqueCatalogResults(await enrichGameSearchResults(family, steam));
      } catch { /* 单个别名失败时尝试下一个正式标题 */ }
    }
  }
  return [];
}

/** IGDB 负责搜索与身份；Steam 只按 IGDB 的外部 AppID 补价格/评价，不产生独立候选。 */
export async function enrichGameSearchResults(catalogResults: any[] = [], steam: any) {
  const baseIgdbIds = new Set(catalogResults
    .filter(item => item?.content_type !== 'dlc' && Number(item?.igdb_id) > 0)
    .map(item => Number(item.igdb_id)));
  const baseSteamIds = new Set(catalogResults
    .filter(item => item?.content_type !== 'dlc' && Number(item?.steam_appid) > 0)
    .map(item => Number(item.steam_appid)));
  return Promise.all(catalogResults.map(async catalog => {
    // 折叠搜索只需同步补全组头的本体；组内 DLC 选中入库时会再获取完整 Steam 数据。
    const isGroupedDlc = catalog?.content_type === 'dlc'
      && (baseIgdbIds.has(Number(catalog?.parent_igdb_id))
        || baseSteamIds.has(Number(catalog?.parent_steam_appid)));
    if (isGroupedDlc) return catalog;
    const appid = Number(catalog?.steam_appid);
    if (!Number.isInteger(appid) || appid <= 0 || !steam?.gameDetail) return catalog;
    try { return mergeIgdbWithSteam(catalog, await steam.gameDetail(appid)); }
    catch { return catalog; }
  }));
}

function findExisting(db: any, data: any) {
  if (Number.isInteger(Number(data?.igdb_id)) && Number(data.igdb_id) > 0) {
    const row = db.prepare('SELECT * FROM game_works WHERE igdb_id = ?').get(Number(data.igdb_id));
    if (row) return row;
  }
  if (Number.isInteger(Number(data?.steam_appid)) && Number(data.steam_appid) > 0) {
    return db.prepare('SELECT * FROM game_works WHERE steam_appid = ?').get(Number(data.steam_appid));
  }
  return null;
}

function syncRelatedData(db: any, workId: number, data: any) {
  if (data.catalog_source === 'igdb') {
    db.prepare(`DELETE FROM game_platform_releases WHERE work_id = ? AND source = 'igdb'`).run(workId);
    const addRelease = db.prepare(`INSERT OR IGNORE INTO game_platform_releases
      (work_id, igdb_platform_id, platform_name, platform_abbreviation, release_date, release_year, region, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'igdb')`);
    for (const release of data.platform_releases || []) {
      addRelease.run(workId, release.igdb_platform_id ?? null, release.platform_name,
        release.platform_abbreviation ?? null, release.release_date ?? null, release.release_year ?? null,
        release.region ?? null);
    }
  }

  db.prepare('DELETE FROM game_external_ids WHERE work_id = ?').run(workId);
  const addExternal = db.prepare(`INSERT OR IGNORE INTO game_external_ids
    (work_id, provider, external_id, country, url) VALUES (?, ?, ?, '', ?)`);
  for (const link of parseJson(data.external_links, [])) {
    if (link?.provider && link?.external_id) addExternal.run(workId, link.provider, String(link.external_id), link.url || null);
  }
  if (data.steam_appid) addExternal.run(workId, 'steam', String(data.steam_appid), gameStoreUrl(data.steam_appid));

  db.prepare(`DELETE FROM game_store_offers WHERE work_id = ? AND store = 'steam'`).run(workId);
  if (data.steam_appid && (data.is_free || data.current_price != null)) {
    const country = data.store_country === 'US' ? 'US' : 'CN';
    db.prepare(`INSERT INTO game_store_offers
      (work_id, store, country, currency, list_price_minor, sale_price_minor, discount_percent,
       availability, store_url, source, checked_at, expires_at)
      VALUES (?, 'steam', ?, ?, ?, ?, ?, ?, ?, 'steam_store', ?, ?)`)
      .run(workId, country, data.price_currency, data.initial_price, data.current_price, data.discount_percent || 0,
        data.is_free ? 'free' : 'available', gameStoreUrl(data.steam_appid), data.fetched_at, null);
  }

  if (data.review_percent != null) {
    db.prepare(`INSERT INTO game_review_aggregates
      (work_id, provider, score, scale, positive, negative, total, checked_at)
      VALUES (?, 'steam', ?, 100, ?, ?, ?, ?)
      ON CONFLICT(work_id, provider) DO UPDATE SET score=excluded.score, scale=excluded.scale,
        positive=excluded.positive, negative=excluded.negative, total=excluded.total, checked_at=excluded.checked_at`)
      .run(workId, data.review_percent, data.review_positive, data.review_negative, data.review_total, data.fetched_at);
  }
  if (data.catalog_rating != null) {
    db.prepare(`INSERT INTO game_review_aggregates
      (work_id, provider, score, scale, total, checked_at)
      VALUES (?, 'igdb', ?, 100, ?, ?)
      ON CONFLICT(work_id, provider) DO UPDATE SET score=excluded.score, scale=excluded.scale,
        total=excluded.total, checked_at=excluded.checked_at`)
      .run(workId, data.catalog_rating, data.catalog_rating_count, data.fetched_at);
  }
}

function saveGameWork(db: any, input: any) {
  const data = normalizedRecord(input);
  const existing: any = findExisting(db, data);
  let id: number;
  db.transaction(() => {
    if (existing) {
      const assignments = GAME_COLUMNS.map(column => `${column} = @${column}`).join(', ');
      db.prepare(`UPDATE game_works SET ${assignments} WHERE id = @id`).run({ ...data, id: existing.id });
      id = existing.id;
    } else {
      const names = GAME_COLUMNS.join(', ');
      const values = GAME_COLUMNS.map(column => '@' + column).join(', ');
      const info = db.prepare(`INSERT INTO game_works (${names}) VALUES (${values})`).run(data);
      id = Number(info.lastInsertRowid);
    }
    syncRelatedData(db, id!, data);
  })();
  return withGameLinks(db.prepare('SELECT * FROM game_works WHERE id = ?').get(id!));
}

/** 兼容原有 Steam 调用点：直接按 Steam AppID 入库。 */
export async function upsertGameWork(db: any, steam: any, steamAppid: any, { force = false }: { force?: boolean } = {}) {
  const appid = Number(steamAppid);
  if (!Number.isInteger(appid) || appid <= 0) {
    const error: any = new Error('invalid_steam_appid'); error.code = 'invalid_steam_appid'; throw error;
  }
  const existing: any = db.prepare('SELECT * FROM game_works WHERE steam_appid = ?').get(appid);
  const missesDiscountEnd = gameOfferNeedsRefresh(existing);
  if (existing && !force && !missesDiscountEnd && Date.now() - existing.fetched_at < REFRESH_MS) return withGameLinks(existing);
  const detail = await steam.gameDetail(appid, { force });
  return saveGameWork(db, { ...detail, igdb_id: existing?.igdb_id ?? null, catalog_source: existing?.igdb_id ? 'igdb' : 'steam' });
}

export async function upsertIgdbGameWork(db: any, igdb: any, steam: any, igdbId: any, { force = false }: { force?: boolean } = {}) {
  const id = Number(igdbId);
  if (!Number.isInteger(id) || id <= 0) {
    const error: any = new Error('invalid_igdb_id'); error.code = 'invalid_igdb_id'; throw error;
  }
  const existing: any = db.prepare('SELECT * FROM game_works WHERE igdb_id = ?').get(id);
  const missesDiscountEnd = gameOfferNeedsRefresh(existing);
  if (existing && !force && !missesDiscountEnd && Date.now() - existing.fetched_at < REFRESH_MS) return withGameLinks(existing);
  const catalog = await igdb.gameDetail(id, { force });
  let steamDetail: any = null;
  if (catalog?.steam_appid && steam?.gameDetail) {
    try { steamDetail = await steam.gameDetail(catalog.steam_appid, { force }); } catch { /* Steam 增强失败不影响全平台目录 */ }
  }
  return saveGameWork(db, mergeIgdbWithSteam(catalog, steamDetail));
}

export async function refreshGameWorkIfStale(db: any, sources: any, work: any) {
  const missesDiscountEnd = gameOfferNeedsRefresh(work);
  if (!work || (!missesDiscountEnd && Date.now() - work.fetched_at < REFRESH_MS)) return withGameLinks(work);
  try {
    if (work.igdb_id && sources?.igdb?.isConfigured?.()) {
      return await upsertIgdbGameWork(db, sources.igdb, sources.steam, work.igdb_id, { force: true });
    }
    if (work.steam_appid) return await upsertGameWork(db, sources?.steam, work.steam_appid, { force: true });
  } catch { /* 保留最后一次成功数据 */ }
  return withGameLinks(work);
}

function normalize(value: any) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}]+/gu, '');
}

function titleScore(query: any, item: any) {
  const q = normalize(query);
  const names = [normalize(item.title), normalize(item.original_title)].filter(Boolean);
  if (names.includes(q)) return 1;
  if (names.some(name => name.includes(q) || q.includes(name))) return 0.82;
  return 0;
}

function chooseBest(title: any, year: any, results: any[]) {
  let best: any = null;
  let bestScore = 0;
  for (const item of results) {
    let score = titleScore(title, item);
    if (year && item.release_year) {
      const diff = Math.abs(Number(year) - Number(item.release_year));
      score += diff === 0 ? 0.12 : (diff === 1 ? 0.05 : -0.12);
    }
    if (score > bestScore) { best = item; bestScore = score; }
  }
  return best && bestScore >= 0.72 ? best : null;
}

export async function resolveSteamGame(steam: any, { title, year, steam_appid }: any) {
  if (Number.isInteger(Number(steam_appid)) && Number(steam_appid) > 0) {
    try { return await steam.gameDetail(Number(steam_appid)); } catch { /* 回落标题搜索 */ }
  }
  if (!title) return null;
  try { return chooseBest(title, year, (await steam.search(title))?.results || []); }
  catch { return null; }
}

export async function resolveCatalogGame(sources: any, item: any) {
  const igdb = sources?.igdb;
  if (igdb?.isConfigured?.()) {
    if (Number.isInteger(Number(item?.igdb_id)) && Number(item.igdb_id) > 0) {
      try {
        const catalog = await igdb.gameDetail(Number(item.igdb_id));
        return (await enrichGameSearchResults([catalog], sources?.steam))[0] || catalog;
      } catch { /* 回落标题搜索 */ }
    }
    if (item?.title) {
      try {
        const best = chooseBest(item.title, item.year, (await igdb.search(item.title))?.results || []);
        if (best) return (await enrichGameSearchResults([best], sources?.steam))[0] || best;
      } catch { /* IGDB 是目录边界，失败时不产生 Steam-only 身份 */ }
    }
    return null;
  }
  return resolveSteamGame(sources?.steam, item);
}

export async function upsertResolvedGame(db: any, sources: any, game: any) {
  if (game?.igdb_id && sources?.igdb?.isConfigured?.()) {
    return upsertIgdbGameWork(db, sources.igdb, sources.steam, game.igdb_id);
  }
  return upsertGameWork(db, sources?.steam, game?.steam_appid);
}

export function gameIdentity(game: any) {
  if (Number.isInteger(Number(game?.igdb_id)) && Number(game.igdb_id) > 0) return `igdb:${Number(game.igdb_id)}`;
  if (Number.isInteger(Number(game?.steam_appid)) && Number(game.steam_appid) > 0) return `steam:${Number(game.steam_appid)}`;
  if (Number.isInteger(Number(game?.id)) && Number(game.id) > 0) return `work:${Number(game.id)}`;
  return `title:${normalize(game?.title)}`;
}

export function isDefaultRecommendationEligible(game: any) {
  if (!game || game.release_state !== 'released') return false;
  if (game.content_type === 'dlc') return false;
  if (!game.supports_together) return false;
  if (game.review_score != null && game.review_score <= 4) return false;
  return true;
}

export function confidenceNote(game: any) {
  if (game?.review_total != null && game.review_total < 50) return 'Steam 评价样本较少';
  if (game?.review_total == null && (!game?.catalog_rating_count || game.catalog_rating_count < 20)) return 'IGDB 评价样本较少';
  return null;
}
