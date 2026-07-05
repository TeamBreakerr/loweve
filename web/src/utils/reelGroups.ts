// 「一起看过」滚筒的分组逻辑：sessions → 年→月分组（新→旧）→ 滚筒扁平格子。
// 从 TogetherReel.vue 原样抽出，行为不变。
import type { Session } from '../types';

const MONTHS = ['', '1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

export function ymOf(s: Session) {
  const w = s.watched_at;
  if (!w) return { year: null as number | null, month: 0 };
  const m = Math.floor(w / 100) % 100;
  return { year: Math.floor(w / 10000), month: m >= 1 && m <= 12 ? m : 0 };
}

export interface MonthGroup { m: number; mLabel: string; gid: string; sessions: Session[] }
export interface YearGroup { year: number; months: MonthGroup[] }

export function buildYears(sessions: Session[]): YearGroup[] {
  const byYear = new Map<number, Map<number, Session[]>>();
  const unknown: Session[] = [];
  for (const s of sessions) {
    const { year, month } = ymOf(s);
    if (year == null) { unknown.push(s); continue; }
    if (!byYear.has(year)) byYear.set(year, new Map());
    const mm = byYear.get(year)!;
    if (!mm.has(month)) mm.set(month, []);
    mm.get(month)!.push(s);
  }
  const res: YearGroup[] = [...byYear.keys()].sort((a, b) => b - a).map(year => ({
    year,
    months: [...byYear.get(year)!.keys()].sort((a, b) => b - a).map(m => ({
      m, mLabel: m ? MONTHS[m] : '年内', gid: `g-${year}-${m}`, sessions: byYear.get(year)!.get(m)!,
    })),
  }));
  if (unknown.length) res.push({ year: 0, months: [{ m: 0, mLabel: '未知', gid: 'g-0-0', sessions: unknown }] });
  return res;
}

export interface DrumCell { y: number; m: number; yLabel: string; mLabel: string; gid: string; poster: string }

export function buildGroups(years: YearGroup[], posterOf: (s: Session | undefined) => string): DrumCell[] {
  const g: DrumCell[] = [];
  for (const y of years) for (const mo of y.months) {
    g.push({ y: y.year, m: mo.m, yLabel: y.year ? String(y.year) : '·', mLabel: mo.mLabel, gid: mo.gid, poster: posterOf(mo.sessions[0]) });
  }
  return g;
}
