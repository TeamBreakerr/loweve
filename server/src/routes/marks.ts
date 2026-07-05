// server/src/routes/marks.js
import { Router } from 'express';
import { upsertWork } from './works.js';
import { markRecosStale } from '../recos/state.js';
import type { Mark } from '../../../shared/types.js';

const MARK_COLS = 'id, user_id, work_id, status, rating, comment, marked_at';

function requireViewing(req: any, res: any) {
  if (!req.viewing_user_id) {
    res.status(401).json({ error: 'not_authenticated' });
    return false;
  }
  return true;
}

function validateStatus(s: any) { return s === 'watched' || s === 'wish'; }
function validateRating(r: any) { return r == null || (Number.isInteger(r) && r >= 1 && r <= 10); }

export function marksRoutes() {
  const router = Router();

  router.get('/', (req, res) => {
    if (!requireViewing(req, res)) return;
    const db = req.app.locals.db;
    const status = req.query.status || 'all';
    let rows: any;
    if (status === 'all') {
      rows = db.prepare(`SELECT ${MARK_COLS} FROM user_marks WHERE user_id = ? ORDER BY marked_at DESC`).all(req.viewing_user_id);
    } else if (validateStatus(status)) {
      rows = db.prepare(`SELECT ${MARK_COLS} FROM user_marks WHERE user_id = ? AND status = ? ORDER BY marked_at DESC`).all(req.viewing_user_id, status);
    } else {
      return res.status(400).json({ error: 'invalid_status' });
    }
    // 附 work 联表（一次查所有需要的 work）
    const workIds = [...new Set(rows.map((r: any) => r.work_id))];
    const works = workIds.length
      ? db.prepare(`SELECT * FROM works WHERE id IN (${workIds.map(() => '?').join(',')})`).all(...workIds)
      : [];
    const workMap = new Map(works.map((w: any) => [w.id, w]));
    res.json({ marks: rows.map((r: any) => ({ ...r, work: workMap.get(r.work_id) })) satisfies Mark[] });
  });

  router.post('/', async (req, res) => {
    if (!requireViewing(req, res)) return;
    const db = req.app.locals.db;
    const tmdb = req.app.locals.tmdb;
    const { status, rating, comment, work_id, tmdb_id, tmdb_type } = req.body || {};
    if (!validateStatus(status)) return res.status(400).json({ error: 'invalid_status' });
    if (!validateRating(rating)) return res.status(400).json({ error: 'invalid_rating' });

    let finalWorkId = work_id;
    if (!finalWorkId) {
      if (!Number.isInteger(tmdb_id) || (tmdb_type !== 'movie' && tmdb_type !== 'tv')) {
        return res.status(400).json({ error: 'work_id_or_tmdb_required' });
      }
      try {
        const w = await upsertWork(db, tmdb, req.app.locals.bangumi, req.app.locals.douban, { tmdb_id, tmdb_type });
        finalWorkId = w.id;
      } catch (e) {
        return res.status(502).json({ error: e.code || 'tmdb_unknown', message: e.message });
      }
    }

    const now = Date.now();
    try {
      const info = db.prepare(`INSERT INTO user_marks (user_id, work_id, status, rating, comment, marked_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(req.viewing_user_id, finalWorkId, status, rating ?? null, comment ?? null, now);
      const row = db.prepare(`SELECT ${MARK_COLS} FROM user_marks WHERE id = ?`).get(info.lastInsertRowid);
      markRecosStale(db);
      res.json(row satisfies Mark);
    } catch (e) {
      if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'mark_exists' });
      throw e;
    }
  });

  router.put('/:id', (req, res) => {
    const db = req.app.locals.db;
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare(`SELECT ${MARK_COLS} FROM user_marks WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const { status, rating, comment } = req.body || {};
    if (status !== undefined && !validateStatus(status)) return res.status(400).json({ error: 'invalid_status' });
    if (rating !== undefined && !validateRating(rating)) return res.status(400).json({ error: 'invalid_rating' });

    db.prepare(`UPDATE user_marks SET
      status = COALESCE(@status, status),
      rating = CASE WHEN @rating IS NOT NULL THEN @rating ELSE rating END,
      comment = CASE WHEN @comment IS NOT NULL THEN @comment ELSE comment END
      WHERE id = @id`).run({ status: status ?? null, rating: rating ?? null, comment: comment ?? null, id });
    const row = db.prepare(`SELECT ${MARK_COLS} FROM user_marks WHERE id = ?`).get(id);
    markRecosStale(db);
    res.json(row);
  });

  router.delete('/:id', (req, res) => {
    const db = req.app.locals.db;
    const id = parseInt(req.params.id, 10);
    const info = db.prepare('DELETE FROM user_marks WHERE id = ?').run(id);
    if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
    markRecosStale(db);
    res.status(204).end();
  });

  return router;
}
