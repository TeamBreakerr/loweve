// server/src/bangumi/client.js
const BASE = 'https://api.bgm.tv';
const TIMEOUT_MS = 5000;

export class BangumiError extends Error {
  constructor(code, status, body) {
    super(code);
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

export function createBangumiClient({ userAgent, resolve, fetch = globalThis.fetch } = {}) {
  // 静态值或 resolve()（运行时从 DB 读）
  const getCfg = resolve || (() => ({ userAgent }));

  async function request(path, { method = 'GET', body } = {}) {
    const headers = {
      'User-Agent': getCfg().userAgent,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${BASE}${path}`, {
        method, headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new BangumiError('bangumi_network', 0, { message: e.message });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new BangumiError('bangumi_upstream', res.status, b);
    }
    return res.json();
  }

  function mapItem(s) {
    return {
      bangumi_id: s.id,
      name: s.name || null,
      name_cn: s.name_cn || null,
      year: parseInt((s.date || '').slice(0, 4), 10) || null,
      score: s.rating?.score ?? null,
      votes: s.rating?.total ?? null,
      poster_url: s.images?.large || null,
    };
  }

  return {
    isConfigured() { return Boolean(getCfg().userAgent); },

    async searchAnime(keyword) {
      const data = await request('/v0/search/subjects?limit=10', {
        method: 'POST',
        body: { keyword, filter: { type: [2] } },
      });
      return (data.data || []).map(mapItem);
    },

    async subjectDetail(id) {
      return mapItem(await request(`/v0/subjects/${id}`));
    },
  };
}
