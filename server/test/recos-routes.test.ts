// server/test/recos-routes.test.js
import request from 'supertest';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { makeTestDb, makeFakeTmdb, makeFakeBangumi, makeFakeDouban, makeFakeLlm } from './helpers.js';

const FAKE_MOVIE = (id) => ({
  id, title: `片${id}`, original_title: `Movie ${id}`, release_date: '2020-01-01',
  overview: '', genres: [{ id: 18, name: '剧情' }], runtime: 100, origin_country: ['US'],
  vote_average: 8.0, vote_count: 100, poster_path: `/p${id}.jpg`, external_ids: { imdb_id: null },
});

function appWith(db, { chat }: any = {}) {
  const llm = makeFakeLlm({ chat: chat ?? (async () => JSON.stringify([
    { title: '片101', year: 2020, type: 'movie', reason: '你们都爱剧情片' },
  ])) });
  const tmdb = makeFakeTmdb({
    search: async (q) => ({ results: [{ tmdb_id: Number(q.replace('片', '')), tmdb_type: 'movie', title: q, original_title: q, year: 2020 }] }),
    movieDetail: async (id) => FAKE_MOVIE(id),
  });
  return createApp({ db, tmdb, bangumi: makeFakeBangumi(), douban: {}, llm });   // douban 无 match：feedback/生成不触发异步入队
}

describe('recos routes', () => {
  let db;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('GET /api/recos 空 → 生成并返回', async () => {
    const res = await request(appWith(db)).get('/api/recos');
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].title, '片101');
    assert.equal(res.body.error, null);
  });

  it('POST /api/recos/refresh 强制重生', async () => {
    const app = appWith(db);
    await request(app).get('/api/recos');
    const res = await request(app).post('/api/recos/refresh');
    assert.equal(res.status, 200);
    assert.ok(res.body.batch_id);
  });

  it('POST /api/recos/custom 带 prompt → rec_type=custom', async () => {
    const res = await request(appWith(db)).post('/api/recos/custom').send({ prompt: '90分钟治愈' });
    assert.equal(res.status, 200);
    assert.equal(res.body.rec_type, 'custom');
  });

  it('feedback want → 写 interested + 建 plan_item', async () => {
    const app = appWith(db);
    const recos = (await request(app).get('/api/recos')).body;
    const id = recos.items[0].id;
    const res = await request(app).post(`/api/recos/${id}/feedback`).set('Cookie', 'loweve_user_id=1').send({ action: 'want' });
    assert.equal(res.status, 200);
    const plan = (await request(app).get('/api/plan')).body;
    assert.equal(plan.items.length, 1);
    const row = db.prepare('SELECT feedback FROM recommendations WHERE id = ?').get(id);
    assert.equal(row.feedback, 'interested');
  });

  it('feedback not_interested → 写避雷 + 该卡不再出现在批次', async () => {
    const app = appWith(db);
    const recos = (await request(app).get('/api/recos')).body;
    const id = recos.items[0].id;
    const res = await request(app).post(`/api/recos/${id}/feedback`).set('Cookie', 'loweve_user_id=1').send({ action: 'not_interested' });
    assert.equal(res.status, 200);
    const row = db.prepare('SELECT feedback FROM recommendations WHERE id = ?').get(id);
    assert.equal(row.feedback, 'not_interested');
  });

  it('feedback already_seen → 加入「我已观看」(user_mark watched) + 避雷', async () => {
    const app = appWith(db);
    const recos = (await request(app).get('/api/recos')).body;
    const id = recos.items[0].id, workId = recos.items[0].work_id;
    const res = await request(app).post(`/api/recos/${id}/feedback`).set('Cookie', 'loweve_user_id=1').send({ action: 'already_seen' });
    assert.equal(res.status, 200);
    const mark = db.prepare('SELECT status FROM user_marks WHERE user_id = 1 AND work_id = ?').get(workId);
    assert.equal(mark?.status, 'watched');
    assert.equal(db.prepare('SELECT feedback FROM recommendations WHERE id = ?').get(id).feedback, 'already_seen');
  });

  it('feedback 非法 action → 400', async () => {
    const app = appWith(db);
    const recos = (await request(app).get('/api/recos')).body;
    const res = await request(app).post(`/api/recos/${recos.items[0].id}/feedback`).set('Cookie', 'loweve_user_id=1').send({ action: 'bogus' });
    assert.equal(res.status, 400);
  });

  it('llm 未配置 → GET 返回空 + error，不 500', async () => {
    const llm = makeFakeLlm({ isConfigured: () => false });
    const app = createApp({ db, tmdb: makeFakeTmdb(), bangumi: makeFakeBangumi(), douban: makeFakeDouban(), llm });
    const res = await request(app).get('/api/recos');
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 0);
    assert.equal(res.body.error, 'llm_unconfigured');
  });
});
