export type GameTrashEntityType = 'mark' | 'session' | 'plan';

const TABLES: Record<GameTrashEntityType, string> = {
  mark: 'game_marks',
  session: 'game_sessions',
  plan: 'game_plan_items',
};

export function moveGameToTrash(db: any, entityType: GameTrashEntityType, id: number, deletedBy?: number | null) {
  const table = TABLES[entityType];
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) return false;
  db.transaction(() => {
    db.prepare(`INSERT INTO game_trash_items
      (entity_type, entity_id, work_id, payload, deleted_at, deleted_by)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(entityType, row.id, row.work_id, JSON.stringify(row), Date.now(), deletedBy ?? null);
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  })();
  return true;
}

export function parseGameTrashPayload(item: any) {
  try { return JSON.parse(item.payload); }
  catch { return null; }
}

export function restoreGameTrashItem(db: any, trashId: number): any {
  const item = db.prepare('SELECT * FROM game_trash_items WHERE id = ?').get(trashId);
  if (!item) return { status: 'not_found' };
  const payload = parseGameTrashPayload(item);
  const entityType = item.entity_type as GameTrashEntityType;
  if (!payload || !TABLES[entityType]) return { status: 'invalid' };

  const table = TABLES[entityType];
  const conflict = entityType === 'mark'
    ? db.prepare(`SELECT 1 FROM ${table} WHERE user_id = ? AND work_id = ?`).get(payload.user_id, payload.work_id)
    : db.prepare(`SELECT 1 FROM ${table} WHERE work_id = ?`).get(payload.work_id);
  if (conflict) return { status: 'conflict' };

  const id = db.transaction(() => {
    let info: any;
    if (entityType === 'mark') {
      info = db.prepare(`INSERT INTO game_marks
        (user_id, work_id, status, rating, comment, marked_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(payload.user_id, payload.work_id, payload.status, payload.rating, payload.comment, payload.marked_at);
    } else if (entityType === 'session') {
      info = db.prepare(`INSERT INTO game_sessions
        (work_id, played_at, completed_at, rating_a, rating_b, review_a, review_b, joint_note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(payload.work_id, payload.played_at, payload.completed_at ?? null, payload.rating_a, payload.rating_b,
          payload.review_a, payload.review_b, payload.joint_note, payload.created_at);
    } else {
      info = db.prepare(`INSERT INTO game_plan_items
        (work_id, added_by, note, priority, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(payload.work_id, payload.added_by, payload.note, payload.priority,
          payload.status, payload.created_at, payload.updated_at);
    }
    db.prepare('DELETE FROM game_trash_items WHERE id = ?').run(trashId);
    return Number(info.lastInsertRowid);
  })();
  return { status: 'restored', entityType, id };
}
