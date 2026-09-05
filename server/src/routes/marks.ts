// server/src/routes/marks.js
import { Router } from 'express';
import { upsertWork } from './works.js';
import { markRecosStale } from '../recos/state.js';
import type { Mark } from '../../../shared/types.js';
import { moveToTrash } from '../trash/service.js';

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
    if (status !== 'all' && !validateStatus(status)) {
      return res.status(400).json({ error: 'invalid_status' });
    }

    const filteredRows = status === 'all'
      ? db.prepare(`SELECT ${MARK_COLS} FROM user_marks WHERE user_id = ? ORDER BY marked_at DESC, id DESC`).all(req.viewing_user_id)
      : db.prepare(`SELECT ${MARK_COLS} FROM user_marks WHERE user_id = ? AND status = ? ORDER BY marked_at DESC, id DESC`).all(req.viewing_user_id, status);
    // 附 work 联表（一次查所有需要的 work）
    const workIds = [...new Set(filteredRows.map((r: any) => r.work_id))];
    const works = workIds.length
      ? db.prepare(`SELECT * FROM works WHERE id IN (${workIds.map(() => '?').join(',')})`).all(...workIds)
      : [];
    const workMap = new Map(works.map((w: any) => [w.id, w]));
    res.json({ marks: filteredRows.map((r: any) => ({ ...r, work: workMap.get(r.work_id) })) satisfies Mark[] });
  });

  router.post('/', async (req, res) => {
    if (!requireViewing(req, res)) return;
    const db = req.app.locals.db;
    const tmdb = req.app.locals.tmdb;
    const { status, rating, comment, work_id, tmdb_id, tmdb_type, season_number } = req.body || {};
    if (!validateStatus(status)) return res.status(400).json({ error: 'invalid_status' });
    if (!validateRating(rating)) return res.status(400).json({ error: 'invalid_rating' });

    let finalWorkId = work_id;
    if (!finalWorkId) {
      if (!Number.isInteger(tmdb_id) || (tmdb_type !== 'movie' && tmdb_type !== 'tv')) {
        return res.status(400).json({ error: 'work_id_or_tmdb_required' });
      }
      try {
        const w = await upsertWork(db, tmdb, req.app.locals.bangumi, req.app.locals.douban, { tmdb_id, tmdb_type, season_number });
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
    if (!requireViewing(req, res)) return;
    const db = req.app.locals.db;
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare(`SELECT ${MARK_COLS} FROM user_marks WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (existing.user_id !== req.viewing_user_id) return res.status(403).json({ error: 'forbidden' });

    const { status, rating, comment } = req.body || {};
    if (status !== undefined && !validateStatus(status)) return res.status(400).json({ error: 'invalid_status' });
    if (rating !== undefined && !validateRating(rating)) return res.status(400).json({ error: 'invalid_rating' });

    db.prepare(`UPDATE user_marks SET
      status = CASE WHEN @setStatus = 1 THEN @status ELSE status END,
      rating = CASE WHEN @setRating = 1 THEN @rating ELSE rating END,
      comment = CASE WHEN @setComment = 1 THEN @comment ELSE comment END
      WHERE id = @id`).run({
        setStatus: Object.hasOwn(req.body || {}, 'status') ? 1 : 0, status: status ?? null,
        setRating: Object.hasOwn(req.body || {}, 'rating') ? 1 : 0, rating: rating ?? null,
        setComment: Object.hasOwn(req.body || {}, 'comment') ? 1 : 0, comment: comment ?? null,
        id,
      });
    const row = db.prepare(`SELECT ${MARK_COLS} FROM user_marks WHERE id = ?`).get(id);
    markRecosStale(db);
    res.json(row);
  });

  router.delete('/:id', (req, res) => {
    if (!requireViewing(req, res)) return;
    const db = req.app.locals.db;
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare(`SELECT user_id, work_id FROM user_marks WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (existing.user_id !== req.viewing_user_id) return res.status(403).json({ error: 'forbidden' });
    if (db.prepare('SELECT 1 FROM couple_sessions WHERE work_id = ?').get(existing.work_id)) {
      return res.status(409).json({ error: 'shared_experience_requires_mark' });
    }
    if (!moveToTrash(db, 'mark', id, req.viewing_user_id)) return res.status(404).json({ error: 'not_found' });
    markRecosStale(db);
    res.status(204).end();
  });

  return router;
}
