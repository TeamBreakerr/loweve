import { Router } from 'express';
import { markRecosStale } from '../recos/state.js';
import { parseTrashPayload, restoreTrashItem } from '../trash/service.js';

function requireViewing(req: any, res: any) {
  if (req.viewing_user_id) return true;
  res.status(401).json({ error: 'not_authenticated' });
  return false;
}

export function trashRoutes() {
  const router = Router();

  router.get('/', (req, res) => {
    if (!requireViewing(req, res)) return;
    const db = req.app.locals.db;
    const rows = db.prepare(`SELECT
      t.id, t.entity_type, t.entity_id, t.work_id, t.payload, t.deleted_at, t.deleted_by,
      u.display_name AS deleted_by_name
      FROM trash_items t
      LEFT JOIN users u ON u.id = t.deleted_by
      ORDER BY t.deleted_at DESC, t.id DESC`).all();
    const workIds = [...new Set(rows.map((row: any) => row.work_id))];
    const works = workIds.length
      ? db.prepare(`SELECT * FROM works WHERE id IN (${workIds.map(() => '?').join(',')})`).all(...workIds)
      : [];
    const workMap = new Map(works.map((work: any) => [work.id, work]));
    const items = rows.map((row: any) => ({
      ...row,
      payload: parseTrashPayload(row),
      work: workMap.get(row.work_id),
    }));
    res.json({ items });
  });

  router.post('/:id/restore', (req, res) => {
    if (!requireViewing(req, res)) return;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });
    const result = restoreTrashItem(req.app.locals.db, id);
    if (result.status === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (result.status === 'invalid') return res.status(422).json({ error: 'invalid_trash_item' });
    if (result.status === 'conflict') return res.status(409).json({ error: 'restore_conflict' });
    if (result.entityType === 'mark' || result.entityType === 'session') markRecosStale(req.app.locals.db);
    res.json({ restored: true, entity_type: result.entityType, id: result.id });
  });

  router.delete('/:id', (req, res) => {
    if (!requireViewing(req, res)) return;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });
    const info = req.app.locals.db.prepare('DELETE FROM trash_items WHERE id = ?').run(id);
    if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  });

  return router;
}
