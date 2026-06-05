// server/src/tmdb/client.js
const BASE = 'https://api.themoviedb.org/3';
const DEFAULT_RETRY_DELAYS = [500, 2000, 8000];  // ms
const TIMEOUT_MS = 5000;

export class TmdbError extends Error {
  code: string; status: number; body: any;
  constructor(code, status, body) {
    super(code);
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

// 把 search/movie 或 search/tv 的单条结果映射成统一形状（含内部 popularity 用于排序）
export function mapTitleResult(r, type) {
  return {
    tmdb_id: r.id,
    tmdb_type: type,
    title: r.title || r.name || '',
    original_title: r.original_title || r.original_name || null,
    year: parseInt((r.release_date || r.first_air_date || '').slice(0, 4), 10) || null,
    poster_path: r.poster_path || null,
    overview: r.overview || null,
    vote_average: r.vote_average || null,
    popularity: r.popularity || 0,
    via: null,
  };
}

// 从人物的 combined_credits 提取作品：导演作品(crew job=Director) + 主演作品(cast 前 8 热门)
// 每条标 via「导演 X」/「主演 X」，便于前端展示"为什么出现"
export function expandPersonCredits(credits, personName) {
  const map = (c, via) => ({
    tmdb_id: c.id,
    tmdb_type: c.media_type === 'tv' ? 'tv' : 'movie',
    title: c.title || c.name || '',
    original_title: c.original_title || c.original_name || null,
    year: parseInt((c.release_date || c.first_air_date || '').slice(0, 4), 10) || null,
    poster_path: c.poster_path || null,
    overview: c.overview || null,
    vote_average: c.vote_average || null,
    popularity: c.popularity || 0,
    via,
  });
  const films = [];
  for (const c of (credits.crew || [])) {
    if (c.job === 'Director' && (c.media_type === 'movie' || c.media_type === 'tv')) {
      films.push(map(c, `导演 ${personName}`));
    }
  }
  const cast = (credits.cast || [])
    .filter(c => c.media_type === 'movie' || c.media_type === 'tv')
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 8);
  for (const c of cast) films.push(map(c, `主演 ${personName}`));
  const seen = new Set();
  return films
    .filter(f => { const k = f.tmdb_type + ':' + f.tmdb_id; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 12);  // 高产导演作品很多，截前 12 防刷屏
}

// 多个结果列表合并去重（按 tmdb_type:tmdb_id），保序，去掉内部 popularity 字段
export function mergeDedupe(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const r of (list || [])) {
      const k = r.tmdb_type + ':' + r.tmdb_id;
      if (!seen.has(k)) { seen.add(k); const { popularity, ...rest } = r; out.push(rest); }
    }
  }
  return out;
}

export function createTmdbClient({ token, key, resolve, fetch = globalThis.fetch, retryDelays = DEFAULT_RETRY_DELAYS }: { token?: string; key?: string; resolve?: () => any; fetch?: any; retryDelays?: number[] } = {}) {
  // 静态值或 resolve()（运行时从 DB 读，设置页改完即时生效）
  const getCfg = resolve || (() => ({ token, key }));

  function buildUrl(path, params = {}) {
    const { token, key } = getCfg();
    const p = new URLSearchParams({ language: 'zh-CN', region: 'CN', ...params });
    if (!token && key) p.set('api_key', key);
    return `${BASE}${path}?${p}`;
  }

  async function request(path, params) {
    const { token } = getCfg();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const url = buildUrl(path, params);
    const delays = [0, ...retryDelays];
    let lastErr;
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
      let res;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        res = await fetch(url, { headers, signal: ctrl.signal });
        clearTimeout(timer);
      } catch (e) {
        lastErr = new TmdbError('tmdb_network', 0, { message: e.message });
        continue;  // 重试网络错
      }
      if (res.ok) return await res.json();
      const body = await res.json().catch(() => ({}));
      if (res.status >= 400 && res.status < 500) {
        // 4xx 不重试
        throw new TmdbError(res.status === 401 ? 'tmdb_auth' : 'tmdb_client', res.status, body);
      }
      lastErr = new TmdbError('tmdb_upstream', res.status, body);
      // 5xx 继续重试
    }
    throw lastErr;
  }

  return {
    isConfigured() { const c = getCfg(); return Boolean(c.token || c.key); },

    async search(q) {
      // 并行搜电影/剧/人物，开 include_adult（私有 app）。电影/剧失败→整体失败（route 转 502）；
      // 人物是可选增强（按导演/演员维度补充作品），失败静默忽略。
      const params = { query: q, include_adult: 'true' };
      const [mv, tv, pe] = await Promise.all([
        request('/search/movie', params),
        request('/search/tv', params),
        request('/search/person', params).catch(() => ({ results: [] })),
      ]);

      const titleResults = [
        ...(mv.results || []).map(r => mapTitleResult(r, 'movie')),
        ...(tv.results || []).map(r => mapTitleResult(r, 'tv')),
      ].sort((a, b) => b.popularity - a.popularity);

      let personResults = [];
      const person = (pe.results || [])[0];
      if (person?.id) {
        try {
          const credits = await request(`/person/${person.id}/combined_credits`, {});
          personResults = expandPersonCredits(credits, person.name);
        } catch { /* 人物作品拉取失败不影响主搜索 */ }
      }

      // 标题命中优先，人物作品补充未出现的；mergeDedupe 去掉内部 popularity；截前 30
      return { results: mergeDedupe(titleResults, personResults).slice(0, 30) };
    },

    movieDetail(id) {
      return request(`/movie/${id}`, { append_to_response: 'external_ids' });
    },

    tvDetail(id) {
      return request(`/tv/${id}`, { append_to_response: 'external_ids' });
    },
  };
}
