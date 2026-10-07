import request from 'supertest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { makeTestDb, makeFakeTmdb } from './helpers.js';
import { createAsrClient, extractTranscript, parseTranscriptMarkdown } from '../src/asr/client.js';
import {
  buildReviewMessages, createReviewRecordingProcessor, getRecording, normalizeDraft,
} from '../src/reviewRecordings/service.js';
import { parseJsonObject } from '../src/llm/client.js';

const TURNS = [
  { speaker: '1', start: 3, text: '我觉得结尾那段长镜头太好了，给八分。' },
  { speaker: '2', start: 9, text: '我反而觉得中段有点拖，不过配乐很棒。' },
];

function seedSession(db: any) {
  const now = Date.now();
  const workId = Number(db.prepare(`INSERT INTO works (tmdb_id, tmdb_type, title, year, rating_source, tmdb_raw, fetched_at, updated_at)
    VALUES (1, 'movie', '花样年华', 2000, 'tmdb', '{}', ?, ?)`).run(now, now).lastInsertRowid);
  const sessionId = Number(db.prepare('INSERT INTO couple_sessions (work_id, watched_at, created_at) VALUES (?, 20261001, ?)')
    .run(workId, now).lastInsertRowid);
  db.prepare(`INSERT INTO user_marks (user_id, work_id, status, rating, comment, marked_at) VALUES (1, ?, 'watched', 6, '旧点评A', ?), (2, ?, 'watched', NULL, NULL, ?)`)
    .run(workId, now, workId, now);
  return { workId, sessionId };
}

function fakeAsr({ statuses = ['running', 'done'], turns = TURNS, failSubmit = false }: any = {}) {
  const calls: any = { submit: [], status: 0, transcript: 0 };
  let i = 0;
  return {
    calls,
    isConfigured: () => true,
    async submit(filePath: string, filename: string, mime: string) {
      calls.submit.push({ filePath, filename, mime });
      if (failSubmit) throw Object.assign(new Error('x'), { code: 'asr_network' });
      return 'job1';
    },
    async status() {
      calls.status++;
      const s = statuses[Math.min(i++, statuses.length - 1)];
      return { status: s, message: s === 'error' ? 'Doubao 失败' : '转写中' };
    },
    async transcript() { calls.transcript++; return turns; },
  };
}

function fakeLlm(reply: any = {
  speaker_map: { 1: 'B', 2: 'A' },
  A: { review: '中段有点拖，配乐很棒。', rating: null },
  B: { review: '结尾长镜头太好了。', rating: 8 },
  joint_note: '两人聊了结尾和节奏。',
}) {
  const calls: any[] = [];
  return { calls, async chat(messages: any) { calls.push(messages); return typeof reply === 'string' ? reply : '```json\n' + JSON.stringify(reply) + '\n```'; } };
}

describe('asr 结果解析', () => {
  it('从结果页 textarea 取出并反转义 markdown，解析说话人/时间/文本', () => {
    const html = `<html><body><div>…</div><textarea id="md" style="position:absolute">`
      + `# loweve-movie1-rec1.webm\n\n[00:03] 说话人1：&lt;花样年华&gt; 真好 &amp; 美\n[125:07] 说话人?：她说：&quot;再见&quot;&#x27;\n[00:09] 说话人2：   \n`
      + `</textarea></body></html>`;
    assert.deepEqual(extractTranscript(html), [
      { speaker: '1', start: 3, text: '<花样年华> 真好 & 美' },
      { speaker: '?', start: 125 * 60 + 7, text: `她说："再见"'` },
    ]);
  });

  it('没有 textarea 时报 asr_result_unparseable', () => {
    assert.throws(() => extractTranscript('<html></html>'), (e: any) => e.code === 'asr_result_unparseable');
  });

  it('跳过标题与无关行', () => {
    assert.deepEqual(parseTranscriptMarkdown('# t\n\n随便\n[01:00] 说话人3：嗯'), [{ speaker: '3', start: 60, text: '嗯' }]);
  });

  it('client：multipart 提交、轮询、取结果都打到 asr-app 的接口', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asr-'));
    const file = path.join(dir, 'a.webm');
    fs.writeFileSync(file, Buffer.from('OggS-fake'));
    const seen: any[] = [];
    const fetch = async (url: string, init: any = {}) => {
      seen.push({ url, method: init.method || 'GET', body: init.body });
      if (url.endsWith('/api/jobs')) return new Response(JSON.stringify({ job_id: 'abc' }));
      if (url.endsWith('/api/jobs/abc')) return new Response(JSON.stringify({ status: 'done' }));
      return new Response('<textarea id="md">[00:01] 说话人1：你好</textarea>');
    };
    const asr = createAsrClient({ resolve: () => ({ baseUrl: 'http://asr-app:8000/' }), fetch });
    assert.equal(await asr.submit(file, 'loweve-movie1-rec1.webm', 'audio/webm'), 'abc');
    assert.equal((await asr.status('abc')).status, 'done');
    assert.deepEqual(await asr.transcript('abc'), [{ speaker: '1', start: 1, text: '你好' }]);
    assert.deepEqual(seen.map(s => `${s.method} ${s.url}`), [
      'POST http://asr-app:8000/api/jobs', 'GET http://asr-app:8000/api/jobs/abc', 'GET http://asr-app:8000/result/abc',
    ]);
    const sent = seen[0].body.get('file');
    assert.equal(sent.name, 'loweve-movie1-rec1.webm');
    assert.equal(await sent.text(), 'OggS-fake');
  });

  it('client：未配置地址时报 asr_unconfigured', async () => {
    const asr = createAsrClient({ resolve: () => ({ baseUrl: '' }) });
    assert.equal(asr.isConfigured(), false);
    await assert.rejects(asr.status('x'), (e: any) => e.code === 'asr_unconfigured');
  });
});

describe('点评草稿归一', () => {
  it('A/B 转成用户 1/2；评分取整、越界丢弃；去掉多余空白', () => {
    const d = normalizeDraft({
      speaker_map: { 1: 'A', 2: 'B', 3: null },
      A: { review: '  好看  ', rating: 7.6 }, B: { review: '一般', rating: 11 }, joint_note: ' 纪要 ',
    }, [...TURNS, { speaker: '3', start: 20, text: '（电影原声）' }], null, 1);
    assert.deepEqual(d, {
      speaker_map: { 1: 1, 2: 2, 3: null },
      a: { review: '好看', rating: 8 }, b: { review: '一般', rating: null }, joint_note: '纪要', generated_at: 1,
    });
  });

  it('模型没给对应时按发言量兜底；字符串评分也接受', () => {
    const d = normalizeDraft({ A: { review: 'x', rating: '9' } }, [
      { speaker: '1', start: 0, text: '短' }, { speaker: '2', start: 1, text: '这一位说得多得多得多' },
    ]);
    assert.deepEqual(d.speaker_map, { 1: 2, 2: 1 });
    assert.equal(d.a.rating, 9);
  });

  it('确认过的对应优先于模型输出', () => {
    const d = normalizeDraft({ speaker_map: { 1: 'A', 2: 'B' } }, TURNS, { 1: 2, 2: 1 });
    assert.deepEqual(d.speaker_map, { 1: 2, 2: 1 });
  });

  it('提示词带两人名字、作品与转写；确认过对应时写明', () => {
    const [, user] = buildReviewMessages({ title: '花样年华', year: 2000, nameA: 'ff', nameB: 'xsq', turns: TURNS, speakerMap: { 1: 2, 2: 1 } });
    assert.match(user.content, /《花样年华》（2000）/);
    assert.match(user.content, /A = ff，B = xsq/);
    assert.match(user.content, /\[00:03\] 说话人1：我觉得结尾/);
    assert.match(user.content, /说话人1 = xsq（B）；说话人2 = ff（A）/);
  });

  it('parseJsonObject 剥代码块、拒绝数组', () => {
    assert.deepEqual(parseJsonObject('好的：```json\n{"a":1}\n```'), { a: 1 });
    assert.throws(() => parseJsonObject('[1]'));
  });
});

describe('点评室路由与后台处理', () => {
  let db: any; let dir: string;
  beforeEach(() => { db = makeTestDb({ userA: 'ff', userB: 'xsq' }); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-')); });
  afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  function setup(opts: { asr?: any; llm?: any } = {}) {
    const asr = opts.asr ?? fakeAsr();
    const llm = opts.llm ?? fakeLlm();
    const recordings = createReviewRecordingProcessor({ db, asr, llm, recordingDir: dir, pollMs: 0, log: { error() {} } });
    const app = createApp({ db, tmdb: makeFakeTmdb(), llm, recordings, recordingDir: dir });
    return { app, asr, llm, recordings, ...seedSession(db) };
  }

  async function upload(app: any, sessionId: number, body = Buffer.from('fake-opus-bytes'), type = 'audio/webm;codecs=opus') {
    return request(app).post(`/api/sessions/${sessionId}/recordings`).set('Cookie', 'loweve_user_id=1')
      .set('Content-Type', type).set('X-Duration-Ms', '61000').send(body);
  }

  it('上传：原始录音原样落盘、建行；后台转写 + 生成后变 ready', async () => {
    const { app, asr, llm, recordings, sessionId, workId } = setup();
    const res = await upload(app, sessionId);
    assert.equal(res.status, 200);
    assert.equal(res.body.duration_ms, 61000);
    assert.equal(res.body.audio_url, `/api/recordings/${res.body.id}/audio`);
    const row = getRecording(db, res.body.id);
    assert.equal(row.work_id, workId);
    assert.equal(row.recorded_by, 1);
    assert.match(row.file_name, /^movie-\d+-\d+-[0-9a-f]{6}\.webm$/);
    assert.equal(fs.readFileSync(path.join(dir, row.file_name), 'utf8'), 'fake-opus-bytes');

    await recordings.run(row.id);
    const done = (await request(app).get(`/api/sessions/${sessionId}/recordings`)).body.recordings[0];
    assert.equal(done.status, 'ready');
    assert.deepEqual(done.transcript, TURNS);
    assert.deepEqual(done.draft.speaker_map, { 1: 2, 2: 1 });
    assert.equal(done.draft.b.rating, 8);
    assert.equal(done.draft.a.rating, null);
    assert.equal(done.draft.joint_note, '两人聊了结尾和节奏。');
    assert.equal(asr.calls.submit[0].filePath, path.join(dir, row.file_name));
    assert.equal(asr.calls.submit[0].filename, `loweve-movie${workId}-rec${row.id}.webm`);
    assert.match(llm.calls[0][1].content, /A = ff，B = xsq/);
  });

  it('上传校验：未登录 401、非音频 415、空文件 400、记录不存在 404', async () => {
    const { app, sessionId } = setup();
    assert.equal((await request(app).post(`/api/sessions/${sessionId}/recordings`).set('Content-Type', 'audio/webm').send(Buffer.from('x'))).status, 401);
    assert.equal((await upload(app, sessionId, Buffer.from('x'), 'text/plain')).status, 415);
    assert.equal((await upload(app, sessionId, Buffer.alloc(0))).status, 400);
    assert.equal((await upload(app, 9999)).status, 404);
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  it('转写失败 → error 且清掉 asr 任务号；重试会重新提交', async () => {
    const asr = fakeAsr({ statuses: ['running', 'error'] });
    const { app, recordings, sessionId } = setup({ asr });
    const { body } = await upload(app, sessionId);
    await recordings.run(body.id);
    const row = getRecording(db, body.id);
    assert.equal(row.status, 'error');
    assert.equal(row.error, 'asr_failed');
    assert.match(row.stage_message, /转写失败：Doubao 失败/);
    assert.equal(row.asr_job_id, null);

    const retried = await request(app).post(`/api/recordings/${body.id}/retry`).set('Cookie', 'loweve_user_id=2');
    assert.equal(retried.status, 200);
    assert.equal(retried.body.error, null);
    await recordings.run(body.id);
    assert.equal(asr.calls.submit.length, 2);   // 任务号已清，重试重新提交
  });

  it('生成失败保留转写；重试只重跑总结，不再转写', async () => {
    const llm = fakeLlm('抱歉我做不到');
    const asr = fakeAsr();
    const { app, recordings, sessionId } = setup({ asr, llm });
    const { body } = await upload(app, sessionId);
    await recordings.run(body.id);
    const row = getRecording(db, body.id);
    assert.equal(row.status, 'error');
    assert.equal(row.error, 'llm_parse');
    assert.ok(row.transcript_json);

    const retried = await request(app).post(`/api/recordings/${body.id}/retry`).set('Cookie', 'loweve_user_id=1');
    assert.equal(retried.body.status, 'summarizing');
    await recordings.run(body.id);
    assert.equal(asr.calls.submit.length, 1);
    assert.equal(asr.calls.transcript, 1);
    assert.equal(llm.calls.length, 2);
  });

  it('换说话人重新生成：保存确认的对应并写进提示词；处理中不能再提交', async () => {
    const { app, llm, recordings, sessionId, workId } = setup();
    const { body } = await upload(app, sessionId);
    await recordings.run(body.id);
    await request(app).put(`/api/sessions/${sessionId}/joint-review`).set('Cookie', 'loweve_user_id=1').send({ a: { rating: 8 }, recording_id: body.id });
    assert.ok(getRecording(db, body.id).applied_at);

    const now = Date.now();
    const busyId = db.prepare(`INSERT INTO review_recordings (kind, work_id, file_name, mime, size_bytes, status, transcript_json, created_at, updated_at)
      VALUES ('movie', ?, 'busy.webm', 'audio/webm', 1, 'summarizing', ?, ?, ?)`).run(workId, JSON.stringify(TURNS), now, now).lastInsertRowid;
    assert.equal((await request(app).post(`/api/recordings/${busyId}/regenerate`).set('Cookie', 'loweve_user_id=1').send({ speaker_map: { 1: 1 } })).status, 409);

    assert.equal((await request(app).post(`/api/recordings/${body.id}/regenerate`).set('Cookie', 'loweve_user_id=1').send({ speaker_map: { 1: 3 } })).status, 400);
    const res = await request(app).post(`/api/recordings/${body.id}/regenerate`).set('Cookie', 'loweve_user_id=1').send({ speaker_map: { 1: 1, 2: 2 } });
    assert.equal(res.body.status, 'summarizing');
    assert.equal(res.body.applied_at, null);   // 重新生成的草稿还没确认
    assert.deepEqual(res.body.speaker_map, { 1: 1, 2: 2 });
    await recordings.run(body.id);
    const row = getRecording(db, body.id);
    assert.equal(row.status, 'ready');
    assert.deepEqual(JSON.parse(row.draft_json).speaker_map, { 1: 1, 2: 2 });
    assert.match(llm.calls[1][1].content, /说话人1 = ff（A）；说话人2 = xsq（B）/);
  });

  it('重启续跑：转写中且有任务号的接着轮询，不重新提交', async () => {
    const asr = fakeAsr({ statuses: ['done'] });
    const { recordings, workId } = setup({ asr });
    const now = Date.now();
    fs.writeFileSync(path.join(dir, 'movie-x.webm'), 'x');
    const id = Number(db.prepare(`INSERT INTO review_recordings (kind, work_id, file_name, mime, size_bytes, status, asr_job_id, created_at, updated_at)
      VALUES ('movie', ?, 'movie-x.webm', 'audio/webm', 1, 'transcribing', 'job-old', ?, ?)`).run(workId, now, now).lastInsertRowid);
    assert.deepEqual(recordings.resumeAll(), [id]);
    await recordings.run(id);
    assert.equal(asr.calls.submit.length, 0);
    assert.equal(getRecording(db, id).status, 'ready');
  });

  it('LLM 报错时把服务自己的说明带到页面上', async () => {
    const { LlmError } = await import('../src/llm/client.js');
    const llm = { async chat() { throw new LlmError('llm_http', 404, { error: { message: 'magpie knows no model "x"' } }); } };
    const { app, recordings, sessionId } = setup({ llm });
    const { body } = await upload(app, sessionId);
    await recordings.run(body.id);
    const row = getRecording(db, body.id);
    assert.equal(row.error, 'llm_http');
    assert.equal(row.stage_message, '生成点评失败：magpie knows no model "x"');
  });

  it('没识别到说话 → asr_empty', async () => {
    const { app, recordings, sessionId } = setup({ asr: fakeAsr({ turns: [] }) });
    const { body } = await upload(app, sessionId);
    await recordings.run(body.id);
    assert.equal(getRecording(db, body.id).error, 'asr_empty');
  });

  it('回放支持 Range；下载带中文文件名、类型保持为音频', async () => {
    const { app, recordings, sessionId } = setup();
    const { body } = await upload(app, sessionId, Buffer.from('0123456789'));
    await recordings.run(body.id);
    const part = await request(app).get(body.audio_url).set('Range', 'bytes=2-5').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(part.status, 206);
    assert.equal(part.body.toString(), '2345');
    assert.match(part.headers['content-type'], /^audio\/webm/);
    const dl = await request(app).get(`${body.audio_url}?download=1`);
    assert.match(dl.headers['content-disposition'], /attachment/);
    assert.match(decodeURIComponent(dl.headers['content-disposition']), /花样年华-讨论录音-\d{4}-\d{2}-\d{2}\.webm/);
    assert.match(dl.headers['content-type'], /^audio\/webm/);
  });

  it('一起保存：两人评分点评 + 纪要一次写入，标记录音已采用', async () => {
    const { app, recordings, sessionId } = setup();
    const { body } = await upload(app, sessionId);
    await recordings.run(body.id);
    const res = await request(app).put(`/api/sessions/${sessionId}/joint-review`).set('Cookie', 'loweve_user_id=1').send({
      a: { rating: 7, comment: '  中段有点拖  ' }, b: { rating: 8, comment: '' }, joint_note: '聊了结尾', recording_id: body.id,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.rating_a, 7);
    assert.equal(res.body.review_a, '中段有点拖');
    assert.equal(res.body.rating_b, 8);
    assert.equal(res.body.review_b, null);
    assert.equal(res.body.joint_note, '聊了结尾');
    assert.ok(getRecording(db, body.id).applied_at);
  });

  it('第一次采用草稿时留住被替换的点评，之后的自动保存不再覆盖；原来全空就不留', async () => {
    const { app, recordings, sessionId } = setup();
    const { body } = await upload(app, sessionId);
    await recordings.run(body.id);
    const save = (payload: any) => request(app).put(`/api/sessions/${sessionId}/joint-review`).set('Cookie', 'loweve_user_id=1').send(payload);
    await save({ a: { rating: 8, comment: 'AI 草稿 A' }, b: { rating: 7, comment: 'AI 草稿 B' }, joint_note: '纪要', recording_id: body.id });
    await save({ a: { rating: 8, comment: 'AI 草稿 A，改了一句' }, recording_id: body.id });   // 采用后接着手改（自动保存）
    const rec = (await request(app).get(`/api/recordings/${body.id}`)).body;
    assert.deepEqual(rec.replaced, {
      a: { rating: 6, comment: '旧点评A' }, b: { rating: null, comment: null }, joint_note: null,
    });

    // 另一部原来没有任何点评：采用草稿不留空白副本
    const now = Date.now();
    const work2 = Number(db.prepare(`INSERT INTO works (tmdb_id, tmdb_type, title, rating_source, tmdb_raw, fetched_at, updated_at) VALUES (2, 'movie', '空', 'tmdb', '{}', ?, ?)`).run(now, now).lastInsertRowid);
    const s2 = Number(db.prepare('INSERT INTO couple_sessions (work_id, created_at) VALUES (?, ?)').run(work2, now).lastInsertRowid);
    const up2 = await upload(app, s2);
    await recordings.run(up2.body.id);
    await request(app).put(`/api/sessions/${s2}/joint-review`).set('Cookie', 'loweve_user_id=1').send({ a: { rating: 9, comment: 'x' }, recording_id: up2.body.id });
    assert.equal((await request(app).get(`/api/recordings/${up2.body.id}`)).body.replaced, null);
  });

  it('老库补 replaced_json 列（幂等）', async () => {
    const { migrateAddRecordingReplaced } = await import('../src/db/migrate.js');
    const { openDb } = await import('../src/db/index.js');
    const old = openDb(':memory:');
    old.exec(`CREATE TABLE review_recordings (id INTEGER PRIMARY KEY, draft_json TEXT)`);
    assert.equal(migrateAddRecordingReplaced(old), true);
    assert.equal(migrateAddRecordingReplaced(old), false);
    assert.ok(old.prepare(`SELECT 1 FROM pragma_table_info('review_recordings') WHERE name = 'replaced_json'`).get());
    old.close();
  });

  it('一起保存：只传一侧时另一侧不动；评分非法 400；未登录 401', async () => {
    const { app, sessionId } = setup();
    const res = await request(app).put(`/api/sessions/${sessionId}/joint-review`).set('Cookie', 'loweve_user_id=2').send({ b: { rating: null, comment: '还行' } });
    assert.equal(res.body.review_a, '旧点评A');
    assert.equal(res.body.rating_a, 6);
    assert.equal(res.body.review_b, '还行');
    assert.equal((await request(app).put(`/api/sessions/${sessionId}/joint-review`).set('Cookie', 'loweve_user_id=1').send({ a: { rating: 11 } })).status, 400);
    assert.equal((await request(app).put(`/api/sessions/${sessionId}/joint-review`).send({ a: { rating: 5 } })).status, 401);
  });
});
