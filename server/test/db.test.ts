// server/test/db.test.js
import assert from 'node:assert/strict';
import { makeTestDb } from './helpers.js';
import { openDb } from '../src/db/index.js';
import { migrate, migrateNullableWatchedAt } from '../src/db/migrate.js';

describe('db migration', () => {
  it('创建 7 张表', () => {
    const db = makeTestDb();
    const rows = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all();
    const names = rows.map((r: any) => r.name);
    assert.deepEqual(names.sort(), [
      'app_state',
      'couple_sessions',
      'plan_items',
      'recommendations',
      'user_marks',
      'users',
      'works',
    ]);
    db.close();
  });

  it('种子两个用户', () => {
    const db = makeTestDb({ userA: '小爱', userB: '小波' });
    const rows = db.prepare('SELECT id, display_name FROM users ORDER BY id').all();
    assert.deepEqual(rows, [
      { id: 1, display_name: '小爱' },
      { id: 2, display_name: '小波' },
    ]);
    db.close();
  });

  it('migrateNullableWatchedAt：旧 NOT NULL 表 → 可空，数据保留，幂等', () => {
    const db = openDb(':memory:');
    db.exec(`CREATE TABLE works (id INTEGER PRIMARY KEY); INSERT INTO works (id) VALUES (1);`);
    db.exec(`CREATE TABLE couple_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, work_id INTEGER NOT NULL REFERENCES works(id),
      watched_at INTEGER NOT NULL, rating_a INTEGER, rating_b INTEGER,
      review_a TEXT, review_b TEXT, joint_note TEXT, created_at INTEGER NOT NULL);`);
    db.prepare(`INSERT INTO couple_sessions (work_id, watched_at, rating_a, joint_note, created_at) VALUES (1, 20240101, 8, '哭了', 111)`).run();

    assert.equal(migrateNullableWatchedAt(db), true);                 // 执行了迁移
    const row: any = db.prepare('SELECT * FROM couple_sessions').get();
    assert.equal(row.watched_at, 20240101);                           // 数据保留
    assert.equal(row.rating_a, 8);
    assert.equal(row.joint_note, '哭了');
    db.prepare(`INSERT INTO couple_sessions (work_id, watched_at, created_at) VALUES (1, NULL, 222)`).run();  // 现可空
    assert.equal((db.prepare('SELECT COUNT(*) c FROM couple_sessions WHERE watched_at IS NULL').get() as any).c, 1);
    assert.equal(migrateNullableWatchedAt(db), false);                // 幂等：已可空，不再动
    db.close();
  });

  it('users 种子幂等（已存在不覆盖）', () => {
    const db = makeTestDb({ userA: '老名字', userB: 'B' });
    db.prepare('UPDATE users SET display_name = ? WHERE id = 1').run('改后的名字');
    // 再跑一次 migrate，已有 row 应不被 INSERT OR IGNORE 覆盖
    migrate(db, { userA: '新名字', userB: 'B' });
    const row = db.prepare('SELECT display_name FROM users WHERE id = 1').get();
    assert.equal(row.display_name, '改后的名字');  // 不被覆盖
    db.close();
  });
});
