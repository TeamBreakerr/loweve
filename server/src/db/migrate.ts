// server/src/db/migrate.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 运行 schema.sql 创建所有表（IF NOT EXISTS 幂等）。
 */
export function applySchema(db: any) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
}

/**
 * 种子两个固定用户（id=1=A, id=2=B），从环境变量读 display_name。
 * 已存在时不覆盖（用户可能改过头像/名字）。
 */
export function seedUsers(db: any, { userA, userB }: any) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO users (id, display_name) VALUES (?, ?)
  `);
  stmt.run(1, userA);
  stmt.run(2, userB);
}

/**
 * 把 couple_sessions.watched_at 从早期的 NOT NULL 改成可空（有时忘了哪天看的）。
 * SQLite 改列须重建表；幂等：仅当当前为 NOT NULL 时执行，保留所有数据。返回是否实际迁移过。
 */
export function migrateNullableWatchedAt(db: any) {
  const col = db.prepare(`SELECT "notnull" AS nn FROM pragma_table_info('couple_sessions') WHERE name = 'watched_at'`).get();
  if (!col || col.nn !== 1) return false;   // 表不存在或已可空
  db.transaction(() => {
    db.exec(`CREATE TABLE couple_sessions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_id INTEGER NOT NULL REFERENCES works(id),
      watched_at INTEGER,
      rating_a INTEGER CHECK(rating_a BETWEEN 1 AND 10),
      rating_b INTEGER CHECK(rating_b BETWEEN 1 AND 10),
      review_a TEXT,
      review_b TEXT,
      joint_note TEXT,
      created_at INTEGER NOT NULL
    );`);
    db.exec(`INSERT INTO couple_sessions_new (id, work_id, watched_at, rating_a, rating_b, review_a, review_b, joint_note, created_at)
      SELECT id, work_id, watched_at, rating_a, rating_b, review_a, review_b, joint_note, created_at FROM couple_sessions;`);
    db.exec(`DROP TABLE couple_sessions;`);
    db.exec(`ALTER TABLE couple_sessions_new RENAME TO couple_sessions;`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_couple_sessions_watched ON couple_sessions(watched_at DESC);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_couple_sessions_work ON couple_sessions(work_id);`);
  })();
  return true;
}

/**
 * 给 works 表补 aka_titles 列（老库迁移）。幂等：列已存在则跳过。
 */
export function migrateAddAkaTitles(db: any) {
  const has = db.prepare(`SELECT 1 FROM pragma_table_info('works') WHERE name = 'aka_titles'`).get();
  if (has) return false;
  db.exec(`ALTER TABLE works ADD COLUMN aka_titles TEXT`);
  return true;
}

/**
 * 完整迁移：创表 + 列迁移 + 种子。idempotent。
 */
export function migrate(db: any, { userA, userB }: any) {
  applySchema(db);
  migrateNullableWatchedAt(db);
  migrateAddAkaTitles(db);
  seedUsers(db, { userA, userB });
}
