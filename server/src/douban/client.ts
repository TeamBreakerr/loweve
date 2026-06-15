// server/src/douban/client.js
// 豆瓣评分：纯 HTTP，不依赖 Playwright。
//   ① 搜索 movie.douban.com/j/subject_suggest?q=片名 → 候选 {id,title,year,type,sub_title}
//   ② 标题相似度 + 年份 选最佳候选
//   ③ m.douban.com/rexxar/api/v2/{movie|tv}/{id} → rating.value / rating.count
// 接口（.match）与旧的 browser-svc 版本保持一致，queue.js 不用改。
const DEFAULT_TIMEOUT_MS = 15000;
const UA_PC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

export class DoubanError extends Error {
  code: string; status: number; body: any;
  constructor(code: any, status: any, body: any) {
    super(code);
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

const norm = (s: any) => String(s || '').toLowerCase().replace(/[\s·:：!！?？.,。、…\-—_()（）\[\]【】"'""'']/g, '');

// 候选标题与查询标题的字符集重合比例（占查询标题）
function charOverlap(nq: any, nc: any) {
  if (!nq || !nc) return 0;
  const sc = new Set(nc);
  let inter = 0;
  for (const ch of new Set(nq)) if (sc.has(ch)) inter++;
  return inter / new Set(nq).size;
}

function titleScore(query: any, cand: any) {
  const nq = norm(query), nc = norm(cand);
  if (!nq || !nc) return 0;
  if (nq === nc) return 1;
  if (nc.includes(nq) || nq.includes(nc)) return 0.85;
  return charOverlap(nq, nc) >= 0.6 ? 0.6 : 0;
}

function yearScore(qy: any, cy: any) {
  if (!qy || !cy) return 0.5;           // 缺年份 → 中性
  const d = Math.abs(qy - cy);
  return d <= 1 ? 1 : d <= 3 ? 0.5 : 0; // 豆瓣年份常与 TMDB 差 1
}

// 从 subject_suggest 候选里选最佳；标题对不上（score 太低）返回 null，避免错配同名。
// names = 作品全部名字（中文名/原标题/英文名/AKA）；缺省回退 [title]。
export function pickBest(cands: any, { title, year, names }: any) {
  const nameList = ((names && names.length) ? names : [title]).filter(Boolean);
  let best: any = null, bestScore = 0;
  for (const c of cands) {
    let ts = 0;
    for (const n of nameList) ts = Math.max(ts, titleScore(n, c.title), titleScore(n, c.sub_title));
    if (ts <= 0) continue;
    const score = ts * 0.65 + yearScore(year, parseInt(c.year, 10) || null) * 0.35;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 0.5 ? best : null;
}

export function createDoubanClient({ fetch = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: { fetch?: any; timeoutMs?: number } = {}) {
  async function getJson(url: any, headers: any) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: any;
    try {
      res = await fetch(url, { headers, signal: ctrl.signal });
    } catch (e) {
      throw new DoubanError('douban_network', 0, { message: e.message });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new DoubanError('douban_upstream', res.status, null);
    return res.json();
  }

  async function suggest(q: any) {
    const sug = await getJson(
      'https://movie.douban.com/j/subject_suggest?q=' + encodeURIComponent(q),
      { 'User-Agent': UA_PC, Referer: 'https://movie.douban.com/' });
    return Array.isArray(sug) ? sug.filter(s => s && s.id && (s.type === 'movie' || s.type === 'tv')) : [];
  }

  async function match({ title, year, names }: any) {
    // 检索仍用中文 title（豆瓣中文库召回最好）；匹配打分用全部名字集合
    let best = pickBest(await suggest(title), { title, year, names });
    if (!best) {
      // 全名搜不到（常见于"片名+年份+特别篇/季"这类冗长标题）→ 退成"片名 年份"再搜一次
      const simplified = title.replace(/\s*(\d{4})\D.*$/, ' $1').trim();
      if (simplified && simplified !== title) best = pickBest(await suggest(simplified), { title, year, names });
    }
    if (!best) return null;

    const id = String(best.id);
    const kind = best.type === 'tv' ? 'tv' : 'movie';
    const detail = await getJson(
      `https://m.douban.com/rexxar/api/v2/${kind}/${id}?for_mobile=1`,
      { 'User-Agent': UA_MOBILE, Referer: `https://m.douban.com/movie/subject/${id}/` });

    const val = detail?.rating?.value;
    if (!(val > 0)) return null;          // 豆瓣无有效评分 → 不升级，保持 TMDB

    return {
      douban_id: id,
      rating: Number(val),
      votes: detail.rating.count != null ? Number(detail.rating.count) : null,
      url: `https://movie.douban.com/subject/${id}/`,
      matched_title: best.title,
      matched_year: parseInt(best.year, 10) || null,
    };
  }

  return { match };
}
