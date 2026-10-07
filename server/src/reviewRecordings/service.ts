// 一起看过 · 录音点评：讨论录音 → asr-app 转写（带说话人分离）→ LLM 生成两人各自的点评草稿 + 讨论纪要。
// 原始录音永久保留；草稿只是「建议」，要两人在点评室确认保存后才写进各自的个人体验记录。
// 处理是后台任务：状态逐步落库（uploaded → transcribing → summarizing → ready / error），
// 服务重启后 resumeAll() 接着跑，部署不丢任务。
import path from 'node:path';
import { AsrError, type AsrClient, type TranscriptTurn } from '../asr/client.js';
import { LlmError, parseJsonObject } from '../llm/client.js';

export type RecordingKind = 'movie' | 'game';
export type RecordingStatus = 'uploaded' | 'transcribing' | 'summarizing' | 'ready' | 'error';
export type UserSide = 1 | 2;
export type SpeakerMap = Record<string, UserSide | null>;
export type SideDraft = { review: string; rating: number | null };
export type ReviewDraft = { speaker_map: SpeakerMap; a: SideDraft; b: SideDraft; joint_note: string; generated_at: number };

// 采用草稿前的样子：{a:{rating,comment}, b:{rating,comment}, joint_note}
export type ReplacedReviews = {
  a: { rating: number | null; comment: string | null };
  b: { rating: number | null; comment: string | null };
  joint_note: string | null;
};

export const ACTIVE_STATUSES: RecordingStatus[] = ['uploaded', 'transcribing', 'summarizing'];

const COLS = `id, kind, work_id, file_name, mime, size_bytes, duration_ms, recorded_by, status, stage_message,
  asr_job_id, transcript_json, speaker_map_json, draft_json, replaced_json, applied_at, error, created_at, updated_at`;

export function getRecording(db: any, id: number) {
  return db.prepare(`SELECT ${COLS} FROM review_recordings WHERE id = ?`).get(id);
}

export function listRecordings(db: any, kind: RecordingKind, workId: number) {
  return db.prepare(`SELECT ${COLS} FROM review_recordings WHERE kind = ? AND work_id = ? ORDER BY created_at DESC, id DESC`)
    .all(kind, workId);
}

export function insertRecording(db: any, row: {
  kind: RecordingKind; work_id: number; file_name: string; mime: string; size_bytes: number;
  duration_ms: number | null; recorded_by: number | null;
}) {
  const now = Date.now();
  const info = db.prepare(`INSERT INTO review_recordings
    (kind, work_id, file_name, mime, size_bytes, duration_ms, recorded_by, status, stage_message, created_at, updated_at)
    VALUES (@kind, @work_id, @file_name, @mime, @size_bytes, @duration_ms, @recorded_by, 'uploaded', '排队转写…', @now, @now)`)
    .run({ ...row, now });
  return getRecording(db, Number(info.lastInsertRowid));
}

const UPDATABLE = new Set(['status', 'stage_message', 'asr_job_id', 'transcript_json', 'speaker_map_json', 'draft_json', 'replaced_json', 'applied_at', 'error']);
export function updateRecording(db: any, id: number, fields: Record<string, any>) {
  const keys = Object.keys(fields).filter(k => UPDATABLE.has(k));
  if (!keys.length) return;
  db.prepare(`UPDATE review_recordings SET ${keys.map(k => `${k} = @${k}`).join(', ')}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...Object.fromEntries(keys.map(k => [k, fields[k] ?? null])), updated_at: Date.now(), id });
}

function parseJson(text: string | null) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// 给前端的形状：JSON 列解析好，带回放地址；不暴露服务器文件名
export function publicRecording(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    work_id: row.work_id,
    mime: row.mime,
    size_bytes: row.size_bytes,
    duration_ms: row.duration_ms,
    recorded_by: row.recorded_by,
    status: row.status as RecordingStatus,
    stage_message: row.stage_message,
    error: row.error,
    transcript: parseJson(row.transcript_json) as TranscriptTurn[] | null,
    speaker_map: parseJson(row.speaker_map_json) as SpeakerMap | null,
    draft: parseJson(row.draft_json) as ReviewDraft | null,
    replaced: parseJson(row.replaced_json) as ReplacedReviews | null,
    applied_at: row.applied_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    audio_url: `/api/recordings/${row.id}/audio`,
  };
}

// 失败后从哪一步接着做：有转写就只重跑总结；有 asr 任务号就接着轮询；否则重新提交
export function resumeStatusAfterError(row: any): RecordingStatus {
  if (row.transcript_json && parseJson(row.transcript_json)?.length) return 'summarizing';
  if (row.asr_job_id) return 'transcribing';
  return 'uploaded';
}

// ============================================================ 点评草稿：提示词与归一

const MAX_TRANSCRIPT_CHARS = 80_000;

function fmtTs(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function formatTranscript(turns: TranscriptTurn[]) {
  const text = turns.map(t => `[${fmtTs(t.start)}] 说话人${t.speaker}：${t.text}`).join('\n');
  return text.length > MAX_TRANSCRIPT_CHARS ? text.slice(0, MAX_TRANSCRIPT_CHARS) + '\n…（转写过长，后面已截断）' : text;
}

export function buildReviewMessages({ title, year, nameA, nameB, turns, speakerMap }: {
  title: string; year?: number | null; nameA: string; nameB: string; turns: TranscriptTurn[]; speakerMap?: SpeakerMap | null;
}) {
  const speakers = [...new Set(turns.map(t => t.speaker))];
  const fixed = speakerMap
    ? '说话人和人的对应已经由他们确认，请严格按此对应，不要改：' + speakers.map(s => {
      const who = speakerMap[s];
      return `说话人${s} = ${who === 1 ? `${nameA}（A）` : who === 2 ? `${nameB}（B）` : '忽略（不是他们俩）'}`;
    }).join('；') + '。speaker_map 原样照抄这个对应。'
    : '先判断转写里哪个说话人是谁：看互相的称呼、自我介绍、谈到自己的经历和口头禅；实在判断不了，就按发言多少把最主要的两位分给 A、B。'
      + '和讨论无关的声音（电影原声、旁人、电视）标 null。机器分离可能把同一个人拆成两个标签，这时两个标签都指向同一个人。';

  const system = '你在帮一对一起看电影的人，把他们看完后的讨论录音整理成各自的点评。'
    + '你只能使用转写里真实说过的内容，绝不编造观点、情节或评分。只输出一个 JSON 对象，不要任何其他文字。';
  const user = [
    `作品：《${title}》${year ? `（${year}）` : ''}`,
    `两个人：A = ${nameA}，B = ${nameB}`,
    '',
    '讨论转写（机器自动区分说话人，标签可能有误，可能混入电影原声或别的声音；同音字可能识别错）：',
    formatTranscript(turns),
    '',
    fixed,
    '',
    '输出格式：',
    '{"speaker_map": {"<说话人标签>": "A" | "B" | null}, "A": {"review": "…", "rating": 整数或null}, "B": {"review": "…", "rating": 整数或null}, "joint_note": "…"}',
    '',
    '要求：',
    `- review：分别以 ${nameA}、${nameB} 自己的第一人称写，一段 3–6 句的总结式点评。保留他自己的观点、喜欢和不喜欢的地方、举的具体例子和说话的味道；不要把对方的观点算到他头上。他几乎没表态时就写短一点，如实反映。`,
    `- 转写里的人名、片名、角色名可能被识别成同音字（比如把「${nameA}」「${nameB}」听成别的字），写点评和纪要时改回正确写法，不要照抄错字。`,
    '- rating：只有他在讨论里明确说出给几分时才填，换算成 1–10 的整数（十分制直接用，五星制 ×2，百分制 ÷10，四舍五入）；没明确说就填 null，不要根据语气猜。',
    `- joint_note：两人讨论的纪要，第三人称，用「${nameA}」「${nameB}」称呼，3–8 句，写聊了哪些点、分歧在哪、有什么共识。`,
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function normRating(v: any): number | null {
  if (v == null || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
}

function side(v: any): SideDraft {
  return { review: typeof v?.review === 'string' ? v.review.trim() : '', rating: normRating(v?.rating) };
}

// 模型没给出可用对应时的兜底：按发言量取前两位
function fallbackSpeakerMap(turns: TranscriptTurn[]): SpeakerMap {
  const volume = new Map<string, number>();
  for (const t of turns) volume.set(t.speaker, (volume.get(t.speaker) || 0) + t.text.length);
  const ranked = [...volume.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  return Object.fromEntries(ranked.map((s, i) => [s, i === 0 ? 1 : i === 1 ? 2 : null])) as SpeakerMap;
}

export function normalizeDraft(raw: any, turns: TranscriptTurn[], fixedMap?: SpeakerMap | null, now = Date.now()): ReviewDraft {
  const speakers = [...new Set(turns.map(t => t.speaker))];
  let speakerMap: SpeakerMap;
  if (fixedMap) {
    speakerMap = Object.fromEntries(speakers.map(s => [s, fixedMap[s] ?? null])) as SpeakerMap;
  } else {
    const given = raw?.speaker_map && typeof raw.speaker_map === 'object' ? raw.speaker_map : {};
    const toSide = (v: any): UserSide | null => (v === 'A' || v === 'a' || v === 1) ? 1 : (v === 'B' || v === 'b' || v === 2) ? 2 : null;
    speakerMap = Object.fromEntries(speakers.map(s => [s, toSide(given[s] ?? given[`说话人${s}`])])) as SpeakerMap;
    if (!Object.values(speakerMap).some(v => v != null)) speakerMap = fallbackSpeakerMap(turns);
  }
  return {
    speaker_map: speakerMap,
    a: side(raw?.A ?? raw?.a),
    b: side(raw?.B ?? raw?.b),
    joint_note: typeof raw?.joint_note === 'string' ? raw.joint_note.trim() : '',
    generated_at: now,
  };
}

// ============================================================ 后台处理器

const ERROR_MESSAGES: Record<string, string> = {
  asr_unconfigured: '还没配置语音转写服务（设置页「语音转写服务地址」）',
  asr_network: '连不上语音转写服务',
  asr_timeout: '语音转写服务响应超时',
  asr_http: '语音转写服务返回错误',
  asr_bad_response: '语音转写服务返回了看不懂的结果',
  asr_result_unparseable: '读不出转写结果',
  asr_failed: '转写失败',
  asr_wait_timeout: '转写等太久还没完成，可以稍后重试',
  asr_empty: '录音里没识别到说话内容',
  audio_missing: '录音文件不见了',
  llm_unconfigured: '还没配置 LLM（设置页「AI 推荐」）',
  llm_parse: '生成的点评格式不对，可以重试',
  llm_timeout: '生成点评超时，可以重试',
};

function describeError(e: any) {
  const code = e instanceof AsrError || e instanceof LlmError ? e.code : 'internal';
  const base = ERROR_MESSAGES[code] || (code.startsWith('llm_') ? '生成点评失败' : '处理失败');
  // 把服务自己的报错带上（如「模型不存在」），不然页面上只有一句笼统的失败，没法自己排查
  const raw = e instanceof AsrError ? e.detail
    : e instanceof LlmError ? (e.body?.error?.message || e.body?.message || (e.status ? `HTTP ${e.status}` : '')) : '';
  const detail = raw ? `：${String(raw).slice(0, 160)}` : '';
  return { code, message: base + detail };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function createReviewRecordingProcessor({ db, asr, llm, recordingDir, pollMs = 5000, maxWaitMs = 90 * 60_000, log = console }: {
  db: any; asr: AsrClient | any; llm: any; recordingDir: string; pollMs?: number; maxWaitMs?: number; log?: Pick<Console, 'error'>;
}) {
  const running = new Map<number, Promise<void>>();

  function names() {
    const rows = db.prepare('SELECT id, display_name FROM users WHERE id IN (1, 2)').all();
    const by = new Map(rows.map((r: any) => [r.id, r.display_name]));
    return { nameA: String(by.get(1) || 'A'), nameB: String(by.get(2) || 'B') };
  }

  function workLabel(row: any) {
    const w = row.kind === 'game'
      ? db.prepare('SELECT title, release_year AS year FROM game_works WHERE id = ?').get(row.work_id)
      : db.prepare('SELECT title, year FROM works WHERE id = ?').get(row.work_id);
    return { title: w?.title || '未知作品', year: w?.year ?? null };
  }

  async function transcribe(row: any): Promise<TranscriptTurn[]> {
    let jobId = row.asr_job_id;
    if (!jobId) {
      updateRecording(db, row.id, { status: 'transcribing', stage_message: '上传到转写服务…', error: null });
      const ext = path.extname(row.file_name) || '.webm';
      jobId = await asr.submit(path.join(recordingDir, row.file_name), `loweve-${row.kind}${row.work_id}-rec${row.id}${ext}`, row.mime);
      updateRecording(db, row.id, { asr_job_id: jobId, stage_message: '转写中…' });
    }
    const started = Date.now();
    let failures = 0;
    for (;;) {
      let job: any;
      try {
        job = await asr.status(jobId);
        failures = 0;
      } catch (e) {
        // 轮询途中偶发连不上（asr-app 重启等）先忍几次
        if (++failures >= 6) throw e;
      }
      if (job?.status === 'done') return asr.transcript(jobId);
      if (job?.status === 'error') {
        updateRecording(db, row.id, { asr_job_id: null });   // 重试时重新提交，而不是反复读这个失败的任务
        throw new AsrError('asr_failed', 0, job.message || '');
      }
      if (job?.message) updateRecording(db, row.id, { stage_message: `转写中：${job.message}` });
      if (Date.now() - started > maxWaitMs) throw new AsrError('asr_wait_timeout');
      await sleep(pollMs);
    }
  }

  async function summarize(row: any, turns: TranscriptTurn[]) {
    const fixedMap = parseJson(row.speaker_map_json) as SpeakerMap | null;
    const { title, year } = workLabel(row);
    const content = await llm.chat(buildReviewMessages({ title, year, ...names(), turns, speakerMap: fixedMap }));
    return normalizeDraft(parseJsonObject(content), turns, fixedMap);
  }

  async function process(id: number) {
    let row = getRecording(db, id);
    if (!row || !ACTIVE_STATUSES.includes(row.status)) return;
    try {
      let turns = parseJson(row.transcript_json) as TranscriptTurn[] | null;
      if (row.status !== 'summarizing' || !turns?.length) {
        turns = await transcribe(row);
        if (!turns.length) {
          updateRecording(db, id, { transcript_json: '[]' });
          throw new AsrError('asr_empty');
        }
        updateRecording(db, id, { status: 'summarizing', transcript_json: JSON.stringify(turns), stage_message: '生成点评中…' });
        row = getRecording(db, id);
      } else {
        updateRecording(db, id, { stage_message: '生成点评中…', error: null });
      }
      const draft = await summarize(row, turns);
      updateRecording(db, id, { status: 'ready', draft_json: JSON.stringify(draft), stage_message: null, error: null });
    } catch (e) {
      const { code, message } = describeError(e);
      if (code === 'internal') log.error('[review-recording]', id, e);
      updateRecording(db, id, { status: 'error', error: code, stage_message: message });
    }
  }

  // 同一条录音同一时刻只跑一个任务；返回的 Promise 只给测试等待用，路由里不 await
  function run(id: number) {
    const existing = running.get(id);
    if (existing) return existing;
    const p = process(id).finally(() => running.delete(id));
    running.set(id, p);
    return p;
  }

  function resumeAll() {
    const ids = db.prepare(`SELECT id FROM review_recordings WHERE status IN ('uploaded', 'transcribing', 'summarizing') ORDER BY id`)
      .all().map((r: any) => r.id as number);
    for (const id of ids) run(id);
    return ids;
  }

  return { run, resumeAll, isRunning: (id: number) => running.has(id) };
}

export type ReviewRecordingProcessor = ReturnType<typeof createReviewRecordingProcessor>;
