// server/src/routes/works.js
import { Router } from 'express';
import { listMovieSessions } from '../experiences/service.js';
import { mapMovie, mapTv } from '../tmdb/mapper.js';
import { seasonLabel } from '../tmdb/season.js';
import { matchAnime } from '../bangumi/matcher.js';
import { enqueueDoubanUpgrade } from '../douban/queue.js';
import type { Work } from '../../../shared/types.js';

const WORK_COLS = `id, tmdb_id, tmdb_type, season_number, title, original_title, aka_titles, year, overview, genres,
  runtime, is_anime, primary_rating, primary_rating_count, primary_poster_url, rating_source,
  bangumi_id, douban_id, douban_url, imdb_id, fetched_at, updated_at`;

function parseObject(raw: any): Record<string, any> {
  if (!raw) return {};
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function asNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 从 TMDB/豆瓣/Bangumi 原始响应中抽出详情页需要的稳定字段。
 * 原始响应不直接返回，避免详情接口体积随着上游字段增长。
 */
export function makeWorkDetails(work: any): Record<string, any> {
  const tmdb = parseObject(work.tmdb_raw);
  const douban = parseObject(work.douban_raw);
  const bangumi = parseObject(work.bangumi_raw);
  const type = work.tmdb_type === 'tv' ? 'tv' : 'movie';
  const releaseDate = tmdb.release_date || tmdb.first_air_date || null;
  const countries = (tmdb.production_countries || []).map((item: any) => item?.name).filter(Boolean);
  const fallbackCountries = Array.isArray(tmdb.origin_country) ? tmdb.origin_country : [];
  const spokenLanguages = (tmdb.spoken_languages || []).map((item: any) => item?.english_name || item?.name).filter(Boolean);
  const companies = (tmdb.production_companies || []).map((item: any) => item?.name).filter(Boolean);
  const directors = (tmdb.credits?.crew || [])
    .filter((item: any) => item?.job === 'Director' || item?.department === 'Directing')
    .map((item: any) => item?.name)
    .filter(Boolean)
    .slice(0, 4);
  const cast = (tmdb.credits?.cast || [])
    .map((item: any) => ({ name: item?.name, character: item?.character }))
    .filter((item: any) => item.name)
    .slice(0, 8);
  const trailer = (tmdb.videos?.results || []).find((item: any) =>
    item?.site === 'YouTube' && (item?.type === 'Trailer' || item?.type === 'Teaser'));

  return {
    backdrop_url: tmdb.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tmdb.backdrop_path}` : null,
    tagline: tmdb.tagline || null,
    release_date: releaseDate,
    status: tmdb.status || null,
    original_language: tmdb.original_language || null,
    countries: countries.length ? countries : fallbackCountries,
    spoken_languages: spokenLanguages,
    production_companies: companies.slice(0, 5),
    directors,
    cast,
    tmdb_rating: asNumber(tmdb.vote_average),
    tmdb_rating_count: asNumber(tmdb.vote_count),
    douban_rating: asNumber(douban.rating),
    douban_rating_count: asNumber(douban.votes),
    bangumi_rating: asNumber(bangumi.score),
    bangumi_rating_count: asNumber(bangumi.votes),
    trailer_url: trailer?.key ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    homepage: tmdb.homepage || null,
    imdb_id: tmdb.external_ids?.imdb_id || tmdb.imdb_id || work.imdb_id || null,
    tmdb_url: `https://www.themoviedb.org/${type}/${work.tmdb_id}`,
  };
}

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
export async function upsertWork(db: any, tmdb: any, bangumi: any, douban: any, { tmdb_id, tmdb_type, season_number = null, skipUpgrade = false }: any) {
  // 身份含季维度：COALESCE(NULL,-1) 让「整部」与各季各自唯一、互不误判为已存在。
  const existing = db.prepare(`SELECT ${WORK_COLS} FROM works WHERE tmdb_id = ? AND tmdb_type = ? AND COALESCE(season_number,-1) = COALESCE(?,-1)`).get(tmdb_id, tmdb_type, season_number);
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
  const mapped: any = tmdb_type === 'movie' ? mapMovie(payload) : mapTv(payload);
  mapped.season_number = null;
  // 分季：拉该季 TMDB 详情，用季标题/海报/首播年覆盖剧集主体。标题带「第N季」既直接在卡片显示，
  // 又驱动豆瓣/Bangumi 按季匹配（豆瓣 suggest(title) 搜到该季条目；Bangumi matcher 的 seasonOf
  // 从标题提取季号、惩罚不符项）。genres/is_anime 沿用剧集主体。
  if (tmdb_type === 'tv' && season_number != null) {
    const sd = await tmdb.tvSeasonDetail(tmdb_id, season_number);
    mapped.season_number = season_number;
    mapped.title = `${mapped.title} ${seasonLabel(season_number)}`;
    mapped.year = parseInt((sd.air_date || '').slice(0, 4), 10) || mapped.year;
    if (sd.poster_path) mapped.primary_poster_url = `https://image.tmdb.org/t/p/w500${sd.poster_path}`;
    if (sd.overview) mapped.overview = sd.overview;
  }
  const now = Date.now();

  const insert = db.prepare(`
    INSERT INTO works (
      tmdb_id, tmdb_type, season_number, title, original_title, aka_titles, year, overview, genres, runtime,
      is_anime, primary_rating, primary_rating_count, primary_poster_url, rating_source,
      bangumi_id, douban_id, douban_url, imdb_id, tmdb_raw, bangumi_raw, douban_raw,
      fetched_at, updated_at
    ) VALUES (
      @tmdb_id, @tmdb_type, @season_number, @title, @original_title, @aka_titles, @year, @overview, @genres, @runtime,
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
export async function upgradeWithBangumi(db: any, bangumi: any, work: any) {
  const names = workNames(work);
  let best: any = null;
  let searched = false;
  let lastError: any = null;
  // Bangumi 的中文、日文和英文检索召回差异很大；逐个尝试已有名字，命中即停。
  // 这同时覆盖 TMDB 中文译名与 Bangumi 中文名不同的作品，不依赖作品 ID 特判。
  for (const keyword of names) {
    try {
      const candidates = await bangumi.searchAnime(keyword);
      searched = true;
      best = matchAnime({
        title: work.title,
        original_title: work.original_title,
        names,
        year: work.year,
        season_number: work.season_number,
      }, candidates);
      if (best) break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!searched && lastError) throw lastError;
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

export function sweepStuckBangumi(db: any, bangumi: any, { delayMs = 1000 } = {}) {
  if (!bangumi?.isConfigured?.()) return { ids: [], done: Promise.resolve() };
  const rows = db.prepare(`SELECT ${WORK_COLS} FROM works
    WHERE rating_source = 'tmdb' AND is_anime = 1 ORDER BY id`).all();
  const done = (async () => {
    for (let index = 0; index < rows.length; index++) {
      const work = rows[index];
      try {
        await upgradeWithBangumi(db, bangumi, work);
      } catch (error) {
        console.warn('[bangumi] sweep failed for work', work.id, error?.message);
      }
      if (delayMs && index < rows.length - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  })();
  return { ids: rows.map((work: any) => work.id), done };
}

export function worksRoutes() {
  const router = Router();

  // 添加弹窗的前置重复探测。最终写入接口仍各自做约束，避免并发竞态绕过。
  router.get('/duplicate', (req, res) => {
    if (!req.viewing_user_id) return res.status(401).json({ error: 'not_authenticated' });
    const db = req.app.locals.db;
    const target = req.query.target;
    if (!['watched', 'couple_watched', 'couple_plan'].includes(target as string)) {
      return res.status(400).json({ error: 'invalid_target' });
    }

    let work: any;
    if (req.query.work_id !== undefined) {
      const workId = parseInt(req.query.work_id as string, 10);
      if (!Number.isInteger(workId)) return res.status(400).json({ error: 'invalid_work_id' });
      work = db.prepare('SELECT id FROM works WHERE id = ?').get(workId);
    } else {
      const tmdbId = parseInt(req.query.tmdb_id as string, 10);
      const tmdbType = req.query.tmdb_type;
      if (!Number.isInteger(tmdbId) || (tmdbType !== 'movie' && tmdbType !== 'tv')) {
        return res.status(400).json({ error: 'invalid_work_identity' });
      }
      let seasonNumber: number | null = null;
      if (req.query.season_number !== undefined && req.query.season_number !== '') {
        seasonNumber = parseInt(req.query.season_number as string, 10);
        if (!Number.isInteger(seasonNumber)) return res.status(400).json({ error: 'invalid_season_number' });
      }
      work = db.prepare(`SELECT id FROM works
        WHERE tmdb_id = ? AND tmdb_type = ?
        AND COALESCE(season_number, -1) = COALESCE(?, -1)`)
        .get(tmdbId, tmdbType, seasonNumber);
    }

    if (!work) return res.json({ duplicate: false });
    if (target === 'watched') {
      const found = db.prepare('SELECT 1 FROM user_marks WHERE user_id = ? AND work_id = ?').get(req.viewing_user_id, work.id);
      return res.json(found ? { duplicate: true, error: 'mark_exists' } : { duplicate: false });
    }
    if (target === 'couple_watched') {
      const found = db.prepare('SELECT 1 FROM couple_sessions WHERE work_id = ?').get(work.id);
      return res.json(found ? { duplicate: true, error: 'session_exists' } : { duplicate: false });
    }
    const found = db.prepare('SELECT 1 FROM plan_items WHERE work_id = ?').get(work.id);
    return res.json(found ? { duplicate: true, error: 'plan_exists' } : { duplicate: false });
  });

  router.post('/', async (req, res) => {
    const db = req.app.locals.db;
    const tmdb = req.app.locals.tmdb;
    const { tmdb_id, tmdb_type, season_number } = req.body || {};
    if (!Number.isInteger(tmdb_id)) return res.status(400).json({ error: 'tmdb_id_required' });
    if (tmdb_type !== 'movie' && tmdb_type !== 'tv') return res.status(400).json({ error: 'tmdb_type_required' });

    try {
      const work = await upsertWork(db, tmdb, req.app.locals.bangumi, req.app.locals.douban, { tmdb_id, tmdb_type, season_number });
      res.json(work satisfies Work);
    } catch (e) {
      const code = e.code || 'tmdb_unknown';
      res.status(502).json({ error: code, message: e.message });
    }
  });

  router.get('/:id/hot-reviews', async (req, res) => {
    const db = req.app.locals.db;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });
    const work: any = db.prepare(`SELECT id, tmdb_type, is_anime, bangumi_id, douban_id, douban_url
      FROM works WHERE id = ?`).get(id);
    if (!work) return res.status(404).json({ error: 'not_found' });

    const douban = work.douban_id && req.app.locals.douban?.hotReviews ? {
      source: 'douban', source_label: '豆瓣',
      source_url: work.douban_url || `https://movie.douban.com/subject/${work.douban_id}/`,
      load: () => req.app.locals.douban.hotReviews(work.douban_id, work.tmdb_type, 3),
    } : null;
    const bangumi = work.bangumi_id && req.app.locals.bangumi?.hotReviews ? {
      source: 'bangumi', source_label: 'Bangumi',
      source_url: `https://bgm.tv/subject/${work.bangumi_id}/comments`,
      load: () => req.app.locals.bangumi.hotReviews(work.bangumi_id, 3),
    } : null;
    const providers = (work.is_anime ? [bangumi, douban] : [douban, bangumi]).filter(Boolean) as any[];

    for (const provider of providers) {
      try {
        const reviews = await provider.load();
        if (reviews.length || provider === providers.at(-1)) {
          return res.json({
            source: provider.source,
            source_label: provider.source_label,
            source_url: provider.source_url,
            reviews: reviews.slice(0, 3),
          });
        }
      } catch (error) {
        console.warn(`[hot-reviews] ${provider.source} failed for work ${id}`, error?.message);
      }
    }

    const fallback = providers[0] || { source: null, source_label: null, source_url: null };
    res.json({
      source: fallback.source,
      source_label: fallback.source_label,
      source_url: fallback.source_url,
      reviews: [],
    });
  });

  router.get('/:id', (req, res) => {
    const db = req.app.locals.db;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });

    const work = db.prepare(`SELECT ${WORK_COLS}, tmdb_raw, bangumi_raw, douban_raw FROM works WHERE id = ?`).get(id);
    if (!work) return res.status(404).json({ error: 'not_found' });

    const all_marks = db.prepare('SELECT id, user_id, work_id, status, rating, comment, marked_at FROM user_marks WHERE work_id = ?').all(id);
    const my_mark = req.viewing_user_id ? all_marks.find((m: any) => m.user_id === req.viewing_user_id) || null : null;
    const sessions = listMovieSessions(db, id);
    const plan = db.prepare('SELECT id, work_id, added_by, note, priority, status, created_at, updated_at FROM plan_items WHERE work_id = ?').get(id) || null;

    const publicWork = { ...work };
    delete publicWork.tmdb_raw;
    delete publicWork.bangumi_raw;
    delete publicWork.douban_raw;
    res.json({ ...publicWork, details: makeWorkDetails(work), my_mark, all_marks, sessions, plan } satisfies Work);
  });

  return router;
}
