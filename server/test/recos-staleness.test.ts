// server/test/recos-staleness.test.js
import request from 'supertest';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { makeTestDb, makeFakeTmdb, makeFakeBangumi, makeFakeDouban, makeFakeLlm } from './helpers.js';
import { clearRecosStale, isRecosStale } from '../src/recos/state.js';

const FAKE_MOVIE = { id: 5, title: '片5', original_title: 'M5', release_date: '2020-01-01', overview: '', genres: [{ id: 18, name: '剧情' }], runtime: 100, origin_country: ['US'], vote_average: 8, vote_count: 10, poster_path: '/p.jpg', external_ids: { imdb_id: null } };

function app(db: any) {
  return createApp({
    db,
    tmdb: makeFakeTmdb({ movieDetail: async () => FAKE_MOVIE }),
    bangumi: makeFakeBangumi(), douban: makeFakeDouban(), llm: makeFakeLlm(),
  });
}

describe('recos staleness 钩子', () => {
  let db: any;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('加 mark → 置 stale', async () => {
    clearRecosStale(db);
    await request(app(db)).post('/api/marks').set('Cookie', 'loweve_user_id=1')
      .send({ status: 'watched', tmdb_id: 5, tmdb_type: 'movie' });
    assert.equal(isRecosStale(db), true);
  });

  it('加 plan → 置 stale', async () => {
    clearRecosStale(db);
    await request(app(db)).post('/api/plan').set('Cookie', 'loweve_user_id=1')
      .send({ tmdb_id: 5, tmdb_type: 'movie' });
    assert.equal(isRecosStale(db), true);
  });

  it('加 session → 置 stale', async () => {
    clearRecosStale(db);
    await request(app(db)).post('/api/sessions').set('Cookie', 'loweve_user_id=1')
      .send({ tmdb_id: 5, tmdb_type: 'movie', watched_at: 20200101, rating_a: 8 });
    assert.equal(isRecosStale(db), true);
  });

  it('编辑 session 只改观看日期 → 不置 stale（日期不影响推荐）', async () => {
    const { body: s } = await request(app(db)).post('/api/sessions').set('Cookie', 'loweve_user_id=1')
      .send({ tmdb_id: 5, tmdb_type: 'movie', watched_at: 20200101, rating: 8 });
    clearRecosStale(db);
    await request(app(db)).put(`/api/sessions/${s.id}`).set('Cookie', 'loweve_user_id=1')
      .send({ watched_at: 20211231 });
    assert.equal(isRecosStale(db), false);
  });

  it('编辑 session 改评分 → 置 stale', async () => {
    const { body: s } = await request(app(db)).post('/api/sessions').set('Cookie', 'loweve_user_id=1')
      .send({ tmdb_id: 5, tmdb_type: 'movie', watched_at: 20200101, rating: 8 });
    clearRecosStale(db);
    await request(app(db)).put(`/api/sessions/${s.id}`).set('Cookie', 'loweve_user_id=1')
      .send({ rating_a: 10 });
    assert.equal(isRecosStale(db), true);
  });

  it('编辑 session 改个人短评 → 置 stale（短评是口味信号）', async () => {
    const { body: s } = await request(app(db)).post('/api/sessions').set('Cookie', 'loweve_user_id=1')
      .send({ tmdb_id: 5, tmdb_type: 'movie', watched_at: 20200101, rating: 8 });
    clearRecosStale(db);
    await request(app(db)).put(`/api/sessions/${s.id}`).set('Cookie', 'loweve_user_id=1')
      .send({ review_a: '这种设定我太爱了' });
    assert.equal(isRecosStale(db), true);
  });
});
