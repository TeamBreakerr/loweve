// server/src/recos/service.js
import { upsertWork } from '../routes/works.js';
import { buildMessages } from './prompt.js';
import { resolveTmdb } from './validate.js';
import { parseJsonArray } from '../llm/client.js';
import {
  nextBatchId, getStandingBatchId, setStandingBatchId,
  isRecosStale, clearRecosStale,
} from './state.js';

const ASK = 11;     // 让 LLM 给 11 条（留余量给验证丢弃）
const SHOW = 9;     // 展示至多 9 条：1 大卡 + 2 中卡 + 6 小卡（小卡铺满一行）

const READ_SQL = `
  SELECT r.id, r.reason, r.work_id, w.tmdb_type,
         w.title, w.year, w.is_anime, w.primary_poster_url AS poster_url,
         w.rating_source, w.primary_rating, w.douban_id, w.douban_url, w.bangumi_id
  FROM recommendations r JOIN works w ON w.id = r.work_id
  WHERE r.batch_id = @batch AND r.validated = 1 AND r.feedback IS NULL
  ORDER BY r.id ASC LIMIT ${SHOW}`;

export function readBatch(db: any, batchId: any) {
  if (!batchId) return [];
  return db.prepare(READ_SQL).all({ batch: batchId });
}

export function gatherContext(db: any) {
  const users = db.prepare('SELECT id, display_name FROM users ORDER BY id').all();
  const userA = users.find((u: any) => u.id === 1)?.display_name || 'A';
  const userB = users.find((u: any) => u.id === 2)?.display_name || 'B';

  const marks = (uid: any) => db.prepare(`
    SELECT w.tmdb_id, w.tmdb_type, w.title, w.year, m.status, m.rating, m.comment
    FROM user_marks m JOIN works w ON w.id = m.work_id
    WHERE m.user_id = ? ORDER BY m.marked_at DESC`).all(uid);
  const marksA = marks(1);
  const marksB = marks(2);

  const sessions = db.prepare(`
    SELECT w.tmdb_id, w.tmdb_type, w.title, w.year, s.rating_a, s.rating_b, s.review_a, s.review_b, s.joint_note
    FROM couple_sessions s JOIN works w ON w.id = s.work_id
    ORDER BY s.watched_at DESC`).all();

  const plan = db.prepare(`
    SELECT w.tmdb_id, w.tmdb_type, w.title, w.year
    FROM plan_items p JOIN works w ON w.id = p.work_id
    ORDER BY p.created_at DESC`).all();

  const avoidTitles = db.prepare(`
    SELECT DISTINCT raw_title FROM recommendations
    WHERE feedback IN ('not_interested', 'already_seen')`).all().map((r: any) => r.raw_title);

  const knownKeys = new Set();
  for (const w of [...marksA, ...marksB, ...sessions, ...plan]) {
    knownKeys.add(`${w.tmdb_type}:${w.tmdb_id}`);
  }
  // 避雷池硬过滤：被标「没兴趣/看过」且已解析到 work 的作品也加入 knownKeys，
  // 即使 LLM 无视 prompt 里的避雷池文字也不会被重新推荐（prompt 只是软提示）。
  const avoided = db.prepare(`
    SELECT DISTINCT w.tmdb_type, w.tmdb_id
    FROM recommendations r JOIN works w ON w.id = r.work_id
    WHERE r.feedback IN ('not_interested', 'already_seen')`).all();
  for (const w of avoided) knownKeys.add(`${w.tmdb_type}:${w.tmdb_id}`);

  return { userA, userB, marksA, marksB, sessions, plan, avoidTitles, knownKeys };
}

export async function generateStanding(db: any, deps: any, { userPrompt = null } = {}) {
  const ctx = gatherContext(db);
  const messages = buildMessages({ ...ctx, userPrompt });
  const raw = await deps.llm.chat(messages);          // 失败抛 LlmError → 由 getCurrentRecos 捕获
  const items = parseJsonArray(raw).slice(0, ASK);

  const batch_id = nextBatchId();
  const rec_type = userPrompt ? 'custom' : 'standing';
  const now = Date.now();
  const insert = db.prepare(`INSERT INTO recommendations
    (batch_id, rec_type, user_prompt, work_id, raw_title, raw_original_title, raw_year, raw_type, reason, validated, created_at)
    VALUES (@batch_id, @rec_type, @user_prompt, @work_id, @raw_title, @raw_original_title, @raw_year, @raw_type, @reason, @validated, @created_at)`);

  const seen = new Set();
  for (const it of items) {
    const title = String(it.title || '').trim();
    if (!title) continue;
    const type = it.type === 'tv' ? 'tv' : 'movie';
    const resolved = await resolveTmdb(deps.tmdb, { title, year: it.year, type });
    let work_id = null, validated = 0;
    if (resolved) {
      const key = `${resolved.tmdb_type}:${resolved.tmdb_id}`;
      if (ctx.knownKeys.has(key) || seen.has(key)) continue;   // 已知/重复跳过，不入库不展示
      seen.add(key);
      // 不再 skipUpgrade：番剧生成时同步升级 Bangumi（快），电影异步入队豆瓣（trickle，每部只抓一次缓存）。
      const work = await upsertWork(db, deps.tmdb, deps.bangumi, deps.douban,
        { tmdb_id: resolved.tmdb_id, tmdb_type: resolved.tmdb_type });
      work_id = work.id; validated = 1;
    }
    insert.run({
      batch_id, rec_type, user_prompt: userPrompt ?? null, work_id,
      raw_title: title, raw_original_title: it.original_title ?? null,
      raw_year: Number.isInteger(it.year) ? it.year : null, raw_type: type,
      reason: String(it.reason || '').trim() || '为你们挑的', validated, created_at: now,
    });
  }

  if (rec_type === 'standing') { setStandingBatchId(db, batch_id); clearRecosStale(db); }
  return { items: readBatch(db, batch_id), batch_id, rec_type };
}

export async function getCurrentRecos(db: any, deps: any) {
  if (!deps.llm?.isConfigured?.()) {
    const batchId = getStandingBatchId(db);
    return { items: readBatch(db, batchId), batch_id: batchId, rec_type: 'standing', stale: false, error: batchId ? null : 'llm_unconfigured' };
  }
  const batchId = getStandingBatchId(db);
  const stale = isRecosStale(db);
  if (!batchId || stale) {
    try {
      const r = await generateStanding(db, deps, {});
      return { ...r, stale: false, error: null };
    } catch {
      return { items: readBatch(db, batchId), batch_id: batchId, rec_type: 'standing', stale: true, error: 'llm_unavailable' };
    }
  }
  return { items: readBatch(db, batchId), batch_id: batchId, rec_type: 'standing', stale: false, error: null };
}
