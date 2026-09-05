import { Router } from 'express';
import { currentDateKey } from '../routes/sessions.js';
import { generateGameStanding, getCurrentGameRecos, hydrateGameRecoOffers, requestGameStandingRefresh } from './recos.js';
import { markGameRecosStale } from './state.js';
import { moveGameToTrash, parseGameTrashPayload, restoreGameTrashItem } from './trash.js';
import {
  enrichGameSearchResults, refreshGameWorkIfStale, upsertGameWork, upsertIgdbGameWork,
  verifiedCatalogAliasResults, verifiedSteamReferenceResults, verifiedWikidataAliasResults, withGameLinks,
} from './service.js';
import { parseSteamReference } from '../steam/client.js';
import { ensureExperiencePair, getGameSession, listGameSessions } from '../experiences/service.js';

const MARK_COLS = 'id, user_id, work_id, status, rating, comment, marked_at';
const PLAN_COLS = 'id, work_id, added_by, note, priority, status, created_at, updated_at';
const PLAN_STATUS = ['pending', 'playing', 'done', 'dropped'];
const ACTIONS = { want: 'interested', not_interested: 'not_interested', already_seen: 'already_seen' };

function requireViewing(req: any, res: any) {
  if (req.viewing_user_id) return true;
  res.status(401).json({ error: 'not_authenticated' });
  return false;
}

function validRating(value: any) {
  return value == null || (Number.isInteger(value) && value >= 1 && value <= 10);
}

function worksFor(db: any, rows: any[]) {
  const ids = [...new Set(rows.map(row => row.work_id))];
  const works = ids.length
    ? db.prepare(`SELECT * FROM game_works WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : [];
  return new Map(works.map((work: any) => [work.id, withGameLinks(work)]));
}

async function resolveWork(req: any, res: any) {
  const db = req.app.locals.db;
  const workId = Number(req.body?.work_id);
  if (Number.isInteger(workId) && workId > 0) {
    const work = db.prepare('SELECT * FROM game_works WHERE id = ?').get(workId);
    if (!work) { res.status(404).json({ error: 'game_not_found' }); return null; }
    return withGameLinks(work);
  }
  const igdbId = Number(req.body?.igdb_id);
  if (Number.isInteger(igdbId) && igdbId > 0) {
    if (!req.app.locals.igdb?.isConfigured?.()) {
      res.status(503).json({ error: 'igdb_unconfigured' }); return null;
    }
    try { return await upsertIgdbGameWork(db, req.app.locals.igdb, req.app.locals.steam, igdbId); }
    catch (e) {
      res.status(e?.status === 404 ? 404 : 502).json({ error: e?.code || 'igdb_unknown' });
      return null;
    }
  }
  const appid = Number(req.body?.steam_appid);
  if (!Number.isInteger(appid) || appid <= 0) {
    res.status(400).json({ error: 'work_id_or_game_identity_required' }); return null;
  }
  try { return await upsertGameWork(db, req.app.locals.steam, appid); }
  catch (e) {
    res.status(e?.status === 404 ? 404 : 502).json({ error: e?.code || 'steam_unknown' });
    return null;
  }
}

function depsOf(req: any) {
  return { llm: req.app.locals.llm, steam: req.app.locals.steam, igdb: req.app.locals.igdb };
}

export function gameRoutes() {
  const router = Router();
  const searchCache = new Map<string, { at: number; value: any }>();
  const searchInflight = new Map<string, Promise<any>>();
  const SEARCH_CACHE_MS = 5 * 60 * 1000;
  const LOCALIZED_ALIAS_HEDGE_MS = 40;

  async function searchGames(req: any, q: string) {
    const directSteam = parseSteamReference(q);
    if (!req.app.locals.igdb?.isConfigured?.()) {
      return { ...(await req.app.locals.steam.search(q)), catalog_fallback: 'steam', warning: 'igdb_unconfigured' };
    }

    const igdb = req.app.locals.igdb;
    const steam = req.app.locals.steam;
    if (directSteam) return {
      results: await verifiedSteamReferenceResults(directSteam, igdb, steam),
      catalog_sources: ['igdb'], alias_bridge: 'steam_reference_verified_by_igdb',
    };
    const isLocalizedQuery = /\p{Script=Han}/u.test(q);
    if (!isLocalizedQuery) {
      const catalog = (await igdb.search(q))?.results || [];
      return { results: await enrichGameSearchResults(catalog, steam), catalog_sources: ['igdb'] };
    }

    // 中文主标题先给 IGDB 一个很短的领先窗口；未返回时再并发探测 Steam/Wikidata 别名。
    // 这样常见中文标题不浪费两次桥接请求，缺译名时又无需串行等待三条外部链路。
    let directSettled = false;
    let aliasTask: Promise<any> | null = null;
    const startAliases = () => {
      if (aliasTask) return aliasTask;
      const sources = [
        verifiedCatalogAliasResults(q, igdb, steam).then(results => ({ bridge: 'steam_verified_by_igdb', results })),
        verifiedWikidataAliasResults(q, igdb, req.app.locals.wikidata, steam)
          .then(results => ({ bridge: 'wikidata_verified_by_igdb', results })),
      ];
      aliasTask = new Promise(resolve => {
        let remaining = sources.length;
        for (const source of sources) source.then(value => {
          if (value.results.length) return resolve(value);
          if (--remaining === 0) resolve(null);
        });
      });
      return aliasTask;
    };
    const hedgedAliases = new Promise(resolve => setTimeout(resolve, LOCALIZED_ALIAS_HEDGE_MS))
      .then(() => directSettled ? null : startAliases());
    const directCatalogPromise = igdb.search(q, { aliases: false });
    let catalog: any[];
    try { catalog = (await directCatalogPromise)?.results || []; }
    finally { directSettled = true; }
    if (catalog.length) return { results: await enrichGameSearchResults(catalog, steam), catalog_sources: ['igdb'] };

    const alias = await hedgedAliases || await startAliases();
    if (alias?.results?.length) return {
      results: alias.results, catalog_sources: ['igdb'], alias_bridge: alias.bridge,
    };

    // 极少数只存在于 IGDB 自身 alternative_names 的别名保留原来的兜底能力。
    const igdbAlias = (await igdb.search(q))?.results || [];
    return { results: await enrichGameSearchResults(igdbAlias, steam), catalog_sources: ['igdb'] };
  }

  // —— IGDB 仍独占目录身份；Steam 仅补价格/评价及 IGDB 缺失的本地化搜索入口 ——
  router.get('/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'query_required' });
    try {
      const key = q.toLocaleLowerCase();
      const cached = searchCache.get(key);
      if (cached && Date.now() - cached.at < SEARCH_CACHE_MS) return res.json(cached.value);
      let task = searchInflight.get(key);
      if (!task) {
        task = searchGames(req, q);
        searchInflight.set(key, task);
      }
      try {
        const value = await task;
        searchCache.set(key, { at: Date.now(), value });
        return res.json(value);
      } finally {
        if (searchInflight.get(key) === task) searchInflight.delete(key);
      }
    } catch (e) {
      res.status(e?.code === 'igdb_unconfigured' ? 503 : 502).json({ error: e?.code || 'game_search_failed' });
    }
  });

  router.get('/works/duplicate', (req, res) => {
    if (!requireViewing(req, res)) return;
    const target = String(req.query.target || '');
    if (!['played', 'couple_playing', 'couple_played', 'couple_plan'].includes(target)) return res.status(400).json({ error: 'invalid_target' });
    const db = req.app.locals.db;
    let work: any;
    if (req.query.work_id != null) {
      const id = Number(req.query.work_id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_work_id' });
      work = db.prepare('SELECT id FROM game_works WHERE id = ?').get(id);
    } else {
      const igdbId = Number(req.query.igdb_id);
      const appid = Number(req.query.steam_appid);
      if (Number.isInteger(igdbId) && igdbId > 0) {
        work = db.prepare('SELECT id FROM game_works WHERE igdb_id = ?').get(igdbId);
      } else {
        if (!Number.isInteger(appid)) return res.status(400).json({ error: 'invalid_game_identity' });
        work = db.prepare('SELECT id FROM game_works WHERE steam_appid = ?').get(appid);
      }
    }
    if (!work) return res.json({ duplicate: false });
    let found: any;
    let error: string;
    if (target === 'played') {
      found = db.prepare('SELECT 1 FROM game_marks WHERE user_id = ? AND work_id = ?').get(req.viewing_user_id, work.id);
      error = 'game_mark_exists';
    } else if (target === 'couple_played' || target === 'couple_playing') {
      found = db.prepare('SELECT 1 FROM game_sessions WHERE work_id = ?').get(work.id);
      error = 'game_session_exists';
    } else {
      found = db.prepare('SELECT 1 FROM game_sessions WHERE work_id = ?').get(work.id);
      error = found ? 'game_session_exists' : 'game_plan_exists';
      found ||= db.prepare('SELECT 1 FROM game_plan_items WHERE work_id = ?').get(work.id);
    }
    res.json(found ? { duplicate: true, error } : { duplicate: false });
  });

  router.post('/works', async (req, res) => {
    const igdbId = Number(req.body?.igdb_id);
    if (Number.isInteger(igdbId) && igdbId > 0) {
      if (!req.app.locals.igdb?.isConfigured?.()) return res.status(503).json({ error: 'igdb_unconfigured' });
      try { return res.json(await upsertIgdbGameWork(req.app.locals.db, req.app.locals.igdb, req.app.locals.steam, igdbId)); }
      catch (e) { return res.status(e?.status === 404 ? 404 : 502).json({ error: e?.code || 'igdb_unknown' }); }
    }
    const appid = Number(req.body?.steam_appid);
    if (!Number.isInteger(appid) || appid <= 0) return res.status(400).json({ error: 'game_identity_required' });
    try { res.json(await upsertGameWork(req.app.locals.db, req.app.locals.steam, appid)); }
    catch (e) { res.status(e?.status === 404 ? 404 : 502).json({ error: e?.code || 'steam_unknown' }); }
  });

  router.get('/works/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });
    const db = req.app.locals.db;
    let work = db.prepare('SELECT * FROM game_works WHERE id = ?').get(id);
    if (!work) return res.status(404).json({ error: 'not_found' });
    work = await refreshGameWorkIfStale(db, { igdb: req.app.locals.igdb, steam: req.app.locals.steam }, work);
    const all_marks = db.prepare(`SELECT ${MARK_COLS} FROM game_marks WHERE work_id = ?`).all(id);
    const my_mark = req.viewing_user_id ? all_marks.find((m: any) => m.user_id === req.viewing_user_id) || null : null;
    const plan = db.prepare(`SELECT ${PLAN_COLS} FROM game_plan_items
      WHERE work_id = ? AND status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM game_sessions WHERE work_id = ?)`)
      .get(id, id) || null;
    const sessions = listGameSessions(db, { workId: id });
    const platform_releases = db.prepare(`SELECT igdb_platform_id, platform_name, platform_abbreviation,
      release_date, release_year, region, source FROM game_platform_releases WHERE work_id = ?
      ORDER BY COALESCE(release_date, '9999-99-99'), platform_name`).all(id);
    const offers = db.prepare(`SELECT store, country, currency, list_price_minor, sale_price_minor,
      discount_percent, availability, store_url, source, checked_at FROM game_store_offers WHERE work_id = ?`).all(id);
    res.json({ ...work, all_marks, my_mark, sessions, plan, platform_releases, offers });
  });

  router.get('/works/:id/hot-reviews', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });
    const work: any = req.app.locals.db.prepare(`SELECT id, steam_appid, igdb_id, igdb_url
      FROM game_works WHERE id = ?`).get(id);
    if (!work) return res.status(404).json({ error: 'not_found' });
    if (!work.steam_appid || !req.app.locals.steam?.hotReviews) {
      return res.json({
        source: 'igdb', source_label: 'IGDB', source_url: work.igdb_url || null, reviews: [],
      });
    }
    try {
      const reviews = await req.app.locals.steam.hotReviews(work.steam_appid, 3);
      res.json({
        source: 'steam', source_label: 'Steam',
        source_url: `https://store.steampowered.com/app/${work.steam_appid}/#app_reviews_hash`,
        reviews: reviews.slice(0, 3),
      });
    } catch (error) {
      console.warn(`[hot-reviews] steam failed for game ${id}`, error?.message);
      res.json({
        source: 'steam', source_label: 'Steam',
        source_url: `https://store.steampowered.com/app/${work.steam_appid}/#app_reviews_hash`,
        reviews: [],
      });
    }
  });

  // —— 个人玩过 ——
  router.get('/marks', (req, res) => {
    if (!requireViewing(req, res)) return;
    const db = req.app.locals.db;
    const rows = db.prepare(`SELECT ${MARK_COLS} FROM game_marks
      WHERE user_id = ? ORDER BY marked_at DESC, id DESC`).all(req.viewing_user_id);
    const workMap = worksFor(req.app.locals.db, rows);
    res.json({ marks: rows.map((row: any) => ({ ...row, work: workMap.get(row.work_id) })) });
  });

  router.post('/marks', async (req, res) => {
    if (!requireViewing(req, res)) return;
    const { rating, comment } = req.body || {};
    if (!validRating(rating)) return res.status(400).json({ error: 'invalid_rating' });
    const work = await resolveWork(req, res);
    if (!work) return;
    try {
      const info = req.app.locals.db.prepare(`INSERT INTO game_marks
        (user_id, work_id, status, rating, comment, marked_at) VALUES (?, ?, 'played', ?, ?, ?)`)
        .run(req.viewing_user_id, work.id, rating ?? null, comment ?? null, Date.now());
      markGameRecosStale(req.app.locals.db);
      res.json(req.app.locals.db.prepare(`SELECT ${MARK_COLS} FROM game_marks WHERE id = ?`).get(info.lastInsertRowid));
    } catch (e) {
      if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'game_mark_exists' });
      throw e;
    }
  });

  router.put('/marks/:id', (req, res) => {
    if (!requireViewing(req, res)) return;
    const id = Number(req.params.id);
    const db = req.app.locals.db;
    const row = db.prepare(`SELECT ${MARK_COLS} FROM game_marks WHERE id = ?`).get(id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (row.user_id !== req.viewing_user_id) return res.status(403).json({ error: 'forbidden' });
    const { rating, comment } = req.body || {};
    if (!validRating(rating)) return res.status(400).json({ error: 'invalid_rating' });
    db.prepare(`UPDATE game_marks SET
      rating = CASE WHEN @setRating THEN @rating ELSE rating END,
      comment = CASE WHEN @setComment THEN @comment ELSE comment END WHERE id = @id`).run({
      setRating: Object.hasOwn(req.body || {}, 'rating') ? 1 : 0, rating: rating ?? null,
      setComment: Object.hasOwn(req.body || {}, 'comment') ? 1 : 0, comment: comment ?? null, id,
    });
    markGameRecosStale(db);
    res.json(db.prepare(`SELECT ${MARK_COLS} FROM game_marks WHERE id = ?`).get(id));
  });

  router.delete('/marks/:id', (req, res) => {
    if (!requireViewing(req, res)) return;
    const id = Number(req.params.id);
    const row = req.app.locals.db.prepare('SELECT user_id, work_id FROM game_marks WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (row.user_id !== req.viewing_user_id) return res.status(403).json({ error: 'forbidden' });
    if (req.app.locals.db.prepare('SELECT 1 FROM game_sessions WHERE work_id = ?').get(row.work_id)) {
      return res.status(409).json({ error: 'shared_experience_requires_mark' });
    }
    if (!moveGameToTrash(req.app.locals.db, 'mark', id, req.viewing_user_id)) return res.status(404).json({ error: 'not_found' });
    markGameRecosStale(req.app.locals.db);
    res.status(204).end();
  });

  // —— 共同游玩：completed_at 为空=正在玩，有值=已经通关 ——
  router.get('/sessions', (req, res) => {
    const db = req.app.locals.db;
    const status = String(req.query.status || '');
    if (status && !['playing', 'completed'].includes(status)) return res.status(400).json({ error: 'invalid_status' });
    const rows = listGameSessions(db, {
      status: status === 'playing' ? 'playing' : status === 'completed' ? 'completed' : undefined,
    });
    const workMap = worksFor(db, rows);
    res.json({ sessions: rows.map((row: any) => ({ ...row, work: workMap.get(row.work_id) })) });
  });

  router.post('/sessions', async (req, res) => {
    if (!requireViewing(req, res)) return;
    const { rating, review, joint_note, played_at, completed_at } = req.body || {};
    const date = Object.hasOwn(req.body || {}, 'played_at') ? played_at ?? null : currentDateKey();
    if (date != null && !Number.isInteger(date)) return res.status(400).json({ error: 'invalid_played_at' });
    if (completed_at != null && !Number.isInteger(completed_at)) return res.status(400).json({ error: 'invalid_completed_at' });
    if (!validRating(rating)) return res.status(400).json({ error: 'invalid_rating' });
    const db = req.app.locals.db;
    const fromPlanId = Number(req.query.from_plan);
    let work: any;
    if (Number.isInteger(fromPlanId) && fromPlanId > 0) {
      const plan = db.prepare('SELECT * FROM game_plan_items WHERE id = ?').get(fromPlanId);
      if (!plan) return res.status(404).json({ error: 'game_plan_not_found' });
      work = db.prepare('SELECT * FROM game_works WHERE id = ?').get(plan.work_id);
    } else {
      work = await resolveWork(req, res);
      if (!work) return;
    }
    if (db.prepare('SELECT 1 FROM game_sessions WHERE work_id = ?').get(work.id)) {
      return res.status(409).json({ error: 'game_session_exists' });
    }
    const now = Date.now();
    const create = () => {
      const info = db.prepare(`INSERT INTO game_sessions
        (work_id, played_at, completed_at, joint_note, created_at)
        VALUES (?, ?, ?, ?, ?)`)
        .run(work.id, date, completed_at ?? null, joint_note ?? null, now);
      const viewer = req.viewing_user_id === 1 ? 1 : 2;
      ensureExperiencePair(db, 'game', work.id, now, {
        [viewer]: { rating: rating ?? null, comment: review ?? null },
      });
      if (Number.isInteger(fromPlanId) && fromPlanId > 0) {
        db.prepare(`UPDATE game_plan_items SET status = ?, updated_at = ? WHERE id = ?`)
          .run(completed_at == null ? 'playing' : 'done', now, fromPlanId);
      } else {
        db.prepare(`UPDATE game_plan_items SET status = ?, updated_at = ? WHERE work_id = ?`)
          .run(completed_at == null ? 'playing' : 'done', now, work.id);
      }
      return info.lastInsertRowid;
    };
    const id = db.transaction(create)();
    markGameRecosStale(db);
    res.json(getGameSession(db, Number(id)));
  });

  router.put('/sessions/:id', (req, res) => {
    if (!requireViewing(req, res)) return;
    const id = Number(req.params.id);
    const db = req.app.locals.db;
    const row = getGameSession(db, id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const body = req.body || {};
    const experienceFields = ['rating', 'review', 'rating_a', 'rating_b', 'review_a', 'review_b'];
    if (experienceFields.some(field => Object.hasOwn(body, field))) {
      return res.status(400).json({ error: 'experience_fields_belong_to_marks' });
    }
    const { played_at, completed_at } = body;
    if (Object.hasOwn(body, 'played_at') && played_at != null && !Number.isInteger(played_at)) {
      return res.status(400).json({ error: 'invalid_played_at' });
    }
    if (Object.hasOwn(body, 'completed_at') && completed_at != null && !Number.isInteger(completed_at)) {
      return res.status(400).json({ error: 'invalid_completed_at' });
    }
    const patch: any = { id };
    const fields = ['played_at', 'completed_at', 'joint_note'];
    const assignments = fields.filter(key => Object.hasOwn(body, key)).map(key => `${key} = @${key}`);
    for (const key of fields) patch[key] = body[key] ?? null;
    db.transaction(() => {
      if (assignments.length) db.prepare(`UPDATE game_sessions SET ${assignments.join(', ')} WHERE id = @id`).run(patch);
      if (Object.hasOwn(body, 'completed_at')) {
        db.prepare(`UPDATE game_plan_items SET status = ?, updated_at = ? WHERE work_id = ?`)
          .run(completed_at == null ? 'playing' : 'done', Date.now(), row.work_id);
      }
    })();
    if (Object.hasOwn(body, 'joint_note') && body.joint_note !== row.joint_note) markGameRecosStale(db);
    res.json(getGameSession(db, id));
  });

  router.delete('/sessions/:id', (req, res) => {
    if (!requireViewing(req, res)) return;
    if (!moveGameToTrash(req.app.locals.db, 'session', Number(req.params.id), req.viewing_user_id)) return res.status(404).json({ error: 'not_found' });
    markGameRecosStale(req.app.locals.db);
    res.status(204).end();
  });

  // —— 想和你一起玩 ——
  router.get('/plan', (req, res) => {
    const db = req.app.locals.db;
    const status = String(req.query.status || '');
    if (status && !PLAN_STATUS.includes(status)) return res.status(400).json({ error: 'invalid_status' });
    const rows = status
      ? db.prepare(`SELECT ${PLAN_COLS} FROM game_plan_items WHERE status = ? ORDER BY created_at DESC, id DESC`).all(status)
      : db.prepare(`SELECT ${PLAN_COLS} FROM game_plan_items WHERE status = 'pending'
          AND NOT EXISTS (SELECT 1 FROM game_sessions WHERE game_sessions.work_id = game_plan_items.work_id)
        ORDER BY created_at DESC, id DESC`).all();
    const workMap = worksFor(db, rows);
    res.json({ items: rows.map((row: any) => ({ ...row, work: workMap.get(row.work_id) })) });
  });

  router.post('/plan', async (req, res) => {
    if (!requireViewing(req, res)) return;
    const priority = req.body?.priority ?? 0;
    if (!Number.isInteger(priority) || priority < 0 || priority > 3) return res.status(400).json({ error: 'invalid_priority' });
    const work = await resolveWork(req, res);
    if (!work) return;
    const db = req.app.locals.db;
    if (db.prepare('SELECT 1 FROM game_sessions WHERE work_id = ?').get(work.id)) {
      return res.status(409).json({ error: 'game_session_exists' });
    }
    const now = Date.now();
    try {
      const info = db.prepare(`INSERT INTO game_plan_items
        (work_id, added_by, note, priority, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?)`)
        .run(work.id, req.viewing_user_id, req.body?.note ?? null, priority, now, now);
      res.json(db.prepare(`SELECT ${PLAN_COLS} FROM game_plan_items WHERE id = ?`).get(info.lastInsertRowid));
    } catch (e) {
      if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'game_plan_exists' });
      throw e;
    }
  });

  router.put('/plan/:id', (req, res) => {
    const id = Number(req.params.id);
    const db = req.app.locals.db;
    const existing = db.prepare('SELECT * FROM game_plan_items WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const { note, priority, status, played_at, completed_at } = req.body || {};
    if (status !== undefined && !PLAN_STATUS.includes(status)) return res.status(400).json({ error: 'invalid_status' });
    if (priority !== undefined && (!Number.isInteger(priority) || priority < 0 || priority > 3)) return res.status(400).json({ error: 'invalid_priority' });
    if (played_at != null && !Number.isInteger(played_at)) return res.status(400).json({ error: 'invalid_played_at' });
    if (completed_at != null && !Number.isInteger(completed_at)) return res.status(400).json({ error: 'invalid_completed_at' });
    const fields = ['note', 'priority', 'status'].filter(key => Object.hasOwn(req.body || {}, key));
    const patch: any = { id, updated_at: Date.now(), note: note ?? null, priority: priority ?? null, status: status ?? null };
    const statusDate = status === 'playing' ? played_at ?? currentDateKey()
      : status === 'done' ? completed_at ?? currentDateKey() : null;
    let createdSession = false;
    db.transaction(() => {
      if ((status === 'playing' || status === 'done')
        && !db.prepare('SELECT 1 FROM game_sessions WHERE work_id = ?').get(existing.work_id)) {
        db.prepare(`INSERT INTO game_sessions
          (work_id, played_at, completed_at, joint_note, created_at)
          VALUES (?, ?, NULL, NULL, ?)`)
          .run(existing.work_id, status === 'playing' ? statusDate : null, patch.updated_at);
        ensureExperiencePair(db, 'game', existing.work_id, patch.updated_at);
        createdSession = true;
      }
      if (fields.length) db.prepare(`UPDATE game_plan_items SET ${fields.map(key => `${key} = @${key}`).join(', ')}, updated_at = @updated_at WHERE id = @id`).run(patch);
      if (status === 'done') {
        db.prepare(`UPDATE game_sessions SET completed_at = ? WHERE work_id = ?`)
          .run(statusDate, existing.work_id);
      } else if (status === 'playing') {
        db.prepare(`UPDATE game_sessions SET played_at = ?, completed_at = NULL WHERE work_id = ?`)
          .run(statusDate, existing.work_id);
      }
    })();
    if (createdSession) markGameRecosStale(db);
    res.json(db.prepare(`SELECT ${PLAN_COLS} FROM game_plan_items WHERE id = ?`).get(id));
  });

  router.delete('/plan/:id', (req, res) => {
    if (!moveGameToTrash(req.app.locals.db, 'plan', Number(req.params.id), req.viewing_user_id)) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  });

  // —— 游戏 AI 推荐 ——
  router.get('/recos', async (req, res) => {
    const deps = depsOf(req);
    const payload = await getCurrentGameRecos(req.app.locals.db, deps);
    res.json(await hydrateGameRecoOffers(req.app.locals.db, deps, payload));
  });
  router.post('/recos/refresh', (req, res) => {
    const result = requestGameStandingRefresh(req.app.locals.db, depsOf(req));
    res.status(result.generating ? 202 : 200).json(result);
  });
  router.post('/recos/custom', async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'prompt_required' });
    try { res.json({ ...(await generateGameStanding(req.app.locals.db, depsOf(req), { userPrompt: prompt })), error: null }); }
    catch (e) { res.status(502).json({ error: 'llm_unavailable', message: e?.message }); }
  });
  router.post('/recos/:id/feedback', async (req, res) => {
    if (!requireViewing(req, res)) return;
    const id = Number(req.params.id);
    const action = req.body?.action;
    const feedback = ACTIONS[action as keyof typeof ACTIONS];
    if (!feedback) return res.status(400).json({ error: 'invalid_action' });
    const db = req.app.locals.db;
    const rec = db.prepare('SELECT id, work_id FROM game_recommendations WHERE id = ?').get(id);
    if (!rec) return res.status(404).json({ error: 'not_found' });
    if (action === 'want' && rec.work_id
      && db.prepare('SELECT 1 FROM game_sessions WHERE work_id = ?').get(rec.work_id)) {
      return res.status(409).json({ error: 'game_session_exists' });
    }
    const now = Date.now();
    db.prepare(`UPDATE game_recommendations SET feedback = ?, feedback_by = ?, feedback_at = ? WHERE id = ?`)
      .run(feedback, req.viewing_user_id, now, id);
    let mark: any = null, plan: any = null;
    if (action === 'already_seen' && rec.work_id) {
      try { db.prepare(`INSERT INTO game_marks (user_id, work_id, status, rating, comment, marked_at)
        VALUES (?, ?, 'played', NULL, NULL, ?)`).run(req.viewing_user_id, rec.work_id, now); }
      catch (e) { if (!String(e).includes('UNIQUE')) throw e; }
      mark = db.prepare(`SELECT ${MARK_COLS} FROM game_marks WHERE user_id = ? AND work_id = ?`).get(req.viewing_user_id, rec.work_id);
    }
    if (action === 'want' && rec.work_id) {
      const priority = Number.isInteger(req.body?.priority) && req.body.priority >= 0 && req.body.priority <= 3 ? req.body.priority : 0;
      try {
        const info = db.prepare(`INSERT INTO game_plan_items
          (work_id, added_by, note, priority, status, created_at, updated_at)
          VALUES (?, ?, NULL, ?, 'pending', ?, ?)`).run(rec.work_id, req.viewing_user_id, priority, now, now);
        plan = db.prepare(`SELECT ${PLAN_COLS} FROM game_plan_items WHERE id = ?`).get(info.lastInsertRowid);
      } catch (e) { if (!String(e).includes('UNIQUE')) throw e; }
    }
    markGameRecosStale(db);
    res.json({ ok: true, mark, plan });
  });

  // —— 游戏回收站 ——
  router.get('/trash', (req, res) => {
    if (!requireViewing(req, res)) return;
    const db = req.app.locals.db;
    const rows = db.prepare(`SELECT t.*, u.display_name AS deleted_by_name FROM game_trash_items t
      LEFT JOIN users u ON u.id = t.deleted_by ORDER BY t.deleted_at DESC, t.id DESC`).all();
    const workMap = worksFor(db, rows);
    res.json({ items: rows.map((row: any) => ({ ...row, payload: parseGameTrashPayload(row), work: workMap.get(row.work_id) })) });
  });
  router.post('/trash/:id/restore', (req, res) => {
    if (!requireViewing(req, res)) return;
    const result = restoreGameTrashItem(req.app.locals.db, Number(req.params.id));
    if (result.status === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (result.status === 'invalid') return res.status(422).json({ error: 'invalid_trash_item' });
    if (result.status === 'conflict') return res.status(409).json({ error: 'restore_conflict' });
    if (result.entityType !== 'plan') markGameRecosStale(req.app.locals.db);
    res.json({ restored: true, entity_type: result.entityType, id: result.id });
  });
  router.delete('/trash/:id', (req, res) => {
    if (!requireViewing(req, res)) return;
    const info = req.app.locals.db.prepare('DELETE FROM game_trash_items WHERE id = ?').run(Number(req.params.id));
    if (!info.changes) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  });

  return router;
}
