// server/src/recos/taste.ts
// 口味画像：按 评分×题材 做确定性统计，置信度=样本量，喂给 prompt 让 LLM 沿高置信方向推荐。
// 只做正向推断——「看什么」是兴趣信号（选择即偏好），「评几分」只评价那部片本身：
// 高分+足量 → 偏爱；常看+低分 → 爱看但常踩雷（对题材有兴趣，该推口碑佳作，而非避开）。
// 不从低分反推「讨厌题材」：低分大概率只是那几部片子烂。

const LOVE_N = 3;        // 成为「偏爱」方向的最小样本量
const HIGH_N = 6;        // 高置信样本量
const LOVE_AVG = 8;      // 偏爱：均分 ≥ 8
const BURNED_N = 5;      // 爱看但常踩雷：看得足够多（兴趣毋庸置疑）……
const BURNED_AVG = 7;    // ……但均分 < 7（老挑到烂片）

// works.genres 是题材名 JSON 数组；番剧当伪题材参与统计（接受度本身就是口味方向）
function parseGenres(w: any): string[] {
  let g: string[] = [];
  try { const p = JSON.parse(w.genres || '[]'); if (Array.isArray(p)) g = p; } catch { /* 脏数据当无题材 */ }
  return w.is_anime ? ['番剧', ...g] : g;
}

function pickDirections(samples: { genres: string[]; rating: number }[]) {
  const m = new Map<string, { n: number; sum: number }>();
  for (const s of samples) for (const g of s.genres) {
    const e = m.get(g) || { n: 0, sum: 0 };
    e.n++; e.sum += s.rating;
    m.set(g, e);
  }
  const all = [...m.entries()].map(([genre, { n, sum }]) => ({ genre, n, avg: sum / n }));
  return {
    loved: all.filter(e => e.n >= LOVE_N && e.avg >= LOVE_AVG).sort((a, b) => b.avg - a.avg || b.n - a.n).slice(0, 6),
    burned: all.filter(e => e.n >= BURNED_N && e.avg < BURNED_AVG).sort((a, b) => b.n - a.n || a.avg - b.avg).slice(0, 4),
  };
}

const fmtDir = (list: any[]) =>
  list.map(e => `${e.genre}（均${e.avg.toFixed(1)}分×${e.n}部，${e.n >= HIGH_N ? '高' : '中'}置信）`).join('、');

// 输入是 gatherContext 的产物（marks/sessions 行需带 genres/is_anime）。数据不足时返回 []。
export function tasteProfileLines({ userA, userB, marksA, marksB, sessions }: any): string[] {
  const personSamples = (marks: any[], ratingKey: string) => [
    ...marks.filter((m: any) => m.rating != null).map((m: any) => ({ genres: parseGenres(m), rating: m.rating })),
    ...sessions.filter((s: any) => s[ratingKey] != null).map((s: any) => ({ genres: parseGenres(s), rating: s[ratingKey] })),
  ];

  const lines: string[] = [];
  for (const [name, samples] of [
    [userA, personSamples(marksA, 'rating_a')],
    [userB, personSamples(marksB, 'rating_b')],
  ] as any) {
    const { loved, burned } = pickDirections(samples);
    if (loved.length) lines.push(`- ${name} 偏爱：${fmtDir(loved)}`);
    if (burned.length) lines.push(`- ${name} 爱看但常踩雷（对题材有兴趣，只是老挑到烂片）：${fmtDir(burned)}`);
  }

  // 共同口味：两人都打了分的共看记录，按两人中较低分统计——短板决定这次一起看得爽不爽
  const joint = sessions
    .filter((s: any) => s.rating_a != null && s.rating_b != null)
    .map((s: any) => ({ genres: parseGenres(s), rating: Math.min(s.rating_a, s.rating_b) }));
  const { loved: jointLoved } = pickDirections(joint);
  if (jointLoved.length) lines.push(`- 两人一起看时都满意（按两人中较低分统计）：${fmtDir(jointLoved)}`);

  if (!lines.length) return [];
  return ['# 口味画像（后台按 评分×题材 统计；置信度=样本量；「番剧」作为题材参与）：', ...lines];
}
