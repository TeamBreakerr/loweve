// server/src/bangumi/matcher.js
// 给定 TMDB 作品 + Bangumi 候选，返回最佳可信匹配或 null。

const ACCEPT_TOTAL = 0.6;   // 综合分阈值
const ACCEPT_NAME = 0.5;    // 名称相似度下限（防纯蒙年份）

// 归一化 Levenshtein 相似度：1 - dist/maxLen，范围 [0,1]
export function similarity(a: any, b: any) {
  a = (a || '').trim().toLowerCase();
  b = (b || '').trim().toLowerCase();
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return 1 - dp[m][n] / Math.max(m, n);
}

function nameScore(tmdb: any, cand: any) {
  // TMDB 的全部名字（names：原名/中文名/英文名/AKA；缺省回退原名+中文名）对候选 name/name_cn 取最高相似度
  const tmdbNames = ((tmdb.names && tmdb.names.length) ? tmdb.names : [tmdb.original_title, tmdb.title]).filter(Boolean);
  const candNames = [cand.name, cand.name_cn].filter(Boolean);
  let best = 0;
  for (const t of tmdbNames) for (const c of candNames) best = Math.max(best, similarity(t, c));
  return best;
}

function yearScore(tmdbYear: any, candYear: any) {
  if (tmdbYear == null || candYear == null) return 0.5;  // 缺年份中性
  const diff = Math.abs(tmdbYear - candYear);
  if (diff === 0) return 1;
  if (diff === 1) return 0.5;
  return 0;
}

const ZH = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 } as Record<string, number>;
const ROMAN = { Ⅱ: 2, Ⅲ: 3, Ⅳ: 4, Ⅴ: 5, II: 2, III: 3, IV: 4, V: 5 } as Record<string, number>;
// 从一个名称里提取「季/续作序号」，默认 1。番剧续作（2/第二季/2nd Season…）不该匹配到第一季，反之亦然。
function seasonNum(name: any) {
  if (!name) return 1;
  const s = String(name).normalize('NFKC').trim();  // 全角２→2
  let m;
  if ((m = s.match(/第\s*([0-9]+|[一二三四五六七八九十]+)\s*[季期部篇]/))) return /^[0-9]+$/.test(m[1]) ? parseInt(m[1], 10) : (ZH[m[1]] || 1);
  if ((m = s.match(/(?:season|part|cour)\s*([0-9]+)/i))) return parseInt(m[1], 10);
  if ((m = s.match(/\b([0-9]+)(?:st|nd|rd|th)\b/i))) return parseInt(m[1], 10);
  if ((m = s.match(/(?:^|\s)(Ⅱ|Ⅲ|Ⅳ|Ⅴ|II|III|IV|V)\s*$/))) return ROMAN[m[1]] || 1;
  // 结尾独立小数字（前面是空格 / 标点 / 字母 / 假名 / 汉字），如「… 2」「Edgerunners２」
  if ((m = s.match(/(?:[\s:：·・\-]|[a-z぀-ヿ一-鿿])([2-9])$/i))) return parseInt(m[1], 10);
  return 1;
}
function seasonOf(names: any[]) {
  let s = 1;
  for (const n of names) s = Math.max(s, seasonNum(n));
  return s;
}

export function matchAnime(tmdb: any, candidates: any) {
  const tmdbSeason = seasonOf([tmdb.title, tmdb.original_title]);
  let best: any = null, bestTotal = 0, bestName = 0;
  for (const c of candidates || []) {
    const nScore = nameScore(tmdb, c);
    const yScore = yearScore(tmdb.year, c.year);
    let total = 0.7 * nScore + 0.3 * yScore;
    // 季号不一致重罚：避免把「赛博朋克边缘行者2」匹配到「赛博朋克边缘行者」
    if (seasonOf([c.name, c.name_cn]) !== tmdbSeason) total -= 0.5;
    if (total > bestTotal) { bestTotal = total; bestName = nScore; best = c; }
  }
  if (best && bestTotal >= ACCEPT_TOTAL && bestName >= ACCEPT_NAME) return best;
  return null;
}
