import { parseJsonArray } from '../llm/client.js';
import { nextBatchId } from '../recos/state.js';
import { buildGameMessages, customAllowsDlc, customAllowsSolo, customAllowsUnreleased, customPriceCeiling } from './prompt.js';
import {
  confidenceNote, gameIdentity, isDefaultRecommendationEligible, resolveCatalogGame,
  refreshGameWorkIfStale, upsertResolvedGame, withGameLinks,
} from './service.js';
import {
  areGameRecosStale, clearGameRecosStale, getGameStandingBatchId,
  markGameRecosStale, setGameStandingBatchId,
} from './state.js';

const ASK = 15;
const SHOW = 9;
const LLM_BUDGET_MS = 150_000;

const READ_SQL = `
  SELECT r.id, r.reason, r.confidence_note, r.work_id,
         w.igdb_id, w.steam_appid, w.catalog_source, w.title, w.original_title, w.release_date, w.release_year,
         w.content_type, w.parent_igdb_id, w.parent_steam_appid, w.parent_title,
         w.release_state, w.cover_url AS poster_url, w.header_url,
         w.review_score, w.review_desc, w.review_total, w.review_percent,
         w.recent_review_desc, w.recent_review_total, w.recent_review_percent,
         w.price_currency, w.initial_price, w.current_price, w.discount_percent,
         w.price_formatted, w.discount_end_date, w.supports_together, w.play_modes, w.is_free,
         w.platforms, w.genres, w.steam_raw, w.fetched_at,
         w.catalog_rating, w.catalog_rating_count, w.critic_rating, w.critic_rating_count,
         w.igdb_url, w.external_links
  FROM game_recommendations r JOIN game_works w ON w.id = r.work_id
  WHERE r.batch_id = @batch AND r.validated = 1 AND r.feedback IS NULL
  ORDER BY r.id ASC LIMIT ${SHOW}`;

const INSERT_SQL = `INSERT INTO game_recommendations
  (batch_id, rec_type, user_prompt, work_id, raw_title, raw_original_title, raw_year,
   raw_steam_appid, reason, confidence_note, validated, created_at)
  VALUES (@batch_id, @rec_type, @user_prompt, @work_id, @raw_title, @raw_original_title,
   @raw_year, @raw_steam_appid, @reason, @confidence_note, @validated, @created_at)`;

function tier(value: any, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(5, Math.round(n))) : fallback;
}

/** Steam / IGDB 百分制评分按 200 条、75% 的先验收缩，避免小样本虚高。 */
export function gameReviewQualityTier(game: any) {
  const usingSteam = game?.review_percent != null;
  const percent = Number(usingSteam ? game?.review_percent : game?.catalog_rating);
  if (!Number.isFinite(percent)) return 2;
  const total = Math.max(0, Number(usingSteam ? game?.review_total : game?.catalog_rating_count) || 0);
  const adjusted = (percent * total + 75 * 200) / (total + 200);
  if (adjusted >= 90) return 5;
  if (adjusted >= 82) return 4;
  if (adjusted >= 75) return 3;
  if (adjusted >= 65) return 2;
  return 1;
}

/**
 * 核心适配 = 口味 40% + 双人适配 40% + 评价质量 20%。
 * 价格不进分；仅核心分完全相同时，免费或正在打折的候选提前。
 */
export function rankGameCandidates(entries: any[]) {
  return entries.map((entry, index) => {
    const sourceIndex = Number.isInteger(entry.sourceIndex) ? entry.sourceIndex : index;
    // 兼容偶发漏字段的旧模型：每三名降一档，保留模型原始推荐顺序的含义。
    const fallback = Math.max(1, 5 - Math.floor(sourceIndex / 3));
    const tasteTier = tier(entry.item?.taste_tier, fallback);
    const togetherTier = tier(entry.item?.together_tier, fallback);
    const reviewTier = gameReviewQualityTier(entry.game);
    const coreScore = tasteTier * 2 + togetherTier * 2 + reviewTier;
    const promoted = entry.game?.is_free || Number(entry.game?.discount_percent) > 0 ? 1 : 0;
    return { entry, sourceIndex, coreScore, promoted };
  }).sort((a, b) =>
    b.coreScore - a.coreScore
    || b.promoted - a.promoted
    || a.sourceIndex - b.sourceIndex,
  ).map(row => row.entry);
}

export function readGameBatch(db: any, batchId: any) {
  if (!batchId) return [];
  return db.prepare(READ_SQL).all({ batch: batchId }).map((row: any) => withGameLinks(row));
}

/** 迁移前生成的推荐批次在首次读取时补抓一次折扣截止日，之后复用已检查标记。 */
export async function hydrateGameRecoOffers(db: any, deps: any, payload: any) {
  const items = payload?.items || [];
  if (!items.length) return payload;
  await Promise.all(items.map((item: any) => refreshGameWorkIfStale(db, deps, item)));
  return { ...payload, items: readGameBatch(db, payload.batch_id) };
}

export function gatherGameContext(db: any) {
  const users = db.prepare('SELECT id, display_name FROM users ORDER BY id').all();
  const userA = users.find((u: any) => u.id === 1)?.display_name || 'A';
  const userB = users.find((u: any) => u.id === 2)?.display_name || 'B';
  const marks = (uid: number) => db.prepare(`
    SELECT w.id, w.igdb_id, w.steam_appid, w.title, w.original_title, w.release_year, w.genres,
           m.status, m.rating, m.comment
    FROM game_marks m JOIN game_works w ON w.id = m.work_id
    WHERE m.user_id = ? ORDER BY m.marked_at DESC`).all(uid);
  const marksA = marks(1);
  const marksB = marks(2);
  const sessions = db.prepare(`
    SELECT w.id, w.igdb_id, w.steam_appid, w.title, w.release_year, w.genres,
           s.rating_a, s.rating_b, s.review_a, s.review_b, s.joint_note
    FROM game_sessions s JOIN game_works w ON w.id = s.work_id
    ORDER BY s.played_at DESC, s.id DESC`).all();
  const plan = db.prepare(`
    SELECT w.id, w.igdb_id, w.steam_appid, w.title, w.release_year, p.status
    FROM game_plan_items p JOIN game_works w ON w.id = p.work_id
    ORDER BY p.created_at DESC`).all();
  const avoidTitles = db.prepare(`SELECT DISTINCT raw_title FROM game_recommendations
    WHERE feedback IN ('not_interested', 'already_seen')`).all().map((r: any) => r.raw_title);
  const knownIdentities = new Set([...marksA, ...marksB, ...sessions, ...plan].map((work: any) => gameIdentity(work)));
  const avoided = db.prepare(`SELECT DISTINCT w.id, w.igdb_id, w.steam_appid FROM game_recommendations r
    JOIN game_works w ON w.id = r.work_id
    WHERE r.feedback IN ('not_interested', 'already_seen')`).all();
  for (const work of avoided) knownIdentities.add(gameIdentity(work));
  return { userA, userB, marksA, marksB, sessions, plan, avoidTitles, knownIdentities };
}

export function isGameRecommendationEligible(game: any, userPrompt: any) {
  if (game.review_score != null && game.review_score <= 4) return false;
  if (game.content_type === 'dlc' && !customAllowsDlc(userPrompt)) return false;
  if (!customAllowsUnreleased(userPrompt) && game.release_state !== 'released') return false;
  if (!customAllowsSolo(userPrompt) && !game.supports_together) return false;
  const priceCeiling = customPriceCeiling(userPrompt);
  if (priceCeiling != null && !game.is_free && (game.current_price == null || game.current_price > priceCeiling)) return false;
  return true;
}

function fillGameBatch(db: any, { batchId, previousBatchId, ctx, seen, shown, now }: any) {
  const insert = db.prepare(INSERT_SQL);
  const history = db.prepare(`
    SELECT r.work_id, r.raw_title, r.raw_original_title, r.raw_year, r.raw_steam_appid,
           r.reason, r.confidence_note, w.id, w.igdb_id, w.steam_appid, w.release_state, w.supports_together,
           w.content_type, w.review_score, w.is_free, w.current_price, w.catalog_rating, w.catalog_rating_count
    FROM game_recommendations r JOIN game_works w ON w.id = r.work_id
    WHERE r.batch_id <> @batch AND r.validated = 1 AND r.feedback IS NULL
    ORDER BY CASE WHEN r.batch_id = @previous THEN 1 ELSE 0 END, r.created_at DESC, r.id DESC
    LIMIT 500`).all({ batch: batchId, previous: previousBatchId });
  for (const row of history) {
    if (shown >= SHOW) break;
    const identity = gameIdentity(row);
    if (ctx.knownIdentities.has(identity) || seen.has(identity) || !isDefaultRecommendationEligible(row)) continue;
    seen.add(identity);
    insert.run({
      batch_id: batchId, rec_type: 'standing', user_prompt: null, work_id: row.work_id,
      raw_title: row.raw_title, raw_original_title: row.raw_original_title,
      raw_year: row.raw_year, raw_steam_appid: row.raw_steam_appid,
      reason: row.reason || '适合你们一起尝试', confidence_note: row.confidence_note,
      validated: 1, created_at: now,
    });
    shown++;
  }
  if (shown < SHOW) {
    const catalog = db.prepare(`SELECT * FROM game_works
      WHERE content_type = 'game' AND release_state = 'released' AND supports_together = 1
        AND (review_score IS NULL OR review_score > 4)
      ORDER BY CASE WHEN COALESCE(review_percent, catalog_rating) IS NULL THEN 1 ELSE 0 END,
               COALESCE(review_percent, catalog_rating) DESC,
               COALESCE(review_total, catalog_rating_count) DESC,
               CASE WHEN is_free = 1 OR discount_percent > 0 THEN 0 ELSE 1 END,
               updated_at DESC LIMIT 500`).all();
    for (const row of catalog) {
      if (shown >= SHOW) break;
      const identity = gameIdentity(row);
      if (ctx.knownIdentities.has(identity) || seen.has(identity)) continue;
      seen.add(identity);
      insert.run({
        batch_id: batchId, rec_type: 'standing', user_prompt: null, work_id: row.id,
        raw_title: row.title, raw_original_title: row.original_title,
        raw_year: row.release_year, raw_steam_appid: row.steam_appid,
        reason: '游戏库中的高口碑双人作品，适合你们一起尝试',
        confidence_note: confidenceNote(row), validated: 1, created_at: now,
      });
      shown++;
    }
  }
  return shown;
}

export async function generateGameStanding(db: any, deps: any, { userPrompt = null }: any = {}) {
  const ctx = gatherGameContext(db);
  const batch_id = nextBatchId();
  const rec_type = userPrompt ? 'custom' : 'standing';
  const previousBatchId = rec_type === 'standing' ? getGameStandingBatchId(db) : null;
  const now = Date.now();
  const insert = db.prepare(INSERT_SQL);
  const seen = new Set<string>();
  const extraAvoid: string[] = [];
  let shown = 0;

  for (let round = 0; round < 2 && shown < SHOW; round++) {
    const messages = buildGameMessages({ ...ctx, avoidTitles: [...ctx.avoidTitles, ...extraAvoid], userPrompt });
    let items: any[];
    try { items = parseJsonArray(await deps.llm.chat(messages, { timeoutMs: LLM_BUDGET_MS })).slice(0, ASK); }
    catch (e) { if (round === 0) throw e; break; }

    const resolved = await Promise.all(items.map(async (item: any, sourceIndex: number) => {
      const title = String(item.title || '').trim();
      if (!title) return null;
      const game = await resolveCatalogGame({ igdb: deps.igdb, steam: deps.steam }, {
        title, year: Number.isInteger(item.year) ? item.year : null,
        igdb_id: Number.isInteger(item.igdb_id) ? item.igdb_id : null,
        steam_appid: Number.isInteger(item.steam_appid) ? item.steam_appid : null,
      });
      return { item, title, game, sourceIndex };
    }));

    for (const entry of resolved) if (entry) extraAvoid.push(entry.title);
    const candidates = rankGameCandidates(resolved.filter((entry: any) => {
      const game = entry?.game;
      const identity = gameIdentity(game);
      return game && isGameRecommendationEligible(game, userPrompt)
        && !ctx.knownIdentities.has(identity) && !seen.has(identity);
    }));

    for (const entry of candidates) {
      const game = entry.game;
      // 同一轮可能由不同标题解析到同一个 IGDB/Steam 作品；排序后只取适配更高的那条。
      const identity = gameIdentity(game);
      if (seen.has(identity)) continue;
      seen.add(identity);
      let work: any = null;
      try { work = await upsertResolvedGame(db, { igdb: deps.igdb, steam: deps.steam }, game); }
      catch { /* 未验证行不展示 */ }
      insert.run({
        batch_id, rec_type, user_prompt: userPrompt, work_id: work?.id ?? null,
        raw_title: entry.title, raw_original_title: entry.item.original_title || null,
        raw_year: Number.isInteger(entry.item.year) ? entry.item.year : null,
        raw_steam_appid: game.steam_appid, reason: String(entry.item.reason || '').trim() || '适合你们一起尝试',
        confidence_note: confidenceNote(game), validated: work ? 1 : 0, created_at: now,
      });
      if (work) shown++;
      if (shown >= SHOW) break;
    }
  }

  if (rec_type === 'standing' && shown < SHOW) {
    shown = fillGameBatch(db, { batchId: batch_id, previousBatchId, ctx, seen, shown, now });
  }
  if (rec_type === 'standing') {
    if (shown < SHOW) {
      db.prepare('DELETE FROM game_recommendations WHERE batch_id = ?').run(batch_id);
      throw new Error('game_recos_insufficient');
    }
    setGameStandingBatchId(db, batch_id);
    clearGameRecosStale(db);
  }
  return { items: readGameBatch(db, batch_id), batch_id, rec_type };
}

let regenInflight: Promise<void> | null = null;
let regenError: string | null = null;

function currentPayload(db: any, stale: boolean) {
  const batchId = getGameStandingBatchId(db);
  return {
    items: readGameBatch(db, batchId), batch_id: batchId, rec_type: 'standing',
    stale, generating: Boolean(regenInflight), error: regenError,
  };
}

function startRegeneration(db: any, deps: any) {
  if (regenInflight) return false;
  regenError = null;
  regenInflight = generateGameStanding(db, deps)
    .then(() => undefined)
    .catch((e: any) => {
      regenError = 'llm_unavailable';
      clearGameRecosStale(db);
      console.error('[game-recos] 后台生成失败', e?.message || e);
    })
    .finally(() => { regenInflight = null; });
  return true;
}

export function requestGameStandingRefresh(db: any, deps: any) {
  if (!deps.llm?.isConfigured?.()) return { ...currentPayload(db, false), error: 'llm_unconfigured' };
  markGameRecosStale(db);
  startRegeneration(db, deps);
  return currentPayload(db, true);
}

export async function getCurrentGameRecos(db: any, deps: any) {
  const batchId = getGameStandingBatchId(db);
  if (!deps.llm?.isConfigured?.()) {
    return { ...currentPayload(db, false), error: batchId ? null : 'llm_unconfigured' };
  }
  if (regenInflight) return currentPayload(db, true);
  if (!batchId) {
    try { return { ...(await generateGameStanding(db, deps)), stale: false, generating: false, error: null }; }
    catch { return { items: [], batch_id: null, rec_type: 'standing', stale: false, generating: false, error: 'llm_unavailable' }; }
  }
  // 推荐位从 6 扩到 9 后，旧批次首次读取即后台补齐，不要求用户手动换一批。
  if (readGameBatch(db, batchId).length < SHOW && !regenError) {
    markGameRecosStale(db);
    startRegeneration(db, deps);
    return currentPayload(db, true);
  }
  if (areGameRecosStale(db)) {
    startRegeneration(db, deps);
    return currentPayload(db, true);
  }
  return currentPayload(db, false);
}
