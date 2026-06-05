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
  title TEXT NOT NULL,
  original_title TEXT,
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
  updated_at INTEGER NOT NULL,
  UNIQUE(tmdb_id, tmdb_type)
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
  rating_a INTEGER CHECK(rating_a BETWEEN 1 AND 10),
  rating_b INTEGER CHECK(rating_b BETWEEN 1 AND 10),
  review_a TEXT,
  review_b TEXT,
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

-- ============ 应用状态 ============
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL
);
