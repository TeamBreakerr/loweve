// server/src/db/migrate.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateSessionExperiences } from '../experiences/service.js';

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
 * 给共同游戏记录补通关日期。旧记录不推测完成状态，统一保留为 NULL（正在玩）。
 * 索引也在迁移后创建，避免旧表尚无列时 applySchema 直接失败。
 */
export function migrateAddGameCompletedAt(db: any) {
  const table = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'game_sessions'`).get();
  if (!table) return false;
  const has = db.prepare(`SELECT 1 FROM pragma_table_info('game_sessions') WHERE name = 'completed_at'`).get();
  if (!has) db.exec(`ALTER TABLE game_sessions ADD COLUMN completed_at INTEGER`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_game_sessions_completed ON game_sessions(completed_at DESC, id DESC)`);
  return !has;
}

/**
 * 把最初仅支持 Steam 的 game_works 升级成 IGDB 主目录模型。
 * 旧 Steam 记录原样保留，并以 catalog_source=steam 迁入；父表 id 不变，子表引用不失效。
 */
export function migrateGameCatalogSchema(db: any) {
  const table = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'game_works'`).get();
  if (!table) return false;
  const has = db.prepare(`SELECT 1 FROM pragma_table_info('game_works') WHERE name = 'igdb_id'`).get();
  if (has) return false;
  const fkWasOn = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`CREATE TABLE game_works_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        igdb_id INTEGER UNIQUE,
        steam_appid INTEGER UNIQUE,
        catalog_source TEXT NOT NULL DEFAULT 'igdb' CHECK(catalog_source IN ('igdb', 'steam', 'manual')),
        content_type TEXT NOT NULL DEFAULT 'game' CHECK(content_type IN ('game', 'dlc')),
        parent_igdb_id INTEGER,
        parent_steam_appid INTEGER,
        parent_title TEXT,
        title TEXT NOT NULL,
        original_title TEXT,
        release_date TEXT,
        release_year INTEGER,
        release_state TEXT NOT NULL DEFAULT 'released' CHECK(release_state IN ('released', 'unreleased', 'early_access')),
        is_free INTEGER NOT NULL DEFAULT 0,
        short_description TEXT,
        about_game TEXT,
        developers TEXT,
        publishers TEXT,
        genres TEXT,
        platforms TEXT,
        play_modes TEXT,
        supports_together INTEGER NOT NULL DEFAULT 0,
        cover_url TEXT,
        header_url TEXT,
        price_currency TEXT,
        initial_price INTEGER,
        current_price INTEGER,
        discount_percent INTEGER NOT NULL DEFAULT 0,
        price_formatted TEXT,
        discount_end_date TEXT,
        review_score INTEGER,
        review_desc TEXT,
        review_positive INTEGER,
        review_negative INTEGER,
        review_total INTEGER,
        review_percent INTEGER,
        recent_review_score INTEGER,
        recent_review_desc TEXT,
        recent_review_positive INTEGER,
        recent_review_negative INTEGER,
        recent_review_total INTEGER,
        recent_review_percent INTEGER,
        catalog_rating REAL,
        catalog_rating_count INTEGER,
        critic_rating REAL,
        critic_rating_count INTEGER,
        igdb_url TEXT,
        external_links TEXT,
        igdb_raw TEXT,
        steam_raw TEXT,
        reviews_raw TEXT,
        fetched_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK(igdb_id IS NOT NULL OR steam_appid IS NOT NULL)
      );`);
      db.exec(`INSERT INTO game_works_new (
        id, igdb_id, steam_appid, catalog_source, content_type, parent_igdb_id, parent_steam_appid,
        parent_title, title, original_title, release_date, release_year,
        release_state, is_free, short_description, about_game, developers, publishers, genres,
        platforms, play_modes, supports_together, cover_url, header_url, price_currency, initial_price,
        current_price, discount_percent, price_formatted, discount_end_date, review_score, review_desc, review_positive,
        review_negative, review_total, review_percent, recent_review_score, recent_review_desc,
        recent_review_positive, recent_review_negative, recent_review_total, recent_review_percent,
        catalog_rating, catalog_rating_count, critic_rating, critic_rating_count, igdb_url,
        external_links, igdb_raw, steam_raw, reviews_raw, fetched_at, updated_at)
        SELECT id, NULL, steam_appid, 'steam', 'game', NULL, NULL, NULL,
        title, original_title, release_date, release_year,
        release_state, is_free, short_description, about_game, developers, publishers, genres,
        platforms, play_modes, supports_together, cover_url, header_url, price_currency, initial_price,
        current_price, discount_percent, price_formatted, NULL, review_score, review_desc, review_positive,
        review_negative, review_total, review_percent, recent_review_score, recent_review_desc,
        recent_review_positive, recent_review_negative, recent_review_total, recent_review_percent,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, steam_raw, reviews_raw, fetched_at, updated_at
        FROM game_works;`);
      db.exec(`DROP TABLE game_works;`);
      db.exec(`ALTER TABLE game_works_new RENAME TO game_works;`);
    })();
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON');
  }
  return true;
}

/**
 * 给游戏目录补充“本体 / DLC”分类与所属本体身份。
 * 旧记录没有可靠证据可判为 DLC，统一保留为游戏本体；后续刷新会按 IGDB/Steam 纠正。
 */
export function migrateAddGameContentType(db: any) {
  const table = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'game_works'`).get();
  if (!table) return false;
  const columns = new Set(db.prepare(`SELECT name FROM pragma_table_info('game_works')`).all().map((row: any) => row.name));
  let changed = false;
  if (!columns.has('content_type')) {
    db.exec(`ALTER TABLE game_works ADD COLUMN content_type TEXT NOT NULL DEFAULT 'game' CHECK(content_type IN ('game', 'dlc'))`);
    changed = true;
  }
  if (!columns.has('parent_igdb_id')) {
    db.exec(`ALTER TABLE game_works ADD COLUMN parent_igdb_id INTEGER`);
    changed = true;
  }
  if (!columns.has('parent_steam_appid')) {
    db.exec(`ALTER TABLE game_works ADD COLUMN parent_steam_appid INTEGER`);
    changed = true;
  }
  if (!columns.has('parent_title')) {
    db.exec(`ALTER TABLE game_works ADD COLUMN parent_title TEXT`);
    changed = true;
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_game_works_content_type ON game_works(content_type, updated_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_game_works_parent_igdb ON game_works(parent_igdb_id) WHERE parent_igdb_id IS NOT NULL`);
  return changed;
}

/** 给游戏作品补 Steam 官方促销截止日（YYYY-MM-DD）；无明确日期时保持 NULL。 */
export function migrateAddGameDiscountEndDate(db: any) {
  const table = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'game_works'`).get();
  if (!table) return false;
  const has = db.prepare(`SELECT 1 FROM pragma_table_info('game_works') WHERE name = 'discount_end_date'`).get();
  if (has) return false;
  db.exec(`ALTER TABLE game_works ADD COLUMN discount_end_date TEXT`);
  return true;
}

/**
 * 给 works 加 season_number 列（NULL=整部，N=第N季），并去掉表级 UNIQUE(tmdb_id, tmdb_type)。
 * SQLite 表级 UNIQUE 是隐式索引、不可单独 DROP → 必须表重建。幂等：列已存在则跳过。
 * 事务 + foreign_keys=OFF（重建的是父表 works，子表按名引用、id 值保留，引用不失效）。
 */
export function migrateAddSeasonNumber(db: any) {
  const has = db.prepare(`SELECT 1 FROM pragma_table_info('works') WHERE name = 'season_number'`).get();
  if (has) return false;
  const fkWasOn = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');   // 必须在事务外设置（事务内改此 pragma 无效）
  try {
    db.transaction(() => {
      db.exec(`CREATE TABLE works_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tmdb_id INTEGER NOT NULL,
        tmdb_type TEXT NOT NULL CHECK(tmdb_type IN ('movie', 'tv')),
        season_number INTEGER,
        title TEXT NOT NULL,
        original_title TEXT,
        aka_titles TEXT,
        year INTEGER,
        overview TEXT,
        genres TEXT,
        runtime INTEGER,
        is_anime INTEGER NOT NULL DEFAULT 0,
        primary_rating REAL,
        primary_rating_count INTEGER,
        primary_poster_url TEXT,
        rating_source TEXT NOT NULL CHECK(rating_source IN ('bangumi', 'douban', 'tmdb')),
        bangumi_id INTEGER,
        douban_id TEXT,
        douban_url TEXT,
        imdb_id TEXT,
        tmdb_raw TEXT NOT NULL,
        bangumi_raw TEXT,
        douban_raw TEXT,
        fetched_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );`);
      db.exec(`INSERT INTO works_new
        (id, tmdb_id, tmdb_type, season_number, title, original_title, aka_titles, year, overview, genres, runtime, is_anime, primary_rating, primary_rating_count, primary_poster_url, rating_source, bangumi_id, douban_id, douban_url, imdb_id, tmdb_raw, bangumi_raw, douban_raw, fetched_at, updated_at)
        SELECT id, tmdb_id, tmdb_type, NULL, title, original_title, aka_titles, year, overview, genres, runtime, is_anime, primary_rating, primary_rating_count, primary_poster_url, rating_source, bangumi_id, douban_id, douban_url, imdb_id, tmdb_raw, bangumi_raw, douban_raw, fetched_at, updated_at
        FROM works;`);
      db.exec(`DROP TABLE works;`);
      db.exec(`ALTER TABLE works_new RENAME TO works;`);
    })();
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON');
  }
  return true;
}

/**
 * 完整迁移：创表 + 列迁移 + 种子。idempotent。
 */
export function migrate(db: any, { userA, userB }: any) {
  applySchema(db);
  migrateNullableWatchedAt(db);
  migrateAddAkaTitles(db);
  migrateAddSeasonNumber(db);
  migrateGameCatalogSchema(db);
  migrateAddGameContentType(db);
  migrateAddGameDiscountEndDate(db);
  migrateAddGameCompletedAt(db);
  seedUsers(db, { userA, userB });
  migrateSessionExperiences(db);
  // 身份唯一索引：整部(NULL→-1)与各季各自唯一。放在此处（列已确保存在）而非 schema.sql，
  // 避免老库 applySchema 阶段 season_number 尚不存在导致 COALESCE 报错。
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_works_identity ON works(tmdb_id, tmdb_type, COALESCE(season_number, -1));`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_game_works_igdb ON game_works(igdb_id) WHERE igdb_id IS NOT NULL;`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_game_works_steam ON game_works(steam_appid) WHERE steam_appid IS NOT NULL;`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_game_works_rating ON game_works(review_percent DESC, review_total DESC);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_game_works_release ON game_works(release_state, release_year DESC);`);
}
