// 看完日期：存成 YYYYMMDD 整数，月/日未知填 00（只到年=YYYY0000，到月=YYYYMM00）。
// 复用现有整数列：排序与「按年分组」照常工作。

export function decodeWatched(n) {
  if (!n) return { year: null, month: 0, day: 0 };
  return { year: Math.floor(n / 10000), month: Math.floor(n / 100) % 100, day: n % 100 };
}

// year 为空 → null（无日期）；月需有年、日需有月，否则置 0；日按当月天数夹紧。
export function encodeWatched(year, month, day) {
  const y = parseInt(year, 10);
  if (!y) return null;
  let m = parseInt(month, 10) || 0;
  if (m < 1 || m > 12) m = 0;
  let d = m ? (parseInt(day, 10) || 0) : 0;
  if (m && d) {
    const dim = new Date(y, m, 0).getDate();
    if (d < 1) d = 0;
    if (d > dim) d = dim;
  }
  return y * 10000 + m * 100 + d;
}

const pad = (x) => String(x).padStart(2, '0');

// 完整形式，按精度："2026" / "2026-03" / "2026-06-02"（可加后缀如 " 看完"）
export function fmtWatched(n, suffix = '') {
  const { year, month, day } = decodeWatched(n);
  if (!year) return '';
  let s = `${year}`;
  if (month) s += `-${pad(month)}`;
  if (month && day) s += `-${pad(day)}`;
  return s + suffix;
}

// 紧凑形式（首页小卡）：完整→"MM-DD"，到月→"YYYY-MM"，到年→"YYYY"
export function fmtWatchedShort(n) {
  const { year, month, day } = decodeWatched(n);
  if (!year) return '';
  if (!month) return `${year}`;
  if (!day) return `${year}-${pad(month)}`;
  return `${pad(month)}-${pad(day)}`;
}
