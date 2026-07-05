// server/src/routes/works.js
import { Router } from 'express';
import { mapMovie, mapTv } from '../tmdb/mapper.js';
import { matchAnime } from '../bangumi/matcher.js';
import { enqueueDoubanUpgrade } from '../douban/queue.js';
import type { Work } from '../../../shared/types.js';

const WORK_COLS = `id, tmdb_id, tmdb_type, title, original_title, aka_titles, year, overview, genres,
  runtime, is_anime, primary_rating, primary_rating_count, primary_poster_url, rating_source,
  bangumi_id, douban_id, douban_url, imdb_id, fetched_at, updated_at`;

// 作品的全部可比名字：原标题 + 中文名 + 英文名/AKA（aka_titles），去重去空。
// 豆瓣（中文库）/Bangumi（日文库）匹配时都拿这一套去比候选名，统一逻辑、提高命中。
export function workNames(work: any): string[] {
  let akas: string[] = [];
  try { akas = JSON.parse(work.aka_titles || '[]') || []; } catch { /* noop */ }
  const set = new Set<string>();
  for (const n of [work.original_title, work.title, ...akas]) {
    if (n && String(n).trim()) set.add(String(n).trim());
  }
  return [...set];
}

// upsertWork：work 不存在则调 tmdb 拉详情入库；存在直接返回。番剧再尝试 Bangumi 升级。
// 暴露为函数，便于 marks/sessions/plan 复用。
export async function upsertWork(db: any, tmdb: any, bangumi: any, douban: any, { tmdb_id, tmdb_type, skipUpgrade = false }: any) {
  const existing = db.prepare(`SELECT ${WORK_COLS} FROM works WHERE tmdb_id = ? AND tmdb_type = ?`).get(tmdb_id, tmdb_type);
  if (existing) {
    // 自愈：已入库但仍 tmdb 的作品（如推荐 skipUpgrade 纯 tmdb 入库，或 browser-svc 重启窗口升级失败）
    // → 重新尝试评分升级：番剧同步 Bangumi、电影异步豆瓣；已升级的（rating_source≠tmdb）跳过。
    if (!skipUpgrade && existing.rating_source === 'tmdb') {
      if (existing.is_anime && bangumi?.isConfigured?.()) {
        try { return await upgradeWithBangumi(db, bangumi, existing); }
        catch (e) { console.warn('[bangumi] upgrade failed for work', existing.id, e.message); }
      } else if (!existing.is_anime && douban?.match) {
        enqueueDoubanUpgrade(db, douban, existing.id);   // 非动画电影 + 剧集都抓豆瓣（剧集取最贴年份的那一季）
      }
    }
    return existing;
  }

  const payload = tmdb_type === 'movie'
    ? await tmdb.movieDetail(tmdb_id)
    : await tmdb.tvDetail(tmdb_id);
  const mapped = tmdb_type === 'movie' ? mapMovie(payload) : mapTv(payload);
  const now = Date.now();

  const insert = db.prepare(`
    INSERT INTO works (
      tmdb_id, tmdb_type, title, original_title, aka_titles, year, overview, genres, runtime,
      is_anime, primary_rating, primary_rating_count, primary_poster_url, rating_source,
      bangumi_id, douban_id, douban_url, imdb_id, tmdb_raw, bangumi_raw, douban_raw,
      fetched_at, updated_at
    ) VALUES (
      @tmdb_id, @tmdb_type, @title, @original_title, @aka_titles, @year, @overview, @genres, @runtime,
      @is_anime, @primary_rating, @primary_rating_count, @primary_poster_url, @rating_source,
      @bangumi_id, @douban_id, @douban_url, @imdb_id, @tmdb_raw, @bangumi_raw, @douban_raw,
      @fetched_at, @updated_at
    )
  `);
  const info = insert.run({ ...mapped, fetched_at: now, updated_at: now });
  let work = db.prepare(`SELECT ${WORK_COLS} FROM works WHERE id = ?`).get(info.lastInsertRowid);

  // —— 评分升级（best-effort）；skipUpgrade=true 时纯 tmdb 入库，零抓取（推荐验证用）——
  if (!skipUpgrade) {
    if (work.is_anime && bangumi?.isConfigured?.()) {
      try {
        work = await upgradeWithBangumi(db, bangumi, work);
      } catch (e) {
        console.warn('[bangumi] upgrade failed for work', work.id, e.message);
      }
    } else if (!work.is_anime && douban?.match) {
      enqueueDoubanUpgrade(db, douban, work.id);   // 非动画电影 + 剧集都抓豆瓣
    }
  }
  return work;
}

// work 行已含 original_title（WORK_COLS），不依赖只在首次插入时才有的 mapped，
// 便于 existing 分支（推荐 want / 自愈）复用。
async function upgradeWithBangumi(db: any, bangumi: any, work: any) {
  const keyword = work.original_title || work.title;
  const candidates = await bangumi.searchAnime(keyword);
  // 匹配时用「全部名字集合」：原标题 + 中文名 + 英文名/AKA（aka_titles）
  const best = matchAnime(
    { title: work.title, original_title: work.original_title, names: workNames(work), year: work.year },
    candidates
  );
  if (!best) return work;  // 无可信匹配，保持 tmdb

  db.prepare(`UPDATE works SET
    primary_rating = @rating,
    primary_rating_count = @votes,
    primary_poster_url = COALESCE(@poster, primary_poster_url),
    rating_source = 'bangumi',
    bangumi_id = @bid,
    bangumi_raw = @raw,
    updated_at = @now
    WHERE id = @id`).run({
      rating: best.score ?? null,
      votes: best.votes ?? null,
      poster: best.poster_url ?? null,
      bid: best.bangumi_id,
      raw: JSON.stringify(best),
      now: Date.now(),
      id: work.id,
    });
  return db.prepare(`SELECT ${WORK_COLS} FROM works WHERE id = ?`).get(work.id);
}

export function worksRoutes() {
  const router = Router();

  router.post('/', async (req, res) => {
    const db = req.app.locals.db;
    const tmdb = req.app.locals.tmdb;
    const { tmdb_id, tmdb_type } = req.body || {};
    if (!Number.isInteger(tmdb_id)) return res.status(400).json({ error: 'tmdb_id_required' });
    if (tmdb_type !== 'movie' && tmdb_type !== 'tv') return res.status(400).json({ error: 'tmdb_type_required' });

    try {
      const work = await upsertWork(db, tmdb, req.app.locals.bangumi, req.app.locals.douban, { tmdb_id, tmdb_type });
      res.json(work satisfies Work);
    } catch (e) {
      const code = e.code || 'tmdb_unknown';
      res.status(502).json({ error: code, message: e.message });
    }
  });

  router.get('/:id', (req, res) => {
    const db = req.app.locals.db;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });

    const work = db.prepare(`SELECT ${WORK_COLS} FROM works WHERE id = ?`).get(id);
    if (!work) return res.status(404).json({ error: 'not_found' });

    const all_marks = db.prepare('SELECT id, user_id, work_id, status, rating, comment, marked_at FROM user_marks WHERE work_id = ?').all(id);
    const my_mark = req.viewing_user_id ? all_marks.find((m: any) => m.user_id === req.viewing_user_id) || null : null;
    const sessions = db.prepare('SELECT id, work_id, watched_at, rating_a, rating_b, review_a, review_b, joint_note, created_at FROM couple_sessions WHERE work_id = ? ORDER BY watched_at DESC').all(id);
    const plan = db.prepare('SELECT id, work_id, added_by, note, priority, status, created_at, updated_at FROM plan_items WHERE work_id = ?').get(id) || null;

    res.json({ ...work, my_mark, all_marks, sessions, plan } satisfies Work);
  });

  return router;
}
