import request from 'supertest';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { makeTestDb, makeFakeTmdb } from './helpers.js';

function seedWork(db, tmdb_id = 1) {
  const now = Date.now();
  return db.prepare(`INSERT INTO works (tmdb_id, tmdb_type, title, rating_source, tmdb_raw, fetched_at, updated_at) VALUES (?, 'movie', 'X', 'tmdb', '{}', ?, ?)`).run(tmdb_id, now, now).lastInsertRowid;
}

describe('POST /api/plan', () => {
  let db;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('创建 plan，added_by=viewing', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    const res = await request(app).post('/api/plan').set('Cookie', 'loweve_user_id=2').send({
      work_id, note: '催泪', priority: 3
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.added_by, 2);
    assert.equal(res.body.status, 'pending');
    assert.equal(res.body.priority, 3);
  });

  it('UNIQUE(work_id) → 409', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    await request(app).post('/api/plan').set('Cookie', 'loweve_user_id=1').send({ work_id });
    const r2 = await request(app).post('/api/plan').set('Cookie', 'loweve_user_id=2').send({ work_id });
    assert.equal(r2.status, 409);
    assert.equal(r2.body.error, 'plan_exists');
  });
});

describe('GET /api/plan', () => {
  let db;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('返回所有 + 含 work', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const w = seedWork(db);
    await request(app).post('/api/plan').set('Cookie', 'loweve_user_id=1').send({ work_id: w });
    const res = await request(app).get('/api/plan');
    assert.equal(res.body.items.length, 1);
    assert.ok(res.body.items[0].work);
  });

  it('status 过滤', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const w1 = seedWork(db, 1);
    const w2 = seedWork(db, 2);
    const a = (await request(app).post('/api/plan').set('Cookie', 'loweve_user_id=1').send({ work_id: w1 })).body;
    await request(app).post('/api/plan').set('Cookie', 'loweve_user_id=1').send({ work_id: w2 });
    await request(app).put(`/api/plan/${a.id}`).send({ status: 'watching' });
    const r = await request(app).get('/api/plan?status=watching');
    assert.equal(r.body.items.length, 1);
    assert.equal(r.body.items[0].status, 'watching');
  });
});

describe('PUT/DELETE /api/plan/:id', () => {
  let db;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('PUT 切 status', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const w = seedWork(db);
    const c = (await request(app).post('/api/plan').set('Cookie', 'loweve_user_id=1').send({ work_id: w })).body;
    const r = await request(app).put(`/api/plan/${c.id}`).send({ status: 'watching' });
    assert.equal(r.body.status, 'watching');
  });

  it('PUT status 非法 → 400', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const w = seedWork(db);
    const c = (await request(app).post('/api/plan').set('Cookie', 'loweve_user_id=1').send({ work_id: w })).body;
    const r = await request(app).put(`/api/plan/${c.id}`).send({ status: 'invalid' });
    assert.equal(r.status, 400);
  });

  it('DELETE → 204', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const w = seedWork(db);
    const c = (await request(app).post('/api/plan').set('Cookie', 'loweve_user_id=1').send({ work_id: w })).body;
    const r = await request(app).delete(`/api/plan/${c.id}`);
    assert.equal(r.status, 204);
  });
});

describe('POST /api/sessions?from_plan=<id> 闭环', () => {
  let db;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('成功 → 插入 session + plan status=done（事务）', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const w = seedWork(db);
    const plan = (await request(app).post('/api/plan').set('Cookie', 'loweve_user_id=1').send({ work_id: w })).body;
    const res = await request(app).post(`/api/sessions?from_plan=${plan.id}`).set('Cookie', 'loweve_user_id=1').send({
      watched_at: 20250101, rating: 9, joint_note: '终于看完'
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.work_id, w);
    assert.equal(res.body.rating_a, 9);

    const planAfter = db.prepare('SELECT status FROM plan_items WHERE id = ?').get(plan.id);
    assert.equal(planAfter.status, 'done');
  });

  it('from_plan 不存在 → 404，不写 session', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const res = await request(app).post('/api/sessions?from_plan=999').set('Cookie', 'loweve_user_id=1').send({ watched_at: 20250101 });
    assert.equal(res.status, 404);
    const count = db.prepare('SELECT COUNT(*) AS c FROM couple_sessions').get().c;
    assert.equal(count, 0);
  });
});
