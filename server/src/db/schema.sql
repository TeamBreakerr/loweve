-- ============ 用户 ============
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar TEXT
);

-- ============ 作品 ============
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id INTEGER NOT NULL,
  tmdb_type TEXT NOT NULL CHECK(tmdb_type IN ('movie', 'tv')),
  season_number INTEGER,           -- NULL=整部剧；N≥1=第N季（身份唯一索引见 migrate.ts）
  title TEXT NOT NULL,
  original_title TEXT,
  aka_titles TEXT,            -- JSON 数组：TMDB 英文名 + 各国 AKA，给豆瓣/Bangumi 匹配多比一道
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
  -- 身份唯一性由 migrate() 的 idx_works_identity 保证：(tmdb_id, tmdb_type, COALESCE(season_number,-1))
  -- 不用表级 UNIQUE(tmdb_id,tmdb_type)——那样同剧的整部+各季无法并存。
);

-- ============ 个人标记 ============
CREATE TABLE IF NOT EXISTS user_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  work_id INTEGER NOT NULL REFERENCES works(id),
  status TEXT NOT NULL CHECK(status IN ('watched', 'wish')),
  rating INTEGER CHECK(rating BETWEEN 1 AND 10),
  comment TEXT,
  marked_at INTEGER NOT NULL,
  UNIQUE(user_id, work_id)
);
CREATE INDEX IF NOT EXISTS idx_user_marks_user_status ON user_marks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_marks_marked_at ON user_marks(marked_at DESC);

-- ============ 一起看过 ============
CREATE TABLE IF NOT EXISTS couple_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id),
  watched_at INTEGER,                       -- 可空：有时忘了哪天看的
  joint_note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_couple_sessions_watched ON couple_sessions(watched_at DESC);
CREATE INDEX IF NOT EXISTS idx_couple_sessions_work ON couple_sessions(work_id);

-- ============ 一起想看 / 计划 ============
CREATE TABLE IF NOT EXISTS plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id),
  added_by INTEGER NOT NULL REFERENCES users(id),
  note TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'watching', 'done', 'dropped')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(work_id)
);
CREATE INDEX IF NOT EXISTS idx_plan_status_priority ON plan_items(status, priority DESC, created_at DESC);

-- ============ 回收站 ============
-- 保存被删除记录的完整快照；恢复时重新插回对应业务表。作品本身不删除，避免海报/详情丢失。
CREATE TABLE IF NOT EXISTS trash_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('mark', 'session', 'plan')),
  entity_id INTEGER NOT NULL,
  work_id INTEGER NOT NULL REFERENCES works(id),
  payload TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  deleted_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_trash_deleted_at ON trash_items(deleted_at DESC, id DESC);

-- ============ AI 推荐 ============
CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  rec_type TEXT NOT NULL CHECK(rec_type IN ('standing', 'custom')),
  user_prompt TEXT,
  work_id INTEGER REFERENCES works(id),
  raw_title TEXT NOT NULL,
  raw_original_title TEXT,
  raw_year INTEGER,
  raw_type TEXT CHECK(raw_type IN ('movie', 'tv')),
  reason TEXT NOT NULL,
  validated INTEGER NOT NULL DEFAULT 0,
  feedback TEXT CHECK(feedback IN ('interested', 'not_interested', 'already_seen')),
  feedback_by INTEGER REFERENCES users(id),
  feedback_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recs_batch ON recommendations(batch_id);
CREATE INDEX IF NOT EXISTS idx_recs_standing_latest ON recommendations(rec_type, created_at DESC);

-- ============ 游戏作品（IGDB 主目录；Steam 是可选增强源，与影视 works 完全隔离） ============
CREATE TABLE IF NOT EXISTS game_works (
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
  release_state TEXT NOT NULL DEFAULT 'released'
    CHECK(release_state IN ('released', 'unreleased', 'early_access')),
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
);
CREATE INDEX IF NOT EXISTS idx_game_works_rating ON game_works(review_percent DESC, review_total DESC);
CREATE INDEX IF NOT EXISTS idx_game_works_release ON game_works(release_state, release_year DESC);

-- 一个作品可对应多个平台发行版；价格、外部 ID 都挂在具体作品/平台语境下，
-- 避免把 GBA 原版、PS5 重制版与 Steam 版混成同一个报价。
CREATE TABLE IF NOT EXISTS game_platform_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES game_works(id) ON DELETE CASCADE,
  igdb_platform_id INTEGER,
  platform_name TEXT NOT NULL,
  platform_abbreviation TEXT,
  release_date TEXT,
  release_year INTEGER,
  region TEXT,
  source TEXT NOT NULL DEFAULT 'igdb',
  UNIQUE(work_id, igdb_platform_id, release_date, region)
);
CREATE INDEX IF NOT EXISTS idx_game_platform_releases_work ON game_platform_releases(work_id);

CREATE TABLE IF NOT EXISTS game_external_ids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES game_works(id) ON DELETE CASCADE,
  release_id INTEGER REFERENCES game_platform_releases(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  url TEXT,
  UNIQUE(provider, external_id, country)
);
CREATE INDEX IF NOT EXISTS idx_game_external_ids_work ON game_external_ids(work_id);

CREATE TABLE IF NOT EXISTS game_store_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES game_works(id) ON DELETE CASCADE,
  release_id INTEGER REFERENCES game_platform_releases(id) ON DELETE SET NULL,
  store TEXT NOT NULL,
  country TEXT NOT NULL,
  currency TEXT,
  list_price_minor INTEGER,
  sale_price_minor INTEGER,
  discount_percent INTEGER NOT NULL DEFAULT 0,
  availability TEXT NOT NULL DEFAULT 'unknown'
    CHECK(availability IN ('available', 'preorder', 'free', 'unavailable', 'unknown')),
  store_url TEXT,
  source TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  expires_at INTEGER,
  UNIQUE(work_id, store, country)
);
CREATE INDEX IF NOT EXISTS idx_game_store_offers_work ON game_store_offers(work_id);

CREATE TABLE IF NOT EXISTS game_review_aggregates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES game_works(id) ON DELETE CASCADE,
  release_id INTEGER REFERENCES game_platform_releases(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  score REAL,
  scale REAL,
  positive INTEGER,
  negative INTEGER,
  total INTEGER,
  checked_at INTEGER NOT NULL,
  UNIQUE(work_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_game_review_aggregates_work ON game_review_aggregates(work_id);

-- ============ 个人游戏记录 ============
CREATE TABLE IF NOT EXISTS game_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  work_id INTEGER NOT NULL REFERENCES game_works(id),
  status TEXT NOT NULL DEFAULT 'played' CHECK(status = 'played'),
  rating INTEGER CHECK(rating BETWEEN 1 AND 10),
  comment TEXT,
  marked_at INTEGER NOT NULL,
  UNIQUE(user_id, work_id)
);
CREATE INDEX IF NOT EXISTS idx_game_marks_user ON game_marks(user_id, marked_at DESC);

-- ============ 一起玩过 ============
CREATE TABLE IF NOT EXISTS game_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL UNIQUE REFERENCES game_works(id),
  played_at INTEGER,
  completed_at INTEGER,
  joint_note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_sessions_played ON game_sessions(played_at DESC, id DESC);

-- ============ 想和你一起玩 ============
CREATE TABLE IF NOT EXISTS game_plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL UNIQUE REFERENCES game_works(id),
  added_by INTEGER NOT NULL REFERENCES users(id),
  note TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'playing', 'done', 'dropped')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_plan_status_priority ON game_plan_items(status, priority DESC, created_at DESC);

-- ============ 游戏回收站 ============
CREATE TABLE IF NOT EXISTS game_trash_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('mark', 'session', 'plan')),
  entity_id INTEGER NOT NULL,
  work_id INTEGER NOT NULL REFERENCES game_works(id),
  payload TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  deleted_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_game_trash_deleted_at ON game_trash_items(deleted_at DESC, id DESC);

-- ============ 游戏 AI 推荐 ============
CREATE TABLE IF NOT EXISTS game_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  rec_type TEXT NOT NULL CHECK(rec_type IN ('standing', 'custom')),
  user_prompt TEXT,
  work_id INTEGER REFERENCES game_works(id),
  raw_title TEXT NOT NULL,
  raw_original_title TEXT,
  raw_year INTEGER,
  raw_steam_appid INTEGER,
  reason TEXT NOT NULL,
  confidence_note TEXT,
  validated INTEGER NOT NULL DEFAULT 0,
  feedback TEXT CHECK(feedback IN ('interested', 'not_interested', 'already_seen')),
  feedback_by INTEGER REFERENCES users(id),
  feedback_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_recs_batch ON game_recommendations(batch_id);
CREATE INDEX IF NOT EXISTS idx_game_recs_standing_latest ON game_recommendations(rec_type, created_at DESC);

-- ============ 应用状态 ============
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL
);
