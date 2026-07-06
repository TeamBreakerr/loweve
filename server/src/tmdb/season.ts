// server/src/tmdb/season.js
// 季号 → 中文标签「第N季」（供作品标题 + 豆瓣/Bangumi 按季匹配）。支持 1–99。
const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function cnNumber(n: number): string {
  if (!Number.isInteger(n) || n <= 0) return String(n);
  if (n < 10) return CN[n];
  if (n === 10) return '十';
  if (n < 20) return '十' + CN[n % 10];
  const tens = Math.floor(n / 10), ones = n % 10;
  return CN[tens] + '十' + (ones ? CN[ones] : '');
}

export function seasonLabel(n: number): string {
  return `第${cnNumber(n)}季`;
}
