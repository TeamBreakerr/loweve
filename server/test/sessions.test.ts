import request from 'supertest';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { makeTestDb, makeFakeTmdb } from './helpers.js';

function seedWork(db: any) {
  const now = Date.now();
  return db.prepare(`INSERT INTO works (tmdb_id, tmdb_type, title, rating_source, tmdb_raw, fetched_at, updated_at) VALUES (1, 'movie', 'X', 'tmdb', '{}', ?, ?)`).run(now, now).lastInsertRowid;
}

describe('POST /api/sessions', () => {
  let db: any;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('viewing=1 → 写 rating_a/review_a，rating_b/review_b 留空', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    const res = await request(app).post('/api/sessions').set('Cookie', 'loweve_user_id=1').send({
      work_id, watched_at: 20240315, rating: 9, review: '好看', joint_note: '我们都喜欢'
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.rating_a, 9);
    assert.equal(res.body.review_a, '好看');
    assert.equal(res.body.rating_b, null);
    assert.equal(res.body.review_b, null);
    assert.equal(res.body.joint_note, '我们都喜欢');
  });

  it('viewing=2 → 写 rating_b/review_b', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    const res = await request(app).post('/api/sessions?as_user=2').set('Cookie', 'loweve_user_id=1').send({
      work_id, watched_at: 20240315, rating: 8, review: 'ok'
    });
    assert.equal(res.body.rating_a, null);
    assert.equal(res.body.rating_b, 8);
    assert.equal(res.body.review_b, 'ok');
  });

  it('rating 可省略 → 全 null', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    const res = await request(app).post('/api/sessions').set('Cookie', 'loweve_user_id=1').send({
      work_id, watched_at: 20240315
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.rating_a, null);
    assert.equal(res.body.review_a, null);
  });

  it('同一 work 重复添加 → 409 + 明确提示码', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    await request(app).post('/api/sessions').set('Cookie', 'loweve_user_id=1').send({ work_id, watched_at: 20240315 });
    const r2 = await request(app).post('/api/sessions').set('Cookie', 'loweve_user_id=1').send({ work_id, watched_at: 20250315 });
    assert.equal(r2.status, 409);
    assert.equal(r2.body.error, 'session_exists');
  });

  it('watched_at 为空 → 200，默认存当前日期', async () => {
    const realNow = Date.now;
    Date.now = () => new Date('2026-08-01T12:00:00Z').getTime();
    try {
      const app = createApp({ db, tmdb: makeFakeTmdb() });
      const work_id = seedWork(db);
      const res = await request(app).post('/api/sessions').set('Cookie', 'loweve_user_id=1').send({ work_id, watched_at: null, rating: 7 });
      assert.equal(res.status, 200);
      assert.equal(res.body.watched_at, 20260801);
      assert.equal(res.body.rating_a, 7);
    } finally {
      Date.now = realNow;
    }
  });

  it('watched_at 非整数（非 null）→ 400', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    const res = await request(app).post('/api/sessions').set('Cookie', 'loweve_user_id=1').send({ work_id, watched_at: 'abc' });
    assert.equal(res.status, 400);
  });

  it('无身份 → 401', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    const res = await request(app).post('/api/sessions').send({ work_id, watched_at: 20240315 });
    assert.equal(res.status, 401);
  });
});

describe('GET /api/sessions', () => {
  let db: any;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('按 watched_at DESC + 含 work join', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work1 = seedWork(db);
    const work2 = db.prepare(`INSERT INTO works (tmdb_id, tmdb_type, title, rating_source, tmdb_raw, fetched_at, updated_at) VALUES (2, 'movie', 'Y', 'tmdb', '{}', ?, ?)`).run(Date.now(), Date.now()).lastInsertRowid;
    await request(app).post('/api/sessions').set('Cookie', 'loweve_user_id=1').send({ work_id: work1, watched_at: 20240101 });
    await request(app).post('/api/sessions').set('Cookie', 'loweve_user_id=1').send({ work_id: work2, watched_at: 20250101 });
    const res = await request(app).get('/api/sessions');
    assert.equal(res.status, 200);
    assert.equal(res.body.sessions.length, 2);
    assert.equal(res.body.sessions[0].watched_at, 20250101);  // DESC
    assert.ok(res.body.sessions[0].work);
    assert.equal(res.body.sessions[0].work.title, 'Y');
  });
});

describe('PUT/DELETE /api/sessions/:id', () => {
  let db: any;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('PUT 允许同时改两侧（不像 POST 限制）', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    const created = (await request(app).post('/api/sessions').set('Cookie', 'loweve_user_id=1').send({ work_id, watched_at: 20240315, rating: 9 })).body;
    const res = await request(app).put(`/api/sessions/${created.id}`).send({
      rating_b: 8, review_b: 'Bob 后补', joint_note: '我们的备注'
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.rating_a, 9);     // 原值保留
    assert.equal(res.body.rating_b, 8);     // 后补
    assert.equal(res.body.review_b, 'Bob 后补');
    assert.equal(res.body.joint_note, '我们的备注');
  });

  it('PUT watched_at: null → 清空日期（之前 COALESCE 清不掉）', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    const created = (await request(app).post('/api/sessions').set('Cookie', 'loweve_user_id=1').send({ work_id, watched_at: 20240315 })).body;
    const res = await request(app).put(`/api/sessions/${created.id}`).send({ watched_at: null });
    assert.equal(res.status, 200);
    assert.equal(res.body.watched_at, null);
  });

  it('PUT 不带 watched_at → 保留原日期', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    const created = (await request(app).post('/api/sessions').set('Cookie', 'loweve_user_id=1').send({ work_id, watched_at: 20240315 })).body;
    const res = await request(app).put(`/api/sessions/${created.id}`).send({ joint_note: '只改备注' });
    assert.equal(res.body.watched_at, 20240315);
  });

  it('DELETE → 204', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    const created = (await request(app).post('/api/sessions').set('Cookie', 'loweve_user_id=1').send({ work_id, watched_at: 20240315 })).body;
    const res = await request(app).delete(`/api/sessions/${created.id}`);
    assert.equal(res.status, 204);
  });
});
