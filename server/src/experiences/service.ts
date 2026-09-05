export type ExperienceKind = 'movie' | 'game';

type ExperienceSeed = {
  rating?: number | null;
  comment?: string | null;
};

const CONFIG = {
  movie: { marks: 'user_marks', status: 'watched' },
  game: { marks: 'game_marks', status: 'played' },
} as const;

/**
 * 共同体验只声明“双方共同发生过”。双方的评分和评价始终写入各自唯一的个人体验记录。
 * 已有个人值优先，seed 只补空；这使旧 session 数据迁移和新增共同记录使用同一条规则。
 */
export function ensureExperiencePair(
  db: any,
  kind: ExperienceKind,
  workId: number,
  markedAt: number,
  seeds: Partial<Record<1 | 2, ExperienceSeed>> = {},
) {
  const { marks, status } = CONFIG[kind];
  const upsert = db.prepare(`INSERT INTO ${marks}
    (user_id, work_id, status, rating, comment, marked_at)
    VALUES (@user_id, @work_id, @status, @rating, @comment, @marked_at)
    ON CONFLICT(user_id, work_id) DO UPDATE SET
      marked_at = CASE WHEN ${marks}.status <> excluded.status THEN excluded.marked_at ELSE ${marks}.marked_at END,
      status = excluded.status,
      rating = COALESCE(${marks}.rating, excluded.rating),
      comment = COALESCE(${marks}.comment, excluded.comment)`);

  for (const userId of [1, 2] as const) {
    const seed = seeds[userId] || {};
    upsert.run({
      user_id: userId,
      work_id: workId,
      status,
      rating: seed.rating ?? null,
      comment: seed.comment ?? null,
      marked_at: markedAt,
    });
  }
}

const MOVIE_SESSION_SELECT = `
  s.id, s.work_id, s.watched_at, s.joint_note, s.created_at,
  mark_a.rating AS rating_a, mark_b.rating AS rating_b,
  mark_a.comment AS review_a, mark_b.comment AS review_b`;
const MOVIE_SESSION_JOINS = `
  LEFT JOIN user_marks mark_a ON mark_a.work_id = s.work_id AND mark_a.user_id = 1
  LEFT JOIN user_marks mark_b ON mark_b.work_id = s.work_id AND mark_b.user_id = 2`;

export function listMovieSessions(db: any, workId?: number) {
  const where = workId == null ? '' : 'WHERE s.work_id = ?';
  const params = workId == null ? [] : [workId];
  return db.prepare(`SELECT ${MOVIE_SESSION_SELECT}
    FROM couple_sessions s ${MOVIE_SESSION_JOINS}
    ${where} ORDER BY s.watched_at DESC, s.id DESC`).all(...params);
}

export function getMovieSession(db: any, id: number) {
  return db.prepare(`SELECT ${MOVIE_SESSION_SELECT}
    FROM couple_sessions s ${MOVIE_SESSION_JOINS}
    WHERE s.id = ?`).get(id);
}

const GAME_SESSION_SELECT = `
  s.id, s.work_id, s.played_at, s.completed_at, s.joint_note, s.created_at,
  mark_a.rating AS rating_a, mark_b.rating AS rating_b,
  mark_a.comment AS review_a, mark_b.comment AS review_b`;
const GAME_SESSION_JOINS = `
  LEFT JOIN game_marks mark_a ON mark_a.work_id = s.work_id AND mark_a.user_id = 1
  LEFT JOIN game_marks mark_b ON mark_b.work_id = s.work_id AND mark_b.user_id = 2`;

export function listGameSessions(
  db: any,
  options: { workId?: number; status?: 'playing' | 'completed' } = {},
) {
  const clauses: string[] = [];
  const params: any[] = [];
  if (options.workId != null) {
    clauses.push('s.work_id = ?');
    params.push(options.workId);
  }
  if (options.status === 'playing') {
    clauses.push('s.completed_at IS NULL');
  } else if (options.status === 'completed') {
    clauses.push('s.completed_at IS NOT NULL');
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`SELECT ${GAME_SESSION_SELECT}
    FROM game_sessions s ${GAME_SESSION_JOINS}
    ${where}
    ORDER BY CASE WHEN s.completed_at IS NULL THEN 0 ELSE 1 END,
             COALESCE(s.completed_at, s.played_at) DESC, s.id DESC`).all(...params);
}

export function getGameSession(db: any, id: number) {
  return db.prepare(`SELECT ${GAME_SESSION_SELECT}
    FROM game_sessions s ${GAME_SESSION_JOINS}
    WHERE s.id = ?`).get(id);
}

function columns(db: any, table: string) {
  return new Set(db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((row: any) => row.name));
}

function migrateMovieExperiences(db: any) {
  const sessionColumns = columns(db, 'couple_sessions');
  if (!sessionColumns.size) return false;
  const hasLegacyValues = ['rating_a', 'rating_b', 'review_a', 'review_b'].some(name => sessionColumns.has(name));
  const legacyProjection = hasLegacyValues
    ? 'rating_a, rating_b, review_a, review_b'
    : 'NULL AS rating_a, NULL AS rating_b, NULL AS review_a, NULL AS review_b';
  const sessions = db.prepare(`SELECT id, work_id, watched_at, joint_note, created_at, ${legacyProjection}
    FROM couple_sessions ORDER BY id`).all();
  for (const session of sessions) {
    ensureExperiencePair(db, 'movie', session.work_id, session.created_at, {
      1: { rating: session.rating_a, comment: session.review_a },
      2: { rating: session.rating_b, comment: session.review_b },
    });
  }
  if (!hasLegacyValues) return false;

  db.exec(`CREATE TABLE couple_sessions_experience_migration (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER NOT NULL REFERENCES works(id),
    watched_at INTEGER,
    joint_note TEXT,
    created_at INTEGER NOT NULL
  )`);
  db.exec(`INSERT INTO couple_sessions_experience_migration
    (id, work_id, watched_at, joint_note, created_at)
    SELECT id, work_id, watched_at, joint_note, created_at FROM couple_sessions`);
  db.exec('DROP TABLE couple_sessions');
  db.exec('ALTER TABLE couple_sessions_experience_migration RENAME TO couple_sessions');
  db.exec('CREATE INDEX IF NOT EXISTS idx_couple_sessions_watched ON couple_sessions(watched_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_couple_sessions_work ON couple_sessions(work_id)');
  return true;
}

function migrateGameExperiences(db: any) {
  const sessionColumns = columns(db, 'game_sessions');
  if (!sessionColumns.size) return false;
  const hasLegacyValues = ['rating_a', 'rating_b', 'review_a', 'review_b'].some(name => sessionColumns.has(name));
  const legacyProjection = hasLegacyValues
    ? 'rating_a, rating_b, review_a, review_b'
    : 'NULL AS rating_a, NULL AS rating_b, NULL AS review_a, NULL AS review_b';
  const sessions = db.prepare(`SELECT id, work_id, played_at, completed_at, joint_note, created_at, ${legacyProjection}
    FROM game_sessions ORDER BY id`).all();
  for (const session of sessions) {
    ensureExperiencePair(db, 'game', session.work_id, session.created_at, {
      1: { rating: session.rating_a, comment: session.review_a },
      2: { rating: session.rating_b, comment: session.review_b },
    });
  }
  if (!hasLegacyValues) return false;

  db.exec(`CREATE TABLE game_sessions_experience_migration (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER NOT NULL UNIQUE REFERENCES game_works(id),
    played_at INTEGER,
    completed_at INTEGER,
    joint_note TEXT,
    created_at INTEGER NOT NULL
  )`);
  db.exec(`INSERT INTO game_sessions_experience_migration
    (id, work_id, played_at, completed_at, joint_note, created_at)
    SELECT id, work_id, played_at, completed_at, joint_note, created_at FROM game_sessions`);
  db.exec('DROP TABLE game_sessions');
  db.exec('ALTER TABLE game_sessions_experience_migration RENAME TO game_sessions');
  db.exec('CREATE INDEX IF NOT EXISTS idx_game_sessions_played ON game_sessions(played_at DESC, id DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_game_sessions_completed ON game_sessions(completed_at DESC, id DESC)');
  return true;
}

/** 迁移旧共同记录中的重复评分/评价，并物理删除四个冗余列。整体事务且可重复执行。 */
export function migrateSessionExperiences(db: any) {
  let changed = false;
  db.transaction(() => {
    changed = migrateMovieExperiences(db) || changed;
    changed = migrateGameExperiences(db) || changed;
  })();
  return changed;
}
