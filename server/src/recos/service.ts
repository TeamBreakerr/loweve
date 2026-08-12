// server/src/recos/service.js
import { upsertWork } from '../routes/works.js';
import type { Reco } from '../../../shared/types.js';
import { buildMessages } from './prompt.js';
import { resolveTmdb } from './validate.js';
import { parseJsonArray } from '../llm/client.js';
import {
  nextBatchId, getStandingBatchId, setStandingBatchId,
  isRecosStale, markRecosStale, clearRecosStale,
} from './state.js';

const ASK = 15;     // 首轮多给缓冲，抵消已看/避雷/重复项的硬过滤
const SHOW = 9;     // 展示至多 9 条：1 大卡 + 2 中卡 + 6 小卡（小卡铺满一行）
const GENERATION_LLM_BUDGET_MS = 150_000;
const MIN_SUPPLEMENT_BUDGET_MS = 30_000;

const READ_SQL = `
  SELECT r.id, r.reason, r.work_id, w.tmdb_type,
         w.title, w.year, w.is_anime, w.primary_poster_url AS poster_url,
         w.rating_source, w.primary_rating, w.douban_id, w.douban_url, w.bangumi_id
  FROM recommendations r JOIN works w ON w.id = r.work_id
  WHERE r.batch_id = @batch AND r.validated = 1 AND r.feedback IS NULL
  ORDER BY r.id ASC LIMIT ${SHOW}`;

const INSERT_SQL = `INSERT INTO recommendations
  (batch_id, rec_type, user_prompt, work_id, raw_title, raw_original_title, raw_year, raw_type, reason, validated, created_at)
  VALUES (@batch_id, @rec_type, @user_prompt, @work_id, @raw_title, @raw_original_title, @raw_year, @raw_type, @reason, @validated, @created_at)`;

export function readBatch(db: any, batchId: any): Reco[] {
  if (!batchId) return [];
  return db.prepare(READ_SQL).all({ batch: batchId });
}

export function gatherContext(db: any) {
  const users = db.prepare('SELECT id, display_name FROM users ORDER BY id').all();
  const userA = users.find((u: any) => u.id === 1)?.display_name || 'A';
  const userB = users.find((u: any) => u.id === 2)?.display_name || 'B';

  const marks = (uid: any) => db.prepare(`
    SELECT w.tmdb_id, w.tmdb_type, w.title, w.year, w.genres, w.is_anime, m.status, m.rating, m.comment
    FROM user_marks m JOIN works w ON w.id = m.work_id
    WHERE m.user_id = ? ORDER BY m.marked_at DESC`).all(uid);
  const marksA = marks(1);
  const marksB = marks(2);

  const sessions = db.prepare(`
    SELECT w.tmdb_id, w.tmdb_type, w.title, w.year, w.genres, w.is_anime,
           s.rating_a, s.rating_b, s.review_a, s.review_b, s.joint_note
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

function fillStandingBatch(db: any, {
  batchId, previousBatchId, insert, ctx, seen, shown, now,
}: { batchId: string; previousBatchId: string | null; insert: any; ctx: any; seen: Set<any>; shown: number; now: number }) {
  let fromHistory = 0;
  let fromCatalog = 0;

  // 优先复用此前已通过 TMDB/Bangumi/豆瓣校验的推荐；先选更早批次，最后才回用上一批，
  // 尽可能维持“换一批”的新鲜感。当前已看/想看/避雷项仍由 knownKeys 硬过滤。
  const history = db.prepare(`
    SELECT r.work_id, r.raw_title, r.raw_original_title, r.raw_year, r.raw_type, r.reason,
           w.tmdb_id, w.tmdb_type
    FROM recommendations r JOIN works w ON w.id = r.work_id
    WHERE r.batch_id <> @batch AND r.validated = 1 AND r.feedback IS NULL
    ORDER BY CASE WHEN r.batch_id = @previous THEN 1 ELSE 0 END,
             r.created_at DESC, r.id DESC
    LIMIT 500`).all({ batch: batchId, previous: previousBatchId });

  for (const row of history) {
    if (shown >= SHOW) break;
    const key = `${row.tmdb_type}:${row.tmdb_id}`;
    if (ctx.knownKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    insert.run({
      batch_id: batchId, rec_type: 'standing', user_prompt: null, work_id: row.work_id,
      raw_title: row.raw_title, raw_original_title: row.raw_original_title,
      raw_year: row.raw_year, raw_type: row.raw_type,
      reason: row.reason || '为你们挑的', validated: 1, created_at: now,
    });
    shown++;
    fromHistory++;
  }

  // 历史推荐仍不够时，从已建档的高评分片库兜底；只使用真实、已校验的作品。
  if (shown < SHOW) {
    const catalog = db.prepare(`
      SELECT id AS work_id, tmdb_id, tmdb_type, title, original_title, year
      FROM works
      ORDER BY CASE WHEN primary_rating IS NULL THEN 1 ELSE 0 END,
               primary_rating DESC, primary_rating_count DESC, updated_at DESC
      LIMIT 500`).all();
    for (const row of catalog) {
      if (shown >= SHOW) break;
      const key = `${row.tmdb_type}:${row.tmdb_id}`;
      if (ctx.knownKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      insert.run({
        batch_id: batchId, rec_type: 'standing', user_prompt: null, work_id: row.work_id,
        raw_title: row.title, raw_original_title: row.original_title,
        raw_year: row.year, raw_type: row.tmdb_type,
        reason: '片库中的高分佳作，适合你们一起尝试', validated: 1, created_at: now,
      });
      shown++;
      fromCatalog++;
    }
  }

  return { shown, fromHistory, fromCatalog };
}

// 已上线的旧版本可能已经留下不足 9 条的当前批次；读取时只用本地已校验片库补齐，
// 不启动 LLM，也不改变 batch_id，让修复部署后立即自愈。
export function ensureStandingBatchSize(db: any, batchId: string | null) {
  if (!batchId) return [];
  const current = db.prepare(`
    SELECT r.work_id, w.tmdb_id, w.tmdb_type
    FROM recommendations r JOIN works w ON w.id = r.work_id
    WHERE r.batch_id = ? AND r.validated = 1 AND r.feedback IS NULL
    ORDER BY r.id ASC LIMIT ${SHOW}`).all(batchId);
  if (current.length >= SHOW) return readBatch(db, batchId);

  const ctx = gatherContext(db);
  const seen = new Set(current.map((row: any) => `${row.tmdb_type}:${row.tmdb_id}`));
  const filled = fillStandingBatch(db, {
    batchId, previousBatchId: null, insert: db.prepare(INSERT_SQL), ctx, seen,
    shown: current.length, now: Date.now(),
  });
  if (filled.fromHistory || filled.fromCatalog) {
    console.info('[recos] 自愈补齐当前批次', {
      batch_id: batchId, from_history: filled.fromHistory,
      from_catalog: filled.fromCatalog, items: filled.shown,
    });
  }
  return readBatch(db, batchId);
}

export async function generateStanding(db: any, deps: any, { userPrompt = null } = {}) {
  const ctx = gatherContext(db);
  const llmDeadline = Date.now() + GENERATION_LLM_BUDGET_MS;
  const batch_id = nextBatchId();
  const rec_type = userPrompt ? 'custom' : 'standing';
  const previousBatchId = rec_type === 'standing' ? getStandingBatchId(db) : null;
  const now = Date.now();
  const insert = db.prepare(INSERT_SQL);

  const seen = new Set();
  const extraAvoid: string[] = [];   // 本批已出过的标题，补充轮塞进避雷池防重复
  let shown = 0;

  // 命中已看过/避雷池、TMDB 核实失败都会掉条目；掉到不足 SHOW 就再问一轮补齐，两轮封顶。
  // 健康情况下首轮就够，不产生额外 LLM 调用。
  for (let round = 0; round < 2 && shown < SHOW; round++) {
    const remainingMs = llmDeadline - Date.now();
    // 首轮过慢时不再开启补充轮；已有结果直接交付，避免总耗时重新膨胀到两倍。
    if (round > 0 && remainingMs < MIN_SUPPLEMENT_BUDGET_MS) break;
    const messages = buildMessages({ ...ctx, avoidTitles: [...ctx.avoidTitles, ...extraAvoid], userPrompt });
    let items: any[];
    try { items = parseJsonArray(await deps.llm.chat(messages, { timeoutMs: remainingMs })).slice(0, ASK); }
    catch (e) { if (round === 0) throw e; break; }   // 首轮失败照旧上抛给 getCurrentRecos；补充轮失败不作废已有结果

    // TMDB 核实并行做（原先逐条串行等网络往返，是生成耗时大头之一）；顺序由 map 保持 LLM 排位
    const resolved = await Promise.all(items.map(async (it: any) => {
      const title = String(it.title || '').trim();
      if (!title) return null;
      const type = it.type === 'tv' ? 'tv' : 'movie';
      return { it, title, type, hit: await resolveTmdb(deps.tmdb, { title, year: it.year, type }) };
    }));

    const rows: any[] = [];
    for (const r of resolved) {
      if (!r) continue;
      extraAvoid.push(r.title);
      if (r.hit) {
        const key = `${r.hit.tmdb_type}:${r.hit.tmdb_id}`;
        if (ctx.knownKeys.has(key) || seen.has(key)) continue;   // 已知/重复跳过，不入库不展示
        seen.add(key);
      }
      rows.push(r);
    }

    // 建档也并行（key 已去重，不会并发写同一部作品）；单条失败降级为未验证行，不再拖垮整批。
    // 不再 skipUpgrade：番剧生成时同步升级 Bangumi（快），电影异步入队豆瓣（trickle，每部只抓一次缓存）。
    await Promise.all(rows.filter(r => r.hit).map(async (r) => {
      try {
        const work = await upsertWork(db, deps.tmdb, deps.bangumi, deps.douban,
          { tmdb_id: r.hit.tmdb_id, tmdb_type: r.hit.tmdb_type });
        r.work_id = work.id;
      } catch { /* 网络抖动等，validated 保持 0 */ }
    }));

    for (const r of rows) {
      insert.run({
        batch_id, rec_type, user_prompt: userPrompt ?? null, work_id: r.work_id ?? null,
        raw_title: r.title, raw_original_title: r.it.original_title ?? null,
        raw_year: Number.isInteger(r.it.year) ? r.it.year : null, raw_type: r.type,
        reason: String(r.it.reason || '').trim() || '为你们挑的', validated: r.work_id ? 1 : 0, created_at: now,
      });
      if (r.work_id) shown++;
    }
  }

  if (rec_type === 'standing' && shown < SHOW) {
    const filled = fillStandingBatch(db, {
      batchId: batch_id, previousBatchId, insert, ctx, seen, shown, now,
    });
    shown = filled.shown;
    if (filled.fromHistory || filled.fromCatalog) {
      console.info('[recos] 本地补齐推荐', {
        batch_id, from_history: filled.fromHistory, from_catalog: filled.fromCatalog, items: shown,
      });
    }
  }

  if (rec_type === 'standing') {
    // 有旧批时绝不把不足 9 条的新批切成当前批次；后台调用会回落旧批并显示错误。
    if (shown < SHOW && previousBatchId) throw new Error('recos_insufficient');
    setStandingBatchId(db, batch_id);
    clearRecosStale(db);
  }
  return { items: readBatch(db, batch_id), batch_id, rec_type };
}

// 后台重生成的在飞守卫：手动刷新与 stale GET 共用，避免连续点击/轮询重复启动。
let regenInflight: Promise<void> | null = null;
let regenLastError: string | null = null;
export function whenRegenSettled() { return regenInflight ?? Promise.resolve(); }   // 供测试等待后台完成

function startStandingRegeneration(db: any, deps: any, reason: 'manual' | 'stale') {
  if (regenInflight) return false;
  regenLastError = null;
  const startedAt = Date.now();
  const model = deps.llm?.getModel?.() || 'unknown';
  console.info('[recos] 后台生成开始', { reason, model });
  regenInflight = generateStanding(db, deps, {})
    .then((result) => {
      console.info('[recos] 后台生成完成', {
        reason, model, elapsed_ms: Date.now() - startedAt,
        batch_id: result.batch_id, items: result.items.length,
      });
    })
    .catch((e: any) => {
      regenLastError = 'llm_unavailable';
      // 停止前端轮询风暴；下一次手动刷新或新的数据变更仍可重新触发。
      clearRecosStale(db);
      console.error('[recos] 后台生成失败', {
        reason, model, elapsed_ms: Date.now() - startedAt,
        code: e?.code || 'unknown', status: e?.status || 0, message: e?.message || String(e),
      });
    })
    .finally(() => { regenInflight = null; });
  return true;
}

function currentStandingPayload(db: any, { stale, error = null }: { stale: boolean; error?: string | null }) {
  const batchId = getStandingBatchId(db);
  return {
    items: ensureStandingBatchSize(db, batchId), batch_id: batchId, rec_type: 'standing',
    stale, generating: Boolean(regenInflight), error,
  };
}

export function requestStandingRefresh(db: any, deps: any) {
  if (!deps.llm?.isConfigured?.()) {
    return currentStandingPayload(db, { stale: false, error: 'llm_unconfigured' });
  }
  markRecosStale(db);
  startStandingRegeneration(db, deps, 'manual');
  return currentStandingPayload(db, { stale: true });
}

export async function getCurrentRecos(db: any, deps: any) {
  const batchId = getStandingBatchId(db);
  if (!deps.llm?.isConfigured?.()) {
    return { items: ensureStandingBatchSize(db, batchId), batch_id: batchId, rec_type: 'standing', stale: false, generating: false, error: batchId ? null : 'llm_unconfigured' };
  }
  if (regenInflight) {
    return currentStandingPayload(db, { stale: true });
  }
  if (!batchId) {
    // 首次没任何批次：只能阻塞生成
    try {
      const r = await generateStanding(db, deps, {});
      return { ...r, stale: false, generating: false, error: null };
    } catch {
      return { items: [], batch_id: null, rec_type: 'standing', stale: false, generating: false, error: 'llm_unavailable' };
    }
  }
  if (isRecosStale(db)) {
    // stale-while-revalidate：秒回旧批次，后台重生成（成功会 setStandingBatchId + 清 stale），
    // 前端见 stale=true 自行轮询换新，不再让用户对着加载动画等 LLM。
    startStandingRegeneration(db, deps, 'stale');
    return currentStandingPayload(db, { stale: true });
  }
  return currentStandingPayload(db, { stale: false, error: regenLastError });
}
