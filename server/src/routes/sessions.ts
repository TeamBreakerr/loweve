// server/src/routes/sessions.js
import { Router } from 'express';
import { upsertWork } from './works.js';
import { markRecosStale } from '../recos/state.js';
import type { Session } from '../../../shared/types.js';

const SESSION_COLS = 'id, work_id, watched_at, rating_a, rating_b, review_a, review_b, joint_note, created_at';

function validateRating(r: any) { return r == null || (Number.isInteger(r) && r >= 1 && r <= 10); }

export function sessionsRoutes() {
  const router = Router();

  router.get('/', (req, res) => {
    const db = req.app.locals.db;
    const rows = db.prepare(`SELECT ${SESSION_COLS} FROM couple_sessions ORDER BY watched_at DESC, id DESC`).all();
    const workIds = [...new Set(rows.map((r: any) => r.work_id))];
    const works = workIds.length
      ? db.prepare(`SELECT * FROM works WHERE id IN (${workIds.map(() => '?').join(',')})`).all(...workIds)
      : [];
    const workMap = new Map(works.map((w: any) => [w.id, w]));
    res.json({ sessions: rows.map((r: any) => ({ ...r, work: workMap.get(r.work_id) })) satisfies Session[] });
  });

  router.post('/', async (req, res) => {
    if (!req.viewing_user_id) return res.status(401).json({ error: 'not_authenticated' });
    const db = req.app.locals.db;
    const tmdb = req.app.locals.tmdb;
    const fromPlanId = parseInt(req.query.from_plan as string, 10);

    const { work_id, tmdb_id, tmdb_type, watched_at, rating, review, joint_note } = req.body || {};
    // watched_at 可空（有时忘了哪天看的）；给了就必须是整数日期
    if (watched_at != null && !Number.isInteger(watched_at)) return res.status(400).json({ error: 'invalid_watched_at' });
    if (!validateRating(rating)) return res.status(400).json({ error: 'invalid_rating' });

    // from_plan 模式：work_id 从 plan 拿，事务执行
    if (Number.isInteger(fromPlanId)) {
      const plan = db.prepare('SELECT id, work_id FROM plan_items WHERE id = ?').get(fromPlanId);
      if (!plan) return res.status(404).json({ error: 'plan_not_found' });

      const now = Date.now();
      const isA = req.viewing_user_id === 1;
      const tx = db.transaction(() => {
        const info = db.prepare(`INSERT INTO couple_sessions (work_id, watched_at, rating_a, rating_b, review_a, review_b, joint_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(plan.work_id, watched_at,
               isA ? (rating ?? null) : null,
               isA ? null : (rating ?? null),
               isA ? (review ?? null) : null,
               isA ? null : (review ?? null),
               joint_note ?? null, now);
        db.prepare('UPDATE plan_items SET status = ?, updated_at = ? WHERE id = ?').run('done', now, plan.id);
        return info.lastInsertRowid;
      });
      const id = tx();
      markRecosStale(db);
      return res.json(db.prepare(`SELECT ${SESSION_COLS} FROM couple_sessions WHERE id = ?`).get(id) satisfies Session);
    }

    // 普通模式：work_id 或 tmdb_id 二选一
    let finalWorkId = work_id;
    if (!finalWorkId) {
      if (!Number.isInteger(tmdb_id) || (tmdb_type !== 'movie' && tmdb_type !== 'tv')) {
        return res.status(400).json({ error: 'work_id_or_tmdb_required' });
      }
      try {
        const w = await upsertWork(db, tmdb, req.app.locals.bangumi, req.app.locals.douban, { tmdb_id, tmdb_type });
        finalWorkId = w.id;
      } catch (e) {
        return res.status(502).json({ error: e.code || 'tmdb_unknown' });
      }
    }

    const now = Date.now();
    const isA = req.viewing_user_id === 1;
    const info = db.prepare(`INSERT INTO couple_sessions (work_id, watched_at, rating_a, rating_b, review_a, review_b, joint_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(finalWorkId, watched_at,
           isA ? (rating ?? null) : null,
           isA ? null : (rating ?? null),
           isA ? (review ?? null) : null,
           isA ? null : (review ?? null),
           joint_note ?? null, now);
    const row = db.prepare(`SELECT ${SESSION_COLS} FROM couple_sessions WHERE id = ?`).get(info.lastInsertRowid);
    markRecosStale(db);
    res.json(row satisfies Session);
  });

  router.put('/:id', (req, res) => {
    const db = req.app.locals.db;
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare(`SELECT ${SESSION_COLS} FROM couple_sessions WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const { watched_at, rating_a, rating_b, review_a, review_b, joint_note } = req.body || {};
    if (!validateRating(rating_a) || !validateRating(rating_b)) return res.status(400).json({ error: 'invalid_rating' });
    // watched_at 特殊：只有请求里带了该字段才更新（带 null 即清空日期；不带则保留原值）
    const hasWatchedAt = Object.prototype.hasOwnProperty.call(req.body || {}, 'watched_at');
    if (hasWatchedAt && watched_at != null && !Number.isInteger(watched_at)) return res.status(400).json({ error: 'invalid_watched_at' });

    // 注意：better-sqlite3 不支持混用匿名 ? 与编号 ?N，统一用命名参数 @name
    db.prepare(`UPDATE couple_sessions SET
      watched_at = CASE WHEN @setWatched = 1 THEN @watched_at ELSE watched_at END,
      rating_a = CASE WHEN @rating_a IS NOT NULL THEN @rating_a ELSE rating_a END,
      rating_b = CASE WHEN @rating_b IS NOT NULL THEN @rating_b ELSE rating_b END,
      review_a = CASE WHEN @review_a IS NOT NULL THEN @review_a ELSE review_a END,
      review_b = CASE WHEN @review_b IS NOT NULL THEN @review_b ELSE review_b END,
      joint_note = CASE WHEN @joint_note IS NOT NULL THEN @joint_note ELSE joint_note END
      WHERE id = @id`).run({
        setWatched: hasWatchedAt ? 1 : 0, watched_at: watched_at ?? null,
        rating_a: rating_a ?? null, rating_b: rating_b ?? null,
        review_a: review_a ?? null, review_b: review_b ?? null, joint_note: joint_note ?? null, id });
    // 只有喂进推荐 prompt 的字段（评分/各自短评/联合备注）变了才让推荐过期；
    // 改观看日期不影响推荐内容，别触发重新挑片。
    const recoRelevantChanged =
      (rating_a != null && rating_a !== existing.rating_a) ||
      (rating_b != null && rating_b !== existing.rating_b) ||
      (review_a != null && review_a !== existing.review_a) ||
      (review_b != null && review_b !== existing.review_b) ||
      (joint_note != null && joint_note !== existing.joint_note);
    if (recoRelevantChanged) markRecosStale(db);
    res.json(db.prepare(`SELECT ${SESSION_COLS} FROM couple_sessions WHERE id = ?`).get(id) satisfies Session);
  });

  router.delete('/:id', (req, res) => {
    const db = req.app.locals.db;
    const id = parseInt(req.params.id, 10);
    const info = db.prepare('DELETE FROM couple_sessions WHERE id = ?').run(id);
    if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
    markRecosStale(db);
    res.status(204).end();
  });

  return router;
}
