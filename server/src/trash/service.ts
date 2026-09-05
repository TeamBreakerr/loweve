import { ensureExperiencePair } from '../experiences/service.js';

export type TrashEntityType = 'mark' | 'session' | 'plan';

const TABLES: Record<TrashEntityType, string> = {
  mark: 'user_marks',
  session: 'couple_sessions',
  plan: 'plan_items',
};

/**
 * 在同一事务里保存完整快照并删除业务记录。类型只来自服务端固定映射，不能传任意表名。
 */
export function moveToTrash(db: any, entityType: TrashEntityType, id: number, deletedBy?: number | null) {
  const table = TABLES[entityType];
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) return false;

  db.transaction(() => {
    db.prepare(`INSERT INTO trash_items
      (entity_type, entity_id, work_id, payload, deleted_at, deleted_by)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(entityType, row.id, row.work_id, JSON.stringify(row), Date.now(), deletedBy ?? null);
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  })();
  return true;
}

export function parseTrashPayload(item: any) {
  try {
    return JSON.parse(item.payload);
  } catch {
    return null;
  }
}

/**
 * 恢复为新 id，避免原 id 已被 SQLite AUTOINCREMENT 复用时覆盖其他数据。
 * 返回冲突而不是覆盖当前记录，回收站快照会继续保留。
 */
export function restoreTrashItem(db: any, trashId: number):
  | { status: 'not_found' }
  | { status: 'invalid' }
  | { status: 'conflict' }
  | { status: 'restored'; entityType: TrashEntityType; id: number } {
  const item = db.prepare('SELECT * FROM trash_items WHERE id = ?').get(trashId);
  if (!item) return { status: 'not_found' };
  const payload = parseTrashPayload(item);
  if (!payload || !TABLES[item.entity_type as TrashEntityType]) return { status: 'invalid' };

  const entityType = item.entity_type as TrashEntityType;
  let conflict: any;
  if (entityType === 'mark') {
    conflict = db.prepare('SELECT 1 FROM user_marks WHERE user_id = ? AND work_id = ?').get(payload.user_id, payload.work_id);
  } else if (entityType === 'session') {
    conflict = db.prepare('SELECT 1 FROM couple_sessions WHERE work_id = ?').get(payload.work_id);
  } else {
    conflict = db.prepare('SELECT 1 FROM plan_items WHERE work_id = ?').get(payload.work_id);
  }
  if (conflict) return { status: 'conflict' };

  const id = db.transaction(() => {
    let info: any;
    if (entityType === 'mark') {
      info = db.prepare(`INSERT INTO user_marks
        (user_id, work_id, status, rating, comment, marked_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(payload.user_id, payload.work_id, payload.status, payload.rating, payload.comment, payload.marked_at);
    } else if (entityType === 'session') {
      info = db.prepare(`INSERT INTO couple_sessions
        (work_id, watched_at, joint_note, created_at)
        VALUES (?, ?, ?, ?)`)
        .run(payload.work_id, payload.watched_at, payload.joint_note, payload.created_at);
      ensureExperiencePair(db, 'movie', payload.work_id, payload.created_at, {
        1: { rating: payload.rating_a, comment: payload.review_a },
        2: { rating: payload.rating_b, comment: payload.review_b },
      });
    } else {
      info = db.prepare(`INSERT INTO plan_items
        (work_id, added_by, note, priority, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(payload.work_id, payload.added_by, payload.note, payload.priority,
          payload.status, payload.created_at, payload.updated_at);
    }
    db.prepare('DELETE FROM trash_items WHERE id = ?').run(trashId);
    return Number(info.lastInsertRowid);
  })();

  return { status: 'restored', entityType, id };
}
