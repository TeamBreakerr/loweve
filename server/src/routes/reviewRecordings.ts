// 一起看过 · 点评室：讨论录音上传 / 列表 / 回放 / 重试 / 换说话人重新生成，以及两人点评一次保存。
// 挂在 /api 下（路径自带 sessions/ 或 recordings/ 前缀），与 sessionsRoutes 共用 /api/sessions 前缀互不冲突。
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { paths } from '../config.js';
import { ensureExperiencePair, getMovieSession } from '../experiences/service.js';
import { markRecosStale } from '../recos/state.js';
import {
  ACTIVE_STATUSES, getRecording, insertRecording, listRecordings, publicRecording,
  resumeStatusAfterError, updateRecording, type SpeakerMap,
} from '../reviewRecordings/service.js';

export const MAX_RECORDING_BYTES = 500 * 1024 * 1024;

// MediaRecorder 常见产物：Chrome/Firefox → webm/ogg(opus)，Safari/iOS → mp4(aac)
const AUDIO_EXT: Record<string, string> = {
  'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
};

function baseMime(contentType: any) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

function validRating(r: any) { return r == null || (Number.isInteger(r) && r >= 1 && r <= 10); }

function cleanText(v: any) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function downloadName(db: any, row: any) {
  const work = db.prepare('SELECT title FROM works WHERE id = ?').get(row.work_id);
  const d = new Date(row.created_at);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const title = String(work?.title || '作品').replace(/[\\/:*?"<>|]+/g, ' ').trim();
  return `${title}-讨论录音-${date}${path.extname(row.file_name)}`;
}

export function reviewRecordingsRoutes() {
  const router = Router();
  const dirOf = (req: any) => req.app.locals.recordingDir || paths.recordingDir;

  router.get('/sessions/:id/recordings', (req, res) => {
    const db = req.app.locals.db;
    const session = getMovieSession(db, parseInt(req.params.id, 10));
    if (!session) return res.status(404).json({ error: 'not_found' });
    res.json({ recordings: listRecordings(db, 'movie', session.work_id).map(publicRecording) });
  });

  // 原始音频流式落盘（不经 express.json，也不整段读进内存），先写 .part 成功后再改名
  router.post('/sessions/:id/recordings', async (req: any, res) => {
    if (!req.viewing_user_id) return res.status(401).json({ error: 'not_authenticated' });
    const db = req.app.locals.db;
    const session = getMovieSession(db, parseInt(req.params.id, 10));
    if (!session) return res.status(404).json({ error: 'not_found' });
    const mime = baseMime(req.headers['content-type']);
    const ext = AUDIO_EXT[mime];
    if (!ext) return res.status(415).json({ error: 'unsupported_audio_type' });
    if (Number(req.headers['content-length']) > MAX_RECORDING_BYTES) return res.status(413).json({ error: 'recording_too_large' });

    const dir = dirOf(req);
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `movie-${session.work_id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
    const finalPath = path.join(dir, fileName);
    const partPath = finalPath + '.part';
    let size = 0;
    try {
      await pipeline(req, new Transform({
        transform(chunk, _enc, cb) {
          size += chunk.length;
          if (size > MAX_RECORDING_BYTES) cb(Object.assign(new Error('too_large'), { code: 'recording_too_large' }));
          else cb(null, chunk);
        },
      }), fs.createWriteStream(partPath));
    } catch (e) {
      fs.rmSync(partPath, { force: true });
      if (e.code === 'recording_too_large') return res.status(413).json({ error: 'recording_too_large' });
      return res.status(400).json({ error: 'upload_interrupted' });
    }
    if (!size) {
      fs.rmSync(partPath, { force: true });
      return res.status(400).json({ error: 'empty_recording' });
    }
    fs.renameSync(partPath, finalPath);

    const duration = parseInt(String(req.headers['x-duration-ms'] || ''), 10);
    const row = insertRecording(db, {
      kind: 'movie', work_id: session.work_id, file_name: fileName,
      mime: String(req.headers['content-type']).trim(), size_bytes: size,
      duration_ms: Number.isFinite(duration) && duration > 0 ? duration : null,
      recorded_by: req.viewing_user_id,
    });
    req.app.locals.recordings?.run(row.id);
    res.json(publicRecording(row));
  });

  router.get('/recordings/:rid', (req, res) => {
    const row = getRecording(req.app.locals.db, parseInt(req.params.rid, 10));
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(publicRecording(row));
  });

  // 回放 / 下载；sendFile 自带 Range，进度条能拖
  router.get('/recordings/:rid/audio', (req, res) => {
    const db = req.app.locals.db;
    const row = getRecording(db, parseInt(req.params.rid, 10));
    if (!row) return res.status(404).json({ error: 'not_found' });
    const file = path.resolve(dirOf(req), row.file_name);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'audio_missing' });
    if (req.query.download) res.attachment(downloadName(db, row));
    res.type(baseMime(row.mime));   // attachment() 会按扩展名猜类型（.webm → video），这里改回录音本来的类型
    res.sendFile(file);
  });

  router.post('/recordings/:rid/retry', (req: any, res) => {
    if (!req.viewing_user_id) return res.status(401).json({ error: 'not_authenticated' });
    const db = req.app.locals.db;
    const row = getRecording(db, parseInt(req.params.rid, 10));
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (row.status !== 'error') return res.status(409).json({ error: 'recording_not_failed' });
    updateRecording(db, row.id, { status: resumeStatusAfterError(row), stage_message: '重新处理中…', error: null });
    req.app.locals.recordings?.run(row.id);
    res.json(publicRecording(getRecording(db, row.id)));
  });

  // 指定「说话人 → 谁」后只重跑总结（不重新转写）；speaker_map 传 null 表示交回模型判断
  router.post('/recordings/:rid/regenerate', (req: any, res) => {
    if (!req.viewing_user_id) return res.status(401).json({ error: 'not_authenticated' });
    const db = req.app.locals.db;
    const row = getRecording(db, parseInt(req.params.rid, 10));
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (ACTIVE_STATUSES.includes(row.status)) return res.status(409).json({ error: 'recording_busy' });
    const transcript = row.transcript_json ? JSON.parse(row.transcript_json) : [];
    if (!transcript.length) return res.status(409).json({ error: 'recording_without_transcript' });

    let speakerMap: SpeakerMap | null = null;
    const given = req.body?.speaker_map;
    if (given != null) {
      if (typeof given !== 'object' || Array.isArray(given)) return res.status(400).json({ error: 'invalid_speaker_map' });
      const speakers = new Set(transcript.map((t: any) => t.speaker));
      speakerMap = {};
      for (const s of speakers) {
        const v = given[s as string];
        if (v != null && v !== 1 && v !== 2) return res.status(400).json({ error: 'invalid_speaker_map' });
        speakerMap[s as string] = v ?? null;
      }
      if (!Object.values(speakerMap).some(v => v != null)) return res.status(400).json({ error: 'invalid_speaker_map' });
    }
    updateRecording(db, row.id, {
      status: 'summarizing', stage_message: '重新生成点评中…', error: null, applied_at: null,   // 新草稿还没人确认
      speaker_map_json: speakerMap ? JSON.stringify(speakerMap) : null,
    });
    req.app.locals.recordings?.run(row.id);
    res.json(publicRecording(getRecording(db, row.id)));
  });

  // 两人点评 + 讨论纪要一次保存。个人体验记录平时只允许本人改（见 marks 路由）；
  // 这里是两人当面一起确认的「共同写入」入口，所以一并写两边。
  router.put('/sessions/:id/joint-review', (req: any, res) => {
    if (!req.viewing_user_id) return res.status(401).json({ error: 'not_authenticated' });
    const db = req.app.locals.db;
    const id = parseInt(req.params.id, 10);
    const session = getMovieSession(db, id);
    if (!session) return res.status(404).json({ error: 'not_found' });

    const body = req.body || {};
    const sides = ([[1, body.a], [2, body.b]] as const).filter(([, v]) => v != null);
    for (const [, v] of sides) {
      if (typeof v !== 'object' || !validRating(v.rating ?? null)) return res.status(400).json({ error: 'invalid_rating' });
    }
    const recordingId = body.recording_id == null ? null : Number(body.recording_id);
    if (recordingId != null) {
      const rec = getRecording(db, recordingId);
      if (!rec || rec.kind !== 'movie' || rec.work_id !== session.work_id) return res.status(400).json({ error: 'invalid_recording' });
    }

    const now = Date.now();
    db.transaction(() => {
      ensureExperiencePair(db, 'movie', session.work_id, now);
      const update = db.prepare('UPDATE user_marks SET rating = ?, comment = ? WHERE user_id = ? AND work_id = ?');
      for (const [userId, v] of sides) update.run(v.rating ?? null, cleanText(v.comment), userId, session.work_id);
      if (Object.hasOwn(body, 'joint_note')) {
        db.prepare('UPDATE couple_sessions SET joint_note = ? WHERE id = ?').run(cleanText(body.joint_note), id);
      }
      if (recordingId != null) updateRecording(db, recordingId, { applied_at: now });
    })();
    markRecosStale(db);
    res.json(getMovieSession(db, id));
  });

  return router;
}
