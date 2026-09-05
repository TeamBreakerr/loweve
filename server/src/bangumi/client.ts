// server/src/bangumi/client.js
const BASE = 'https://api.bgm.tv';
const SITE = 'https://bgm.tv';
const TIMEOUT_MS = 5000;

export class BangumiError extends Error {
  code: string; status: number; body: any;
  constructor(code: any, status: any, body: any) {
    super(code);
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

export function createBangumiClient({ userAgent, resolve, fetch = globalThis.fetch }: { userAgent?: string; resolve?: () => any; fetch?: any } = {}) {
  // 静态值或 resolve()（运行时从 DB 读）
  const getCfg = resolve || (() => ({ userAgent }));

  async function request(path: string, { method = 'GET', body }: { method?: string; body?: any } = {}) {
    const headers = {
      'User-Agent': getCfg().userAgent,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: any;
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

  async function requestPage(path: string) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: any;
    try {
      res = await fetch(`${SITE}${path}`, {
        headers: { 'User-Agent': getCfg().userAgent, Accept: 'text/html' },
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new BangumiError('bangumi_network', 0, { message: e.message });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BangumiError('bangumi_upstream', res.status, body);
    }
    return res.text();
  }

  function decodeHtml(value: any) {
    const named: Record<string, string> = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#039': "'", nbsp: ' ',
    };
    return String(value || '').replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z0-9]+);/gi, (whole, entity) => {
      if (entity[0] === '#') {
        const hex = entity[1]?.toLowerCase() === 'x';
        const point = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
      }
      return named[entity.toLowerCase()] ?? whole;
    });
  }

  function pageText(value: any) {
    return decodeHtml(String(value || '')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ''))
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .trim();
  }

  function pageReviews(html: any, subjectId: number, count: number) {
    const page = String(html || '');
    let likes: Record<string, any> = {};
    const likesJson = page.match(/\bvar\s+data_likes_list\s*=\s*(\{[\s\S]*?\});/i)?.[1];
    if (likesJson) {
      try { likes = JSON.parse(likesJson); } catch { /* 上游脚本变化时按 0 赞降级 */ }
    }
    const voteCount = (reactionId: string | undefined) => reactionId
      ? Object.values(likes[reactionId] || {}).reduce((sum: number, reaction: any) => sum + (Number(reaction?.total) || 0), 0)
      : 0;

    return page.split(/<div\s+class=["']item clearit["'][^>]*>/i).slice(1)
      .map((item, index) => {
        const comment = item.match(/<p\s+class=["']comment["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
        if (!comment) return null;
        const userId = item.match(/data-item-user=["']([^"']+)["']/i)?.[1] || '';
        const reactionId = item.match(/id=["']likes_grid_([^"']+)["']/i)?.[1];
        const authorHtml = item.match(/<a\b[^>]*class=["'][^"']*\bl\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1];
        const avatar = item.match(/background-image\s*:\s*url\((?:["'])?([^"')]+)(?:["'])?\)/i)?.[1] || null;
        const rating = Number(item.match(/\bstars([0-9]{1,2})\b/i)?.[1]) || null;
        return {
          id: reactionId || `${userId || 'comment'}-${index + 1}`,
          author: pageText(authorHtml) || userId || 'Bangumi 用户',
          avatar_url: avatar ? (avatar.startsWith('//') ? `https:${avatar}` : avatar) : null,
          content: pageText(comment),
          rating,
          votes: voteCount(reactionId) || null,
          created_at: null,
          url: `${SITE}/subject/${subjectId}/comments`,
        };
      })
      .filter((item: any): item is Record<string, any> => Boolean(item?.content))
      .slice(0, count);
  }

  function mapItem(s: any) {
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

    async searchAnime(keyword: any) {
      const data = await request('/v0/search/subjects?limit=10', {
        method: 'POST',
        body: { keyword, filter: { type: [2] } },
      });
      return (data.data || []).map(mapItem);
    },

    async subjectDetail(id: any) {
      return mapItem(await request(`/v0/subjects/${id}`));
    },

    async hotReviews(id: any, limit = 3) {
      const subjectId = Number(id);
      if (!Number.isInteger(subjectId) || subjectId <= 0) throw new BangumiError('bangumi_invalid_subject', 0, null);
      const count = Math.max(3, Math.min(20, Number(limit) || 3));
      return pageReviews(await requestPage(`/subject/${subjectId}/comments`), subjectId, count);
    },
  };
}
