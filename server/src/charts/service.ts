// 榜单添加：把豆瓣 / Bangumi 的评分排行榜拉成统一条目，并标注本地状态（已在库 / 我看过 / 一起看过 / 想看），
// 供添加弹窗系统性补完记录。榜单变化很慢，按页缓存在 app_state（跨重启），失败时回落过期缓存。
import { getState, setState } from '../recos/state.js';
import { resolveTmdbCandidate } from '../recos/validate.js';

export type ChartKey = 'douban_top250' | 'bangumi_anime';
export type ChartItem = {
  source: 'douban' | 'bangumi';
  source_id: string;
  rank: number | null;
  title: string;
  original_title: string | null;
  year: number | null;
  kind: 'movie' | 'tv';
  score: number | null;
  votes: number | null;
  poster_url: string | null;
  subtitle: string | null;
  url: string;
};

export const CHARTS: Record<ChartKey, { label: string; source: 'douban' | 'bangumi'; pageSize: number }> = {
  douban_top250: { label: '豆瓣电影 Top250', source: 'douban', pageSize: 50 },
  bangumi_anime: { label: 'Bangumi 动画排行', source: 'bangumi', pageSize: 20 },
};
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export function isChartKey(k: any): k is ChartKey { return k === 'douban_top250' || k === 'bangumi_anime'; }

async function fetchPage(deps: any, chart: ChartKey, page: number): Promise<{ total: number | null; items: ChartItem[] }> {
  const { pageSize } = CHARTS[chart];
  const offset = (page - 1) * pageSize;
  if (chart === 'douban_top250') {
    const { total, items } = await deps.douban.collectionItems('movie_top250', { start: offset, count: pageSize });
    return {
      total,
      items: items.map((it: any) => ({
        source: 'douban', source_id: it.douban_id, rank: it.rank, title: it.title, original_title: null,
        year: it.year, kind: it.kind, score: it.score, votes: it.votes, poster_url: it.poster_url,
        subtitle: it.subtitle, url: it.url,
      })),
    };
  }
  const { total, items } = await deps.bangumi.rankAnime({ offset, limit: pageSize });
  return {
    total,
    items: items.map((it: any, i: number) => {
      const title = it.name_cn || it.name || '';
      return {
        source: 'bangumi', source_id: String(it.bangumi_id), rank: it.rank ?? offset + i + 1,
        title, original_title: it.name && it.name !== title ? it.name : null,
        year: it.year, kind: it.platform === '剧场版' ? 'movie' : 'tv', score: it.score, votes: it.votes,
        poster_url: it.poster_url, subtitle: it.platform || null, url: it.url,
      };
    }),
  };
}

// 按页缓存；上游失败时若有过期缓存则照用（榜单本身几乎不变，宁可旧也不要空）
async function loadPage(db: any, deps: any, chart: ChartKey, page: number) {
  const key = `chart:${chart}:${page}`;
  const raw = getState(db, key);
  let cached: { fetched_at: number; total: number | null; items: ChartItem[] } | null = null;
  if (raw) { try { cached = JSON.parse(raw); } catch { cached = null; } }
  if (cached && Date.now() - cached.fetched_at < CACHE_TTL_MS) return cached;
  try {
    const fresh = { fetched_at: Date.now(), ...(await fetchPage(deps, chart, page)) };
    setState(db, key, JSON.stringify(fresh));
    return fresh;
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
}

// 本地状态标注：优先按豆瓣/Bangumi id 对上作品，对不上的按（标题, 年份）兜底——
// 电影的豆瓣 id 是异步升级写入的，刚入库的作品可能还没有。
function annotate(db: any, items: ChartItem[], viewingUserId: number | null) {
  if (!items.length) return [];
  const byDouban = db.prepare('SELECT id, douban_id FROM works WHERE douban_id = ?');
  const byBangumi = db.prepare('SELECT id FROM works WHERE bangumi_id = ?');
  const byTitle = db.prepare('SELECT id FROM works WHERE title = ? AND (year = ? OR ? IS NULL) ORDER BY season_number IS NOT NULL, id LIMIT 1');
  const mine = db.prepare(`SELECT 1 FROM user_marks WHERE user_id = ? AND work_id = ? AND status = 'watched'`);
  const couple = db.prepare('SELECT 1 FROM couple_sessions WHERE work_id = ?');
  const plan = db.prepare(`SELECT 1 FROM plan_items WHERE work_id = ? AND status = 'pending'`);
  return items.map((it) => {
    let work: any = it.source === 'douban' ? byDouban.get(it.source_id) : byBangumi.get(Number(it.source_id));
    if (!work) work = byTitle.get(it.title, it.year, it.year);
    const workId = work?.id ?? null;
    return {
      ...it,
      work_id: workId,
      mine: Boolean(workId && viewingUserId && mine.get(viewingUserId, workId)),
      couple: Boolean(workId && couple.get(workId)),
      plan: Boolean(workId && plan.get(workId)),
    };
  });
}

export async function getChartPage(db: any, deps: any, { chart, page, viewingUserId }: { chart: ChartKey; page: number; viewingUserId: number | null }) {
  const { label, pageSize } = CHARTS[chart];
  const data = await loadPage(db, deps, chart, page);
  const total = data.total ?? null;
  return {
    chart, label, page, page_size: pageSize, total,
    has_more: total != null ? page * pageSize < total : data.items.length === pageSize,
    fetched_at: data.fetched_at,
    items: annotate(db, data.items, viewingUserId),
  };
}

// 榜单条目 → 添加弹窗可用的 TMDB 候选。已在库的直接用本地作品；否则 TMDB 搜索按标题+年份择优
// （Bangumi 条目中文名搜不到再用原名兜底）。
export async function resolveChartItem(db: any, deps: any, it: Partial<ChartItem>) {
  const source = it.source === 'bangumi' ? 'bangumi' : 'douban';
  const local = source === 'douban'
    ? db.prepare('SELECT id, tmdb_id, tmdb_type, title, year, primary_poster_url FROM works WHERE douban_id = ? AND season_number IS NULL').get(String(it.source_id))
    : db.prepare('SELECT id, tmdb_id, tmdb_type, title, year, primary_poster_url FROM works WHERE bangumi_id = ? AND season_number IS NULL').get(Number(it.source_id));
  if (local) {
    return { tmdb_id: local.tmdb_id, tmdb_type: local.tmdb_type, title: local.title, year: local.year, poster_url: local.primary_poster_url, via: '已在库' };
  }
  const type = it.kind === 'movie' ? 'movie' : it.kind === 'tv' ? 'tv' : undefined;
  let best = await resolveTmdbCandidate(deps.tmdb, { title: it.title, year: it.year, type, strictType: true });
  if (!best && it.original_title) best = await resolveTmdbCandidate(deps.tmdb, { title: it.original_title, year: it.year, type, strictType: true });
  if (!best) return null;
  return { tmdb_id: best.tmdb_id, tmdb_type: best.tmdb_type, title: best.title, year: best.year, poster_path: best.poster_path ?? null, original_title: best.original_title ?? null, via: source === 'douban' ? '豆瓣榜单' : 'Bangumi 榜单' };
}
