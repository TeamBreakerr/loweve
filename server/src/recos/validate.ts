// server/src/recos/validate.js
// LLM 返回的标题用 TMDB 搜索核实真实存在；仅搜索，不拉详情、不触发任何评分升级。

function normalize(s: any) {
  return String(s || '').toLowerCase().replace(/[\s\p{P}]+/gu, '').trim();
}

function levenshtein(a: any, b: any) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function nameSim(a: any, b: any) {
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return 0;
  const d = levenshtein(x, y);
  return 1 - d / Math.max(x.length, y.length);
}

function yearScore(candYear: any, wantYear: any) {
  if (!wantYear || !candYear) return 0.5;            // 缺年份给中性分
  const diff = Math.abs(candYear - wantYear);
  if (diff === 0) return 1;
  if (diff === 1) return 0.7;
  if (diff === 2) return 0.4;
  return 0;
}

function scoreCandidate(c: any, { title, year, type }: any) {
  const sim = Math.max(nameSim(title, c.title), nameSim(title, c.original_title));
  const typeBonus = type && c.tmdb_type === type ? 0.05 : 0;
  return sim * 0.7 + yearScore(c.year, year) * 0.3 + typeBonus;
}

export async function resolveTmdb(tmdb: any, { title, year, type }: any) {
  if (!title) return null;
  // LLM 时常给「剧名 第N季」，带季号在 TMDB 搜索会失配；剥掉季号按剧名搜（打分也用剥后标题）
  title = String(title).replace(/\s*第\s*[一二三四五六七八九十\d]{1,3}\s*季$/u, '').trim() || title;
  let data: any;
  try { data = await tmdb.search(title); }
  catch { return null; }                              // 搜索失败 → 当未命中，丢弃该条
  // 要求候选有年份：无年份基本是 TMDB stub / LLM 软幻觉模糊命中的垃圾条目，推荐里不要。
  const cands = (data?.results || []).filter((r: any) => r.tmdb_id && (r.tmdb_type === 'movie' || r.tmdb_type === 'tv') && r.year);
  if (!cands.length) return null;
  let best: any = null, bestScore = 0;
  for (const c of cands) {
    const s = scoreCandidate(c, { title, year, type });
    if (s > bestScore) { bestScore = s; best = c; }
  }
  if (!best || bestScore < 0.6) return null;
  return { tmdb_id: best.tmdb_id, tmdb_type: best.tmdb_type };
}
