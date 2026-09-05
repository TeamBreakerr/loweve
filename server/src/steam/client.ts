// Steam 商店数据源：搜索、商店详情、国区价格与官方评测汇总。
// 只使用公开商店端点，不绑定用户 Steam 账号，也不需要新增密钥。

const STORE = 'https://store.steampowered.com';
// Steam 的「多人 / PvP」不等同于适合情侣合作；默认推荐只认合作类能力。
const TOGETHER_CATEGORY_IDS = new Set([9, 38, 39, 48]);
const CACHE_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
export const STEAM_OFFER_PARSER_VERSION = 3;

export class SteamError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 0) {
    super(code);
    this.name = 'SteamError';
    this.code = code;
    this.status = status;
  }
}

export function parseSteamReference(value: any) {
  const text = String(value || '').trim();
  if (/^\d{1,10}$/.test(text)) return Number(text);
  const match = text.match(/store\.steampowered\.com\/app\/(\d+)/i);
  return match ? Number(match[1]) : null;
}

function reviewSummary(payload: any) {
  const q = payload?.query_summary || {};
  const positive = Number(q.total_positive) || 0;
  const negative = Number(q.total_negative) || 0;
  const total = Number(q.total_reviews) || positive + negative;
  return {
    score: Number.isInteger(q.review_score) ? q.review_score : null,
    desc: q.review_score_desc || null,
    positive,
    negative,
    total,
    percent: total > 0 ? Math.round(positive * 100 / total) : null,
  };
}

export function parseRecentReviewSummary(html: any) {
  const text = String(html || '').replace(/&nbsp;/g, ' ');
  const zh = text.match(/过去\s*30\s*天内的\s*([\d,]+)\s*篇用户评测中有\s*(\d+)%\s*为好评/u);
  const en = text.match(/(\d+)%\s+of\s+the\s+([\d,]+)\s+user reviews in the last 30 days are positive/i);
  const total = Number((zh?.[1] || en?.[2] || '').replace(/,/g, '')) || 0;
  const percent = Number(zh?.[2] || en?.[1]);
  if (!total || !Number.isInteger(percent)) return null;
  const positive = Math.round(total * percent / 100);
  return {
    success: 1,
    query_summary: {
      review_score: null,
      review_score_desc: '近期评测',
      total_positive: positive,
      total_negative: Math.max(0, total - positive),
      total_reviews: total,
    },
  };
}

function shanghaiDateParts(now: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now));
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

/** Steam appdetails 不提供促销期限；从商品页的官方倒计时或促销提示中读取。 */
export function parseDiscountEndDate(html: any, now = Date.now()) {
  const raw = String(html || '');
  const referenceNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const timerDeadlines = [...raw.matchAll(/InitDailyDeal(?:Timer|Countdown)\s*\(\s*[^,]+,\s*(\d{9,13})\s*\)/gi)]
    .map(match => Number(match[1]))
    .map(timestamp => timestamp >= 1_000_000_000_000 ? timestamp : timestamp * 1000)
    .filter(timestamp => Number.isFinite(timestamp) && timestamp >= referenceNow - 5 * 60 * 1000);
  if (timerDeadlines.length) {
    const deadline = shanghaiDateParts(timerDeadlines[0]);
    return `${deadline.year}-${String(deadline.month).padStart(2, '0')}-${String(deadline.day).padStart(2, '0')}`;
  }
  const countdowns = [...raw.matchAll(/<p[^>]*class=["'][^"']*game_purchase_discount_countdown[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)]
    .map(match => match[1]);
  const text = (countdowns.length ? countdowns.join(' ') : raw)
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ');
  const zh = text.match(/(?:每日特惠|特别促销|特惠|促销|优惠)[\s\S]{0,80}?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*截止/u);
  const en = text.match(/offer\s+ends\s+([A-Za-z]+)\s+(\d{1,2})/i);
  const enDayFirst = text.match(/offer\s+ends\s+(\d{1,2})\s+([A-Za-z]+)/i);
  const monthNames: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const month = zh ? Number(zh[1]) : monthNames[String(en?.[1] || enDayFirst?.[2] || '').toLowerCase()];
  const day = Number(zh?.[2] || en?.[2] || enDayFirst?.[1]);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31) return null;
  const current = shanghaiDateParts(referenceNow);
  const year = month < current.month || (month === current.month && day < current.day)
    ? current.year + 1 : current.year;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function jsonNames(list: any) {
  return JSON.stringify(Array.isArray(list) ? list.filter(Boolean) : []);
}

function parseReleaseYear(text: any) {
  const match = String(text || '').match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function priceFrom(data: any) {
  const price = data?.price_overview;
  if (data?.is_free) {
    return {
      price_currency: 'CNY', initial_price: 0, current_price: 0,
      discount_percent: 0, price_formatted: '免费',
    };
  }
  if (!price) {
    return {
      price_currency: null, initial_price: null, current_price: null,
      discount_percent: 0, price_formatted: null,
    };
  }
  return {
    price_currency: price.currency || 'CNY',
    initial_price: Number.isInteger(price.initial) ? price.initial : null,
    current_price: Number.isInteger(price.final) ? price.final : null,
    discount_percent: Number(price.discount_percent) || 0,
    price_formatted: price.final_formatted || null,
  };
}

export function mapSteamGame({ zh, en, reviews, recentReviews, discountEndDate, country = 'CN', now = Date.now() }: any) {
  if (!zh || !['game', 'dlc'].includes(zh.type) || !Number.isInteger(zh.steam_appid)) return null;
  const genres = Array.isArray(zh.genres) ? zh.genres : [];
  const categories = Array.isArray(zh.categories) ? zh.categories : [];
  const earlyAccess = genres.some((g: any) =>
    Number(g.id) === 70 || /early\s*access|抢先体验/i.test(String(g.description || '')));
  const releaseText = zh.release_date?.date || null;
  const releaseState = earlyAccess ? 'early_access' : (zh.release_date?.coming_soon ? 'unreleased' : 'released');
  const playModes = categories.map((c: any) => ({ id: Number(c.id), description: c.description })).filter((c: any) => c.id);
  const overall = reviewSummary(reviews);
  const recent = reviewSummary(recentReviews);
  const appid = Number(zh.steam_appid);
  const parentSteamAppid = Number(zh.fullgame?.appid);
  const originalTitle = en?.name && en.name !== zh.name ? en.name : null;

  return {
    steam_appid: appid,
    content_type: zh.type === 'dlc' ? 'dlc' : 'game',
    parent_igdb_id: null,
    parent_steam_appid: zh.type === 'dlc' && Number.isInteger(parentSteamAppid) && parentSteamAppid > 0
      ? parentSteamAppid : null,
    parent_title: zh.type === 'dlc' ? zh.fullgame?.name || en?.fullgame?.name || null : null,
    title: zh.name,
    original_title: originalTitle,
    release_date: releaseText,
    release_year: parseReleaseYear(releaseText),
    release_state: releaseState,
    is_free: zh.is_free ? 1 : 0,
    short_description: zh.short_description || null,
    about_game: zh.about_the_game || zh.detailed_description || null,
    developers: jsonNames(zh.developers),
    publishers: jsonNames(zh.publishers),
    genres: jsonNames(genres.map((g: any) => g.description)),
    platforms: JSON.stringify(zh.platforms || {}),
    play_modes: JSON.stringify(playModes),
    supports_together: playModes.some((m: any) => TOGETHER_CATEGORY_IDS.has(m.id)) ? 1 : 0,
    cover_url: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900_2x.jpg`,
    header_url: zh.header_image || zh.capsule_image || null,
    ...priceFrom(zh),
    // 空字符串表示商品页已检查但未公布截止日；null 留给旧数据触发一次回填。
    discount_end_date: Number(zh.price_overview?.discount_percent) > 0 ? discountEndDate || '' : null,
    review_score: overall.score,
    review_desc: overall.desc,
    review_positive: overall.positive,
    review_negative: overall.negative,
    review_total: overall.total,
    review_percent: overall.percent,
    recent_review_score: recent.score,
    recent_review_desc: recent.desc,
    recent_review_positive: recent.positive,
    recent_review_negative: recent.negative,
    recent_review_total: recent.total,
    recent_review_percent: recent.percent,
    steam_raw: JSON.stringify({ ...zh, _loweve_offer_parser_version: STEAM_OFFER_PARSER_VERSION }),
    reviews_raw: JSON.stringify({ overall: reviews || null, recent: recentReviews || null }),
    store_country: country,
    fetched_at: now,
    updated_at: now,
    store_url: `${STORE}/app/${appid}/`,
  };
}

export function createSteamClient({ fetch = globalThis.fetch, now = () => Date.now() }: { fetch?: any; now?: () => number } = {}) {
  const cache = new Map<number, { at: number; game: any }>();
  const detailInflight = new Map<number, Promise<any>>();
  const searchCache = new Map<string, { at: number; value: any }>();
  const searchInflight = new Map<string, Promise<any>>();
  const candidateCache = new Map<string, { at: number; value: any }>();
  const candidateInflight = new Map<string, Promise<any>>();

  async function getJson(url: URL) {
    let res: any;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; loweve/1.0; +https://github.com/)',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        },
      });
    } catch (e: any) {
      throw new SteamError(e?.name === 'TimeoutError' ? 'steam_timeout' : 'steam_network');
    }
    if (!res.ok) throw new SteamError('steam_upstream', res.status);
    try { return await res.json(); }
    catch { throw new SteamError('steam_bad_response', res.status); }
  }

  async function getText(url: URL) {
    let res: any;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; loweve/1.0; +https://github.com/)',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
          Cookie: 'birthtime=0; lastagecheckage=1-January-1970; wants_mature_content=1; timezoneOffset=28800,0',
        },
      });
    } catch (e: any) {
      throw new SteamError(e?.name === 'TimeoutError' ? 'steam_timeout' : 'steam_network');
    }
    if (!res.ok) throw new SteamError('steam_upstream', res.status);
    return res.text();
  }

  const appDetailsUrl = (appid: number, language: string, country = 'CN') => {
    const url = new URL(`${STORE}/api/appdetails`);
    url.searchParams.set('appids', String(appid));
    url.searchParams.set('cc', country);
    url.searchParams.set('l', language);
    return url;
  };

  const reviewsUrl = (appid: number, {
    language = 'all', filter = 'all', numPerPage = 1,
  }: { language?: string; filter?: string; numPerPage?: number } = {}) => {
    const url = new URL(`${STORE}/appreviews/${appid}`);
    url.searchParams.set('json', '1');
    url.searchParams.set('language', language);
    url.searchParams.set('purchase_type', 'all');
    url.searchParams.set('review_type', 'all');
    url.searchParams.set('filter', filter);
    url.searchParams.set('day_range', '365');
    url.searchParams.set('num_per_page', String(numPerPage));
    return url;
  };

  const storePageUrl = (appid: number, country = 'CN') => {
    const url = new URL(`${STORE}/app/${appid}/`);
    url.searchParams.set('cc', country);
    url.searchParams.set('l', 'schinese');
    return url;
  };

  async function gameDetail(appid: any, { force = false }: { force?: boolean } = {}) {
    appid = Number(appid);
    if (!Number.isInteger(appid) || appid <= 0) throw new SteamError('invalid_steam_appid');
    const hit = cache.get(appid);
    if (!force && hit && now() - hit.at < CACHE_MS) return hit.game;
    const running = !force ? detailInflight.get(appid) : null;
    if (running) return running;

    const task = (async () => {
      const loadRegion = async (country: string) => {
        const [zhPayload, enPayload] = await Promise.all([
          getJson(appDetailsUrl(appid, 'schinese', country)),
          getJson(appDetailsUrl(appid, 'english', country)).catch(() => null),
        ]);
        const entry = zhPayload?.[String(appid)];
        return entry?.success && entry.data
          ? { country, zh: entry.data, en: enPayload?.[String(appid)]?.data || null }
          : null;
      };
      // 评测和常见的国区商品页不依赖 appdetails，提前并发可省掉一整段网络往返。
      const reviewsPromise = getJson(reviewsUrl(appid)).catch(() => null);
      const cnStorePagePromise = getText(storePageUrl(appid, 'CN')).catch(() => '');
      // 国区优先；国区不可见时回退国际区。Steam 中同一游戏可能存在地区独立 AppID。
      const detail = await loadRegion('CN').catch(() => null) || await loadRegion('US').catch(() => null);
      if (!detail) throw new SteamError('steam_not_found', 404);
      // Steam 会让已停用的旧 AppID 返回现有商品的数据，例如 380370 -> 435150。
      // appreviews 不会跟随这个映射，因此详情确认规范 AppID 后必须改用它重抓评测和商品页。
      const canonicalAppid = Number(detail.zh?.steam_appid);
      const redirected = Number.isInteger(canonicalAppid) && canonicalAppid > 0 && canonicalAppid !== appid;
      const [reviews, storePage] = await Promise.all([
        redirected ? getJson(reviewsUrl(canonicalAppid)).catch(() => null) : reviewsPromise,
        redirected
          ? getText(storePageUrl(canonicalAppid, detail.country)).catch(() => '')
          : detail.country === 'CN'
            ? cnStorePagePromise
            : getText(storePageUrl(appid, detail.country)).catch(() => ''),
      ]);
      const game = mapSteamGame({
        zh: detail.zh, en: detail.en, country: detail.country, reviews,
        recentReviews: parseRecentReviewSummary(storePage),
        discountEndDate: parseDiscountEndDate(storePage, now()), now: now(),
      });
      if (!game) throw new SteamError('steam_not_game', 400);
      const cached = { at: now(), game };
      cache.set(appid, cached);
      // 旧、新 ID 指向同一规范商品，后续任一 ID 查询都直接复用正确结果。
      cache.set(game.steam_appid, cached);
      return game;
    })();
    if (!force) detailInflight.set(appid, task);
    try { return await task; }
    finally { if (!force) detailInflight.delete(appid); }
  }

  async function search(query: any) {
    const q = String(query || '').trim();
    if (!q) return { results: [] };
    const direct = parseSteamReference(q);
    if (direct) {
      try { return { results: [await gameDetail(direct)] }; }
      catch (e) { if (e.code === 'steam_not_game' || e.code === 'steam_not_found') return { results: [] }; throw e; }
    }

    const cacheKey = q.toLocaleLowerCase();
    const cached = searchCache.get(cacheKey);
    if (cached && now() - cached.at < CACHE_MS) return cached.value;
    const running = searchInflight.get(cacheKey);
    if (running) return running;

    const task = (async () => {
      const searchRegion = (country: string) => {
        const url = new URL(`${STORE}/api/storesearch/`);
        url.searchParams.set('term', q);
        url.searchParams.set('l', 'schinese');
        url.searchParams.set('cc', country);
        return getJson(url);
      };
      const payloads = await Promise.allSettled([searchRegion('CN'), searchRegion('US')]);
      const available = payloads.filter(result => result.status === 'fulfilled').map((result: any) => result.value);
      if (!available.length) throw (payloads[0] as PromiseRejectedResult).reason;
      const ids = [...new Set(available.flatMap(payload => payload?.items || [])
        .filter((item: any) => item?.type === 'app' && Number.isInteger(item.id))
        .map((item: any) => item.id))]
        .slice(0, 8) as number[];
      const details = await Promise.all(ids.map((id: number) => gameDetail(id).catch(() => null)));
      const value = { results: details.filter(Boolean) };
      searchCache.set(cacheKey, { at: now(), value });
      return value;
    })();
    searchInflight.set(cacheKey, task);
    try { return await task; }
    finally { searchInflight.delete(cacheKey); }
  }

  async function hotReviews(appid: any, limit = 3) {
    const id = Number(appid);
    if (!Number.isInteger(id) || id <= 0) throw new SteamError('invalid_steam_appid');
    const count = Math.max(3, Math.min(20, Number(limit) || 3));
    let payload = await getJson(reviewsUrl(id, {
      language: 'schinese', filter: 'toprated', numPerPage: count,
    }));
    if (!(payload?.reviews || []).length) {
      payload = await getJson(reviewsUrl(id, {
        language: 'all', filter: 'toprated', numPerPage: count,
      }));
    }
    return (payload?.reviews || [])
      .filter((item: any) => String(item?.review || '').trim())
      .slice(0, count)
      .map((item: any) => {
        const steamId = String(item.author?.steamid || '');
        return {
          id: String(item.recommendationid),
          author: steamId ? `Steam 玩家 · ${steamId.slice(-4)}` : 'Steam 玩家',
          avatar_url: null,
          content: String(item.review).trim(),
          rating: null,
          votes: Number(item.votes_up) || null,
          created_at: Number(item.timestamp_created)
            ? new Date(Number(item.timestamp_created) * 1000).toISOString() : null,
          url: `${STORE}/app/${id}/#app_reviews_hash`,
          sentiment: item.voted_up === false ? 'negative' : 'positive',
          playtime_hours: Number(item.author?.playtime_forever)
            ? Math.round(Number(item.author.playtime_forever) / 6) / 10 : null,
        };
      });
  }

  /** 仅用于中文别名身份桥：拿商店搜索中的 AppID 与中英文标题，不抓详情/评测/商品页。 */
  async function searchCandidates(query: any) {
    const q = String(query || '').trim();
    if (!q) return { results: [] };
    const cacheKey = q.toLocaleLowerCase();
    const cached = candidateCache.get(cacheKey);
    if (cached && now() - cached.at < CACHE_MS) return cached.value;
    const running = candidateInflight.get(cacheKey);
    if (running) return running;

    const task = (async () => {
      const requests = ([
        ['CN', 'schinese'], ['CN', 'english'], ['US', 'schinese'], ['US', 'english'],
      ] as const).map(([country, language]) => {
        const url = new URL(`${STORE}/api/storesearch/`);
        url.searchParams.set('term', q);
        url.searchParams.set('l', language);
        url.searchParams.set('cc', country);
        return getJson(url).then(payload => ({ country, language, payload }));
      });
      const settled = await Promise.allSettled(requests);
      const available = settled.filter(result => result.status === 'fulfilled').map((result: any) => result.value);
      if (!available.length) throw (settled[0] as PromiseRejectedResult).reason;
      const byId = new Map<number, any>();
      for (const { country, language, payload } of available) {
        for (const item of payload?.items || []) {
          const appid = Number(item?.id);
          if (item?.type !== 'app' || !Number.isInteger(appid) || appid <= 0) continue;
          const entry = byId.get(appid) || {
            steam_appid: appid, catalog_source: 'steam', content_type: 'game',
            title: null, original_title: null, cover_url: item.tiny_image || null,
          };
          const name = String(item?.name || '').trim();
          if (language === 'schinese' && (!entry.title || (country === 'CN' && /\p{Script=Han}/u.test(name)))) entry.title = name;
          if (language === 'english' && (!entry.original_title || country === 'CN')) entry.original_title = name;
          byId.set(appid, entry);
        }
      }
      const results = [...byId.values()].slice(0, 8).map(item => ({
        ...item,
        title: item.title || item.original_title,
        original_title: item.original_title && item.original_title !== item.title ? item.original_title : null,
      })).filter(item => item.title);
      const value = { results };
      candidateCache.set(cacheKey, { at: now(), value });
      return value;
    })();
    candidateInflight.set(cacheKey, task);
    try { return await task; }
    finally { candidateInflight.delete(cacheKey); }
  }

  return { isConfigured: () => true, search, searchCandidates, gameDetail, hotReviews };
}
