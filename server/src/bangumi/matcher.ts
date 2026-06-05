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
  // TMDB 的 original_title / title 对 候选 name / name_cn 取最高相似度
  const tmdbNames = [tmdb.original_title, tmdb.title].filter(Boolean);
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

export function matchAnime(tmdb: any, candidates: any) {
  let best: any = null, bestTotal = 0, bestName = 0;
  for (const c of candidates || []) {
    const nScore = nameScore(tmdb, c);
    const yScore = yearScore(tmdb.year, c.year);
    const total = 0.7 * nScore + 0.3 * yScore;
    if (total > bestTotal) { bestTotal = total; bestName = nScore; best = c; }
  }
  if (best && bestTotal >= ACCEPT_TOTAL && bestName >= ACCEPT_NAME) return best;
  return null;
}
