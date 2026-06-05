import request from 'supertest';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { makeTestDb, makeFakeTmdb } from './helpers.js';

const FAKE_MOVIE = {
  id: 1, title: 'A', original_title: 'A',
  release_date: '2020-01-01', overview: '', genres: [],
  runtime: 100, origin_country: ['US'], vote_average: 7, vote_count: 10,
  poster_path: null, external_ids: { imdb_id: null },
};

function seedWork(db: any, tmdb_id = 1) {
  // 直接 INSERT 一条 work（绕过 tmdb，给已知 work_id 用）
  const now = Date.now();
  const info = db.prepare(`INSERT INTO works (tmdb_id, tmdb_type, title, rating_source, tmdb_raw, fetched_at, updated_at) VALUES (?, 'movie', 'X', 'tmdb', '{}', ?, ?)`).run(tmdb_id, now, now);
  return info.lastInsertRowid;
}

describe('POST /api/marks (Form A: work_id)', () => {
  let db: any;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('user_id 来自 cookie，创建 watched mark', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    const res = await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=1').send({
      work_id, status: 'watched', rating: 9, comment: '好'
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user_id, 1);
    assert.equal(res.body.work_id, work_id);
    assert.equal(res.body.status, 'watched');
    assert.equal(res.body.rating, 9);
    assert.equal(res.body.comment, '好');
  });

  it('as_user 覆盖 cookie', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    const res = await request(app).post('/api/marks?as_user=2').set('Cookie', 'loweve_user_id=1').send({
      work_id, status: 'wish'
    });
    assert.equal(res.body.user_id, 2);
  });

  it('UNIQUE(user_id, work_id) 触发 409', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=1').send({ work_id, status: 'watched' });
    const r2 = await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=1').send({ work_id, status: 'watched' });
    assert.equal(r2.status, 409);
    assert.equal(r2.body.error, 'mark_exists');
  });

  it('无身份（无 cookie 无 as_user） → 401', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    const res = await request(app).post('/api/marks').send({ work_id, status: 'wish' });
    assert.equal(res.status, 401);
  });

  it('status 非法 → 400', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    const res = await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=1').send({ work_id, status: 'foo' });
    assert.equal(res.status, 400);
  });

  it('rating 超出 1-10 → 400', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    const res = await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=1').send({ work_id, status: 'watched', rating: 11 });
    assert.equal(res.status, 400);
  });
});

describe('POST /api/marks (Form B: tmdb_id + tmdb_type)', () => {
  let db: any;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('先 upsert work 再创建 mark', async () => {
    const tmdb = makeFakeTmdb({ movieDetail: async () => FAKE_MOVIE });
    const app = createApp({ db, tmdb });
    const res = await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=1').send({
      tmdb_id: 1, tmdb_type: 'movie', status: 'watched', rating: 8
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.work_id);
    assert.equal(res.body.user_id, 1);
    // 验证 work 落库了
    const work = db.prepare('SELECT * FROM works WHERE tmdb_id = 1 AND tmdb_type = ?').get('movie');
    assert.ok(work);
  });
});

describe('GET /api/marks', () => {
  let db: any;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('默认列出 viewing user 的所有 marks（含 work）', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=1').send({ work_id, status: 'watched', rating: 9 });
    const res = await request(app).get('/api/marks').set('Cookie', 'loweve_user_id=1');
    assert.equal(res.status, 200);
    assert.equal(res.body.marks.length, 1);
    assert.equal(res.body.marks[0].status, 'watched');
    assert.ok(res.body.marks[0].work);
    assert.equal(res.body.marks[0].work.title, 'X');
  });

  it('status=watched 过滤', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const w1 = seedWork(db, 1);
    const w2 = seedWork(db, 2);
    await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=1').send({ work_id: w1, status: 'watched' });
    await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=1').send({ work_id: w2, status: 'wish' });
    const watched = await request(app).get('/api/marks?status=watched').set('Cookie', 'loweve_user_id=1');
    assert.equal(watched.body.marks.length, 1);
    assert.equal(watched.body.marks[0].status, 'watched');
  });

  it('as_user 切换查看对方', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const w1 = seedWork(db);
    await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=2').send({ work_id: w1, status: 'watched' });
    const res = await request(app).get('/api/marks?as_user=2').set('Cookie', 'loweve_user_id=1');
    assert.equal(res.body.marks.length, 1);
    assert.equal(res.body.marks[0].user_id, 2);
  });
});

describe('PUT/DELETE /api/marks/:id', () => {
  let db: any;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('PUT 改 rating/comment/status', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    const created = (await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=1').send({ work_id, status: 'wish' })).body;
    const res = await request(app).put(`/api/marks/${created.id}`).send({ status: 'watched', rating: 10 });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'watched');
    assert.equal(res.body.rating, 10);
  });

  it('DELETE → 204 + 库里没了', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const work_id = seedWork(db);
    const created = (await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=1').send({ work_id, status: 'watched' })).body;
    const res = await request(app).delete(`/api/marks/${created.id}`);
    assert.equal(res.status, 204);
    const row = db.prepare('SELECT * FROM user_marks WHERE id = ?').get(created.id);
    assert.equal(row, undefined);
  });
});
