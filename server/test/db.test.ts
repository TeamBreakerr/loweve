// server/test/db.test.js
import assert from 'node:assert/strict';
import { makeTestDb } from './helpers.js';
import { openDb } from '../src/db/index.js';
import { migrate, migrateNullableWatchedAt, migrateAddGameCompletedAt, migrateAddGameContentType, migrateAddGameDiscountEndDate, migrateAddSeasonNumber, migrateGameCatalogSchema } from '../src/db/migrate.js';

describe('db migration', () => {
  it('创建影视与游戏两套隔离业务表', () => {
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
      'game_external_ids',
      'game_marks',
      'game_plan_items',
      'game_platform_releases',
      'game_recommendations',
      'game_review_aggregates',
      'game_sessions',
      'game_store_offers',
      'game_trash_items',
      'game_works',
      'plan_items',
      'recommendations',
      'trash_items',
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

  it('旧游戏共同记录补通关日期，原数据保留且不伪造完成状态', () => {
    const db = openDb(':memory:');
    db.exec(`CREATE TABLE game_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, work_id INTEGER NOT NULL UNIQUE,
      played_at INTEGER, rating_a INTEGER, rating_b INTEGER, review_a TEXT,
      review_b TEXT, joint_note TEXT, created_at INTEGER NOT NULL);`);
    db.prepare(`INSERT INTO game_sessions (work_id, played_at, rating_a, created_at)
      VALUES (7, 20260801, 9, 1)`).run();
    assert.equal(migrateAddGameCompletedAt(db), true);
    const row: any = db.prepare('SELECT * FROM game_sessions').get();
    assert.equal(row.played_at, 20260801);
    assert.equal(row.completed_at, null);
    assert.equal(migrateAddGameCompletedAt(db), false);
    db.close();
  });

  it('旧 Steam 游戏表升级为 IGDB 主目录时保留 id 与 Steam 数据', () => {
    const db = openDb(':memory:');
    db.exec(`CREATE TABLE game_works (
      id INTEGER PRIMARY KEY AUTOINCREMENT, steam_appid INTEGER NOT NULL UNIQUE, title TEXT NOT NULL,
      original_title TEXT, release_date TEXT, release_year INTEGER, release_state TEXT NOT NULL,
      is_free INTEGER NOT NULL, short_description TEXT, about_game TEXT, developers TEXT, publishers TEXT,
      genres TEXT, platforms TEXT, play_modes TEXT, supports_together INTEGER NOT NULL, cover_url TEXT,
      header_url TEXT, price_currency TEXT, initial_price INTEGER, current_price INTEGER,
      discount_percent INTEGER NOT NULL, price_formatted TEXT, review_score INTEGER, review_desc TEXT,
      review_positive INTEGER, review_negative INTEGER, review_total INTEGER, review_percent INTEGER,
      recent_review_score INTEGER, recent_review_desc TEXT, recent_review_positive INTEGER,
      recent_review_negative INTEGER, recent_review_total INTEGER, recent_review_percent INTEGER,
      steam_raw TEXT NOT NULL, reviews_raw TEXT, fetched_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);`);
    db.prepare(`INSERT INTO game_works (id, steam_appid, title, release_state, is_free,
      supports_together, discount_percent, steam_raw, fetched_at, updated_at)
      VALUES (9, 620, 'Portal 2', 'released', 0, 1, 0, '{}', 1, 1)`).run();
    assert.equal(migrateGameCatalogSchema(db), true);
    const row: any = db.prepare('SELECT id, igdb_id, steam_appid, catalog_source, title FROM game_works').get();
    assert.deepEqual(row, { id: 9, igdb_id: null, steam_appid: 620, catalog_source: 'steam', title: 'Portal 2' });
    db.prepare(`INSERT INTO game_works (igdb_id, catalog_source, title, release_state, is_free,
      supports_together, discount_percent, fetched_at, updated_at) VALUES (123, 'igdb', 'GBA Game',
      'released', 0, 0, 0, 1, 1)`).run();
    assert.equal(migrateGameCatalogSchema(db), false);
    db.close();
  });

  it('已有 IGDB 游戏表补 DLC 分类时旧记录保留为本体且迁移幂等', () => {
    const db = openDb(':memory:');
    db.exec(`CREATE TABLE game_works (
      id INTEGER PRIMARY KEY, igdb_id INTEGER, steam_appid INTEGER, catalog_source TEXT,
      title TEXT NOT NULL, updated_at INTEGER NOT NULL);`);
    db.exec(`INSERT INTO game_works VALUES (1, 123, NULL, 'igdb', '旧游戏', 1);`);
    assert.equal(migrateAddGameContentType(db), true);
    const row: any = db.prepare(`SELECT content_type, parent_igdb_id, parent_steam_appid, parent_title FROM game_works`).get();
    assert.deepEqual(row, { content_type: 'game', parent_igdb_id: null, parent_steam_appid: null, parent_title: null });
    assert.equal(migrateAddGameContentType(db), false);
    db.close();
  });

  it('已有游戏表补促销截止日且迁移幂等', () => {
    const db = openDb(':memory:');
    db.exec(`CREATE TABLE game_works (id INTEGER PRIMARY KEY, title TEXT NOT NULL);`);
    assert.equal(migrateAddGameDiscountEndDate(db), true);
    assert.ok(db.prepare(`SELECT 1 FROM pragma_table_info('game_works') WHERE name = 'discount_end_date'`).get());
    assert.equal(migrateAddGameDiscountEndDate(db), false);
    db.close();
  });
});

describe('migrateAddSeasonNumber', () => {
  // 造一个 season_number 之前的老库：老 works（表级 UNIQUE、无 season_number）+ 一条数据 + 一条子表引用
  function makeOldDb() {
    const db = openDb(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE works (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tmdb_id INTEGER NOT NULL,
      tmdb_type TEXT NOT NULL CHECK(tmdb_type IN ('movie','tv')), title TEXT NOT NULL,
      original_title TEXT, aka_titles TEXT, year INTEGER, overview TEXT, genres TEXT, runtime INTEGER,
      is_anime INTEGER NOT NULL DEFAULT 0, primary_rating REAL, primary_rating_count INTEGER,
      primary_poster_url TEXT, rating_source TEXT NOT NULL CHECK(rating_source IN ('bangumi','douban','tmdb')),
      bangumi_id INTEGER, douban_id TEXT, douban_url TEXT, imdb_id TEXT, tmdb_raw TEXT NOT NULL,
      bangumi_raw TEXT, douban_raw TEXT, fetched_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(tmdb_id, tmdb_type));`);
    db.exec(`CREATE TABLE user_marks (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, work_id INTEGER REFERENCES works(id), status TEXT, rating INTEGER, comment TEXT, marked_at INTEGER);`);
    db.prepare(`INSERT INTO works (id, tmdb_id, tmdb_type, title, rating_source, tmdb_raw, fetched_at, updated_at) VALUES (7, 66732, 'tv', '怪奇物语', 'tmdb', '{}', 1, 1)`).run();
    db.prepare(`INSERT INTO user_marks (work_id, user_id, status, marked_at) VALUES (7, 1, 'watched', 1)`).run();
    return db;
  }

  it('迁移保留数据、season_number 置 NULL、子表引用不失效、pragma 恢复', () => {
    const db = makeOldDb();
    const ran = migrateAddSeasonNumber(db);
    assert.equal(ran, true);
    const w: any = db.prepare('SELECT id, tmdb_id, title, season_number FROM works WHERE id = 7').get();
    assert.deepEqual([w.id, w.tmdb_id, w.title, w.season_number], [7, 66732, '怪奇物语', null]);
    const m: any = db.prepare('SELECT work_id FROM user_marks WHERE work_id = 7').get();
    assert.equal(m.work_id, 7);                                      // 子表引用完好
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);   // pragma 已恢复
    db.close();
  });

  it('幂等：第二次调用是 no-op', () => {
    const db = makeOldDb();
    migrateAddSeasonNumber(db);
    assert.equal(migrateAddSeasonNumber(db), false);
    db.close();
  });

  it('迁移后同剧「整部」与「第N季」可并存，且各自唯一', () => {
    const db = openDb(':memory:');
    migrate(db, { userA: 'A', userB: 'B' });   // 全量迁移建索引
    const ins = db.prepare(`INSERT INTO works (tmdb_id, tmdb_type, season_number, title, rating_source, tmdb_raw, fetched_at, updated_at) VALUES (?, 'tv', ?, ?, 'tmdb', '{}', 1, 1)`);
    ins.run(66732, null, '怪奇物语');       // 整部
    ins.run(66732, 1, '怪奇物语 第一季');    // 第1季
    ins.run(66732, 4, '怪奇物语 第四季');    // 第4季
    assert.equal((db.prepare('SELECT count(*) c FROM works WHERE tmdb_id = 66732').get() as any).c, 3);
    assert.throws(() => ins.run(66732, 4, '重复第四季'));  // 唯一索引挡重复季
    assert.throws(() => ins.run(66732, null, '重复整部')); // COALESCE 让 NULL 也唯一
    db.close();
  });
});
