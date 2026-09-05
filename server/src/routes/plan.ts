// server/src/routes/plan.js
import { Router } from 'express';
import { upsertWork } from './works.js';
import type { PlanItem } from '../../../shared/types.js';
import { moveToTrash } from '../trash/service.js';

const PLAN_COLS = 'id, work_id, added_by, note, priority, status, created_at, updated_at';
const VALID_STATUS = ['pending', 'watching', 'done', 'dropped'];

export function planRoutes() {
  const router = Router();

  router.get('/', (req, res) => {
    const db = req.app.locals.db;
    const status = req.query.status as string;
    let rows: any;
    if (status) {
      if (!VALID_STATUS.includes(status)) return res.status(400).json({ error: 'invalid_status' });
      rows = db.prepare(`SELECT ${PLAN_COLS} FROM plan_items WHERE status = ? ORDER BY created_at DESC, id DESC`).all(status);
    } else {
      rows = db.prepare(`SELECT ${PLAN_COLS} FROM plan_items ORDER BY created_at DESC, id DESC`).all();
    }
    const workIds = [...new Set(rows.map((r: any) => r.work_id))];
    const works = workIds.length
      ? db.prepare(`SELECT * FROM works WHERE id IN (${workIds.map(() => '?').join(',')})`).all(...workIds)
      : [];
    const workMap = new Map(works.map((w: any) => [w.id, w]));
    res.json({ items: rows.map((r: any) => ({ ...r, work: workMap.get(r.work_id) })) satisfies PlanItem[] });
  });

  router.post('/', async (req, res) => {
    if (!req.viewing_user_id) return res.status(401).json({ error: 'not_authenticated' });
    const db = req.app.locals.db;
    const tmdb = req.app.locals.tmdb;
    const { work_id, tmdb_id, tmdb_type, season_number, note, priority } = req.body || {};
    const prio = priority ?? 0;
    if (!Number.isInteger(prio) || prio < 0 || prio > 3) return res.status(400).json({ error: 'invalid_priority' });

    let finalWorkId = work_id;
    if (!finalWorkId) {
      if (!Number.isInteger(tmdb_id) || (tmdb_type !== 'movie' && tmdb_type !== 'tv')) {
        return res.status(400).json({ error: 'work_id_or_tmdb_required' });
      }
      try {
        const w = await upsertWork(db, tmdb, req.app.locals.bangumi, req.app.locals.douban, { tmdb_id, tmdb_type, season_number });
        finalWorkId = w.id;
      } catch (e) {
        return res.status(502).json({ error: e.code || 'tmdb_unknown' });
      }
    }

    const now = Date.now();
    try {
      const info = db.prepare(`INSERT INTO plan_items (work_id, added_by, note, priority, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)`)
        .run(finalWorkId, req.viewing_user_id, note ?? null, prio, now, now);
      const row = db.prepare(`SELECT ${PLAN_COLS} FROM plan_items WHERE id = ?`).get(info.lastInsertRowid);
      res.json(row satisfies PlanItem);
    } catch (e) {
      if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'plan_exists' });
      throw e;
    }
  });

  router.put('/:id', (req, res) => {
    const db = req.app.locals.db;
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare(`SELECT ${PLAN_COLS} FROM plan_items WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const { note, priority, status } = req.body || {};
    if (status !== undefined && !VALID_STATUS.includes(status)) return res.status(400).json({ error: 'invalid_status' });
    if (priority !== undefined && (!Number.isInteger(priority) || priority < 0 || priority > 3)) return res.status(400).json({ error: 'invalid_priority' });

    // 注意：better-sqlite3 不支持混用匿名 ? 与编号 ?N，统一用命名参数 @name
    db.prepare(`UPDATE plan_items SET
      note = CASE WHEN @note IS NOT NULL THEN @note ELSE note END,
      priority = CASE WHEN @priority IS NOT NULL THEN @priority ELSE priority END,
      status = COALESCE(@status, status),
      updated_at = @updated_at
      WHERE id = @id`).run({ note: note ?? null, priority: priority ?? null, status: status ?? null, updated_at: Date.now(), id });
    const row = db.prepare(`SELECT ${PLAN_COLS} FROM plan_items WHERE id = ?`).get(id);
    res.json(row);
  });

  router.delete('/:id', (req, res) => {
    const db = req.app.locals.db;
    const id = parseInt(req.params.id, 10);
    if (!moveToTrash(db, 'plan', id, req.viewing_user_id)) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  });

  return router;
}
