const API = 'https://api.igdb.com/v4';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const REQUEST_TIMEOUT_MS = 15_000;
const DETAIL_CACHE_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MS = 10 * 60 * 1000;
const SEARCH_LIMIT = 12;

const CATEGORY_SOURCE: Record<number, string> = {
  1: 'steam', 5: 'gog', 11: 'microsoft', 13: 'apple', 15: 'android',
  26: 'epic_game_store', 30: 'itch_io', 31: 'xbox_marketplace',
  36: 'playstation_store_us', 54: 'xbox_game_pass_ultimate_cloud',
};

const GAME_FIELDS = [
  'name', 'slug', 'summary', 'storyline', 'url', 'first_release_date',
  'cover.image_id', 'artworks.image_id', 'screenshots.image_id',
  'platforms.id', 'platforms.name', 'platforms.abbreviation', 'platforms.slug',
  'release_dates.date', 'release_dates.human', 'release_dates.y',
  'release_dates.platform.id', 'release_dates.platform.name', 'release_dates.platform.abbreviation',
  'genres.name', 'game_modes.name',
  'multiplayer_modes.campaigncoop', 'multiplayer_modes.lancoop',
  'multiplayer_modes.offlinecoop', 'multiplayer_modes.offlinecoopmax',
  'multiplayer_modes.onlinecoop', 'multiplayer_modes.onlinecoopmax',
  'multiplayer_modes.offlinemax', 'multiplayer_modes.onlinemax',
  'multiplayer_modes.splitscreen', 'multiplayer_modes.splitscreenonline',
  'involved_companies.developer', 'involved_companies.publisher',
  'involved_companies.company.name',
  'alternative_names.name', 'alternative_names.comment',
  'game_localizations.name', 'game_localizations.region.name', 'game_localizations.region.identifier',
  'external_games.uid', 'external_games.url', 'external_games.category',
  'external_games.external_game_source.name', 'external_games.platform.name',
  'rating', 'rating_count', 'aggregated_rating', 'aggregated_rating_count',
  'total_rating', 'total_rating_count', 'game_status.status', 'game_type.type', 'version_parent',
  'parent_game.id', 'parent_game.name', 'parent_game.slug',
].join(',');

export class IgdbError extends Error {
  code: string;
  status?: number;

  constructor(code: string, status?: number) {
    super(code);
    this.name = 'IgdbError';
    this.code = code;
    this.status = status;
  }
}

export function parseIgdbReference(value: any) {
  const text = String(value || '').trim();
  const match = text.match(/igdb\.com\/games\/(?:[^/?#]+--)?(\d+)/i);
  if (match) return Number(match[1]);
  if (/^igdb:\d+$/i.test(text)) return Number(text.slice(5));
  return null;
}

function list(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function unique(values: any[]) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeTitle(value: any) {
  return String(value || '').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function localizedTitle(game: any, query?: any) {
  const wanted = normalizeTitle(query);
  if (!wanted) return null;
  if (normalizeTitle(game?.name) === wanted) return null;
  const names = [
    ...list(game?.alternative_names).map(item => ({ name: item?.name, comment: item?.comment || '' })),
    ...list(game?.game_localizations).map(item => ({ name: item?.name, comment: item?.region?.identifier || item?.region?.name || '' })),
  ].filter(item => item.name && !/executable|\.exe\b|\.app\b/i.test(`${item.comment} ${item.name}`));
  const preference = (item: any) => /simplified|zh[-_]?cn|简体/i.test(item.comment) ? 2
    : /traditional|zh[-_]?tw|繁体/i.test(item.comment) ? 0 : 1;
  const matching = names.filter(item => {
    const name = normalizeTitle(item.name);
    return name === wanted || name.includes(wanted) || wanted.includes(name);
  }).sort((a, b) => {
    const exactA = normalizeTitle(a.name) === wanted ? 1 : 0;
    const exactB = normalizeTitle(b.name) === wanted ? 1 : 0;
    return exactB - exactA || preference(b) - preference(a);
  });
  return matching[0]?.name || null;
}

function imageUrl(imageId: any, size: string) {
  return imageId ? `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg` : null;
}

function isoDate(timestamp: any) {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString().slice(0, 10)
    : null;
}

function sourceName(item: any) {
  const raw = item?.external_game_source?.name || CATEGORY_SOURCE[Number(item?.category)] || 'external';
  return String(raw).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function isTogetherMode(game: any) {
  const multiplayer = list(game?.multiplayer_modes);
  if (multiplayer.some(mode => mode?.campaigncoop || mode?.lancoop || mode?.offlinecoop
    || mode?.onlinecoop || mode?.splitscreen || mode?.splitscreenonline
    || Number(mode?.offlinecoopmax) >= 2 || Number(mode?.onlinecoopmax) >= 2
    || Number(mode?.offlinemax) >= 2 || Number(mode?.onlinemax) >= 2)) return true;
  return list(game?.game_modes).some(mode => /co-?operative|multiplayer/i.test(String(mode?.name || '')));
}

function releaseState(game: any, now: number) {
  const status = String(game?.game_status?.status || '');
  if (/early\s*access/i.test(status)) return 'early_access';
  const first = Number(game?.first_release_date);
  if (!Number.isFinite(first) || first <= 0 || first * 1000 > now) return 'unreleased';
  return 'released';
}

export function mapIgdbGame(game: any, { now = Date.now(), query }: { now?: number; query?: any } = {}) {
  const igdbId = Number(game?.id);
  if (!Number.isInteger(igdbId) || igdbId <= 0 || !game?.name) return null;
  const versionParentId = Number(game?.version_parent?.id ?? game?.version_parent);
  if (Number.isInteger(versionParentId) && versionParentId > 0) return null;
  const gameType = String(game?.game_type?.type || '');
  const isDlc = /(?:dlc|add[ -]?on|expansion)/i.test(gameType);
  if (!isDlc && /(?:bundle|mod|pack)/i.test(gameType)) return null;
  const parentIgdbId = Number(game?.parent_game?.id ?? game?.parent_game);
  const externalLinks = list(game.external_games).map(item => ({
    provider: sourceName(item),
    external_id: String(item?.uid || '').trim(),
    url: item?.url || null,
    platform: item?.platform?.name || null,
  })).filter(item => item.external_id);
  const steam = externalLinks.find(item => item.provider === 'steam' && /^\d+$/.test(item.external_id));
  const releaseDate = isoDate(game.first_release_date);
  const platforms = list(game.platforms).map(platform => ({
    id: Number(platform?.id) || null,
    name: platform?.name || platform?.abbreviation || '未知平台',
    abbreviation: platform?.abbreviation || null,
    slug: platform?.slug || null,
  }));
  const platformReleases = list(game.release_dates).map(release => ({
    igdb_platform_id: Number(release?.platform?.id) || null,
    platform_name: release?.platform?.name || release?.platform?.abbreviation || '未知平台',
    platform_abbreviation: release?.platform?.abbreviation || null,
    release_date: isoDate(release?.date),
    release_year: Number(release?.y) || (isoDate(release?.date) ? Number(isoDate(release.date)!.slice(0, 4)) : null),
    region: null,
    source: 'igdb',
  }));
  const companies = list(game.involved_companies);
  const developers = unique(companies.filter(item => item?.developer).map(item => item?.company?.name));
  const publishers = unique(companies.filter(item => item?.publisher).map(item => item?.company?.name));
  const art = list(game.artworks)[0]?.image_id || list(game.screenshots)[0]?.image_id;
  const modes = unique([
    ...list(game.game_modes).map(mode => mode?.name),
    ...(isTogetherMode(game) ? ['Two-player / multiplayer'] : []),
  ]);
  const catalogRating = Number(game.total_rating ?? game.rating ?? game.aggregated_rating);
  const catalogRatingCount = Number(game.total_rating_count ?? game.rating_count ?? game.aggregated_rating_count);
  const nowMs = Number(now) || Date.now();
  const igdbUrl = game.url || (game.slug ? `https://www.igdb.com/games/${game.slug}` : null);
  const localTitle = localizedTitle(game, query);
  const externalStoreUrl = externalLinks.find(item => item.provider === 'steam')?.url
    || externalLinks.find(item => item.url)?.url || null;
  return {
    igdb_id: igdbId,
    steam_appid: steam ? Number(steam.external_id) : null,
    catalog_source: 'igdb',
    content_type: isDlc ? 'dlc' : 'game',
    parent_igdb_id: isDlc && Number.isInteger(parentIgdbId) && parentIgdbId > 0 ? parentIgdbId : null,
    parent_steam_appid: null,
    parent_title: isDlc ? game?.parent_game?.name || null : null,
    title: localTitle || String(game.name),
    original_title: localTitle && localTitle !== game.name ? String(game.name) : null,
    release_date: releaseDate,
    release_year: releaseDate ? Number(releaseDate.slice(0, 4)) : null,
    release_state: releaseState(game, nowMs),
    is_free: 0,
    short_description: game.summary || game.storyline || null,
    about_game: game.summary || game.storyline || null,
    developers: JSON.stringify(developers),
    publishers: JSON.stringify(publishers),
    genres: JSON.stringify(unique(list(game.genres).map(genre => genre?.name))),
    platforms: JSON.stringify(platforms),
    play_modes: JSON.stringify(modes),
    supports_together: isTogetherMode(game) ? 1 : 0,
    cover_url: imageUrl(game.cover?.image_id, 'cover_big_2x'),
    header_url: imageUrl(art, '1080p'),
    price_currency: null,
    initial_price: null,
    current_price: null,
    discount_percent: 0,
    price_formatted: null,
    discount_end_date: null,
    review_score: null,
    review_desc: null,
    review_positive: null,
    review_negative: null,
    review_total: null,
    review_percent: null,
    recent_review_score: null,
    recent_review_desc: null,
    recent_review_positive: null,
    recent_review_negative: null,
    recent_review_total: null,
    recent_review_percent: null,
    catalog_rating: Number.isFinite(catalogRating) ? Math.round(catalogRating * 10) / 10 : null,
    catalog_rating_count: Number.isFinite(catalogRatingCount) ? catalogRatingCount : null,
    critic_rating: Number.isFinite(Number(game.aggregated_rating)) ? Number(game.aggregated_rating) : null,
    critic_rating_count: Number.isFinite(Number(game.aggregated_rating_count)) ? Number(game.aggregated_rating_count) : null,
    igdb_url: igdbUrl,
    store_url: externalStoreUrl,
    source_url: igdbUrl,
    external_links: JSON.stringify(externalLinks),
    igdb_raw: JSON.stringify(game),
    steam_raw: null,
    reviews_raw: null,
    platform_releases: platformReleases.length ? platformReleases : platforms.map(platform => ({
      igdb_platform_id: platform.id,
      platform_name: platform.name,
      platform_abbreviation: platform.abbreviation,
      release_date: releaseDate,
      release_year: releaseDate ? Number(releaseDate.slice(0, 4)) : null,
      region: null,
      source: 'igdb',
    })),
    fetched_at: nowMs,
    updated_at: nowMs,
  };
}

function escapeSearch(value: any) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ').trim();
}

export function createIgdbClient({
  fetch = globalThis.fetch,
  now = () => Date.now(),
  resolve = () => ({ clientId: '', clientSecret: '' }),
}: { fetch?: any; now?: () => number; resolve?: () => { clientId?: string; clientSecret?: string } } = {}) {
  let accessToken = '';
  let tokenExpiresAt = 0;
  let tokenConfigKey = '';
  let tokenInflight: Promise<string> | null = null;
  let rateTail: Promise<void> = Promise.resolve();
  let nextRequestAt = 0;
  const detailCache = new Map<number, { value: any; cachedAt: number }>();
  const searchCache = new Map<string, { value: any; cachedAt: number }>();
  const searchInflight = new Map<string, Promise<any>>();

  function config() {
    const value = resolve() || {};
    return { clientId: String(value.clientId || '').trim(), clientSecret: String(value.clientSecret || '').trim() };
  }

  async function token(force = false) {
    const cfg = config();
    if (!cfg.clientId || !cfg.clientSecret) throw new IgdbError('igdb_unconfigured');
    const key = `${cfg.clientId}\0${cfg.clientSecret}`;
    if (!force && accessToken && tokenConfigKey === key && tokenExpiresAt - 60_000 > now()) return accessToken;
    if (!force && tokenInflight) return tokenInflight;
    tokenInflight = (async () => {
      let response: any;
      try {
        const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials' });
        response = await fetch(TOKEN_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error: any) {
        throw new IgdbError(error?.name === 'TimeoutError' ? 'igdb_timeout' : 'igdb_network');
      }
      if (!response.ok) throw new IgdbError(response.status === 401 ? 'igdb_auth' : 'igdb_upstream', response.status);
      let payload: any;
      try { payload = await response.json(); } catch { throw new IgdbError('igdb_bad_response', response.status); }
      if (!payload?.access_token) throw new IgdbError('igdb_auth', response.status);
      accessToken = payload.access_token;
      tokenConfigKey = key;
      tokenExpiresAt = now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000;
      return accessToken;
    })();
    try { return await tokenInflight; }
    finally { tokenInflight = null; }
  }

  async function pace() {
    const slot = rateTail.then(async () => {
      const delay = Math.max(0, nextRequestAt - Date.now());
      if (delay) await new Promise(resolveDelay => setTimeout(resolveDelay, delay));
      nextRequestAt = Date.now() + 260; // IGDB 默认 4 req/s，留少量抖动余量。
    });
    rateTail = slot.catch(() => undefined);
    await slot;
  }

  async function requestEndpoint(endpoint: string, body: string, retryAuth = true): Promise<any[]> {
    const cfg = config();
    const access = await token();
    await pace();
    let response: any;
    try {
      response = await fetch(`${API}/${endpoint}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Client-ID': cfg.clientId, Authorization: `Bearer ${access}` },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error: any) {
      throw new IgdbError(error?.name === 'TimeoutError' ? 'igdb_timeout' : 'igdb_network');
    }
    if (response.status === 401 && retryAuth) {
      await token(true);
      return requestEndpoint(endpoint, body, false);
    }
    if (!response.ok) throw new IgdbError(response.status === 429 ? 'igdb_rate_limited' : 'igdb_upstream', response.status);
    try {
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error('not_array');
      return payload;
    } catch { throw new IgdbError('igdb_bad_response', response.status); }
  }

  const request = (body: string, retryAuth = true) => requestEndpoint('games', body, retryAuth);

  async function aliasGameIds(query: any) {
    const escaped = escapeSearch(query);
    if (!escaped) return [];
    const filter = `fields game,name; where name ~ *"${escaped}"*; limit 50;`;
    const [aliases, localizations] = await Promise.all([
      requestEndpoint('alternative_names', filter).catch(() => []),
      requestEndpoint('game_localizations', filter).catch(() => []),
    ]);
    return unique([...aliases, ...localizations].map(item => Number(item?.game)))
      .filter(id => Number.isInteger(id) && id > 0)
      .slice(0, 24);
  }

  async function search(query: any, { aliases = true }: { aliases?: boolean } = {}) {
    const normalized = String(query || '').trim().toLocaleLowerCase();
    const cacheKey = `${aliases ? 'aliases' : 'direct'}:${normalized}`;
    const cached = searchCache.get(cacheKey);
    if (cached && now() - cached.cachedAt < SEARCH_CACHE_MS) return cached.value;
    const running = searchInflight.get(cacheKey);
    if (running) return running;

    const task = (async () => {
      const direct = parseIgdbReference(query);
      const body = direct
        ? `fields ${GAME_FIELDS}; where id = ${direct} & version_parent = null; limit 1;`
        : `search "${escapeSearch(query)}"; fields ${GAME_FIELDS}; where version_parent = null; limit ${SEARCH_LIMIT};`;
      let rows = await request(body);
      if (aliases && !direct && !rows.length) {
        const ids = await aliasGameIds(query);
        if (ids.length) rows = await request(`fields ${GAME_FIELDS}; where id = (${ids.join(',')}) & version_parent = null; limit ${SEARCH_LIMIT};`);
      }
      const results = rows.map(row => mapIgdbGame(row, { now: now(), query })).filter(Boolean);
      for (const game of results) detailCache.set(game!.igdb_id, { value: game, cachedAt: now() });
      const value = { results };
      searchCache.set(cacheKey, { value, cachedAt: now() });
      return value;
    })();
    searchInflight.set(cacheKey, task);
    try { return await task; }
    finally { searchInflight.delete(cacheKey); }
  }

  async function gameDetail(id: any, { force = false }: { force?: boolean } = {}) {
    const igdbId = Number(id);
    if (!Number.isInteger(igdbId) || igdbId <= 0) throw new IgdbError('invalid_igdb_id');
    const cached = detailCache.get(igdbId);
    if (!force && cached && now() - cached.cachedAt < DETAIL_CACHE_MS) return cached.value;
    const rows = await request(`fields ${GAME_FIELDS}; where id = ${igdbId} & version_parent = null; limit 1;`);
    const game = mapIgdbGame(rows[0], { now: now() });
    if (!game) throw new IgdbError('igdb_not_found', 404);
    detailCache.set(igdbId, { value: game, cachedAt: now() });
    return game;
  }

  return { isConfigured: () => { const cfg = config(); return Boolean(cfg.clientId && cfg.clientSecret); }, search, gameDetail };
}
