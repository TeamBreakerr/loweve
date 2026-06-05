import request from 'supertest';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { makeTestDb, makeFakeTmdb } from './helpers.js';

describe('GET /api/search', () => {
  let db;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('正常 → 200 + results', async () => {
    const tmdb = makeFakeTmdb({
      search: async (q) => ({
        results: [
          { tmdb_id: 1, tmdb_type: 'movie', title: '花束般的恋爱', year: 2022, poster_path: '/a.jpg', overview: '', vote_average: 8.2, original_title: null },
        ],
      }),
    });
    const app = createApp({ db, tmdb });
    const res = await request(app).get('/api/search?q=' + encodeURIComponent('花束般的恋爱'));
    assert.equal(res.status, 200);
    assert.equal(res.body.results.length, 1);
    assert.equal(res.body.results[0].title, '花束般的恋爱');
  });

  it('缺 q 参数 → 400', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const res = await request(app).get('/api/search');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'missing_query');
  });

  it('空 q → 400', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const res = await request(app).get('/api/search?q=');
    assert.equal(res.status, 400);
  });

  it('tmdb 未配置 → 503', async () => {
    const tmdb = makeFakeTmdb({ isConfigured: () => false });
    const app = createApp({ db, tmdb });
    const res = await request(app).get('/api/search?q=x');
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'tmdb_not_configured');
  });

  it('tmdb 抛 tmdb_upstream → 502', async () => {
    const tmdb = makeFakeTmdb({
      search: async () => {
        const e = new Error('tmdb_upstream');
        e.code = 'tmdb_upstream';
        throw e;
      },
    });
    const app = createApp({ db, tmdb });
    const res = await request(app).get('/api/search?q=x');
    assert.equal(res.status, 502);
    assert.equal(res.body.error, 'tmdb_upstream');
  });

  it('tmdb 抛 tmdb_auth → 502', async () => {
    const tmdb = makeFakeTmdb({
      search: async () => {
        const e = new Error('tmdb_auth');
        e.code = 'tmdb_auth';
        throw e;
      },
    });
    const app = createApp({ db, tmdb });
    const res = await request(app).get('/api/search?q=x');
    assert.equal(res.status, 502);
    assert.equal(res.body.error, 'tmdb_auth');
  });

  it('组合查兜底：结果稀疏 + 含空格 → 拆词分别搜再合并', async () => {
    const calls = [];
    const tmdb = makeFakeTmdb({
      search: async (q) => {
        calls.push(q);
        if (q === '恋之罪 园子温') return { results: [] };       // 组合查 0 结果
        if (q === '恋之罪') return { results: [{ tmdb_id: 80662, tmdb_type: 'movie', title: '恋之罪' }] };
        if (q === '园子温') return { results: [{ tmdb_id: 99, tmdb_type: 'movie', title: '冰冷热带鱼', via: '导演 园子温' }] };
        return { results: [] };
      },
    });
    const app = createApp({ db, tmdb });
    const res = await request(app).get('/api/search?q=' + encodeURIComponent('恋之罪 园子温'));
    assert.equal(res.status, 200);
    // 组合查 + 两个拆词都搜了
    assert.ok(calls.includes('恋之罪 园子温'));
    assert.ok(calls.includes('恋之罪'));
    assert.ok(calls.includes('园子温'));
    // 合并后两部都在
    const ids = res.body.results.map(r => r.tmdb_id);
    assert.ok(ids.includes(80662));
    assert.ok(ids.includes(99));
  });

  it('结果充足时不触发拆词兜底', async () => {
    const calls = [];
    const tmdb = makeFakeTmdb({
      search: async (q) => {
        calls.push(q);
        return { results: [{ tmdb_id: 1, tmdb_type: 'movie' }, { tmdb_id: 2, tmdb_type: 'movie' }, { tmdb_id: 3, tmdb_type: 'movie' }] };
      },
    });
    const app = createApp({ db, tmdb });
    await request(app).get('/api/search?q=' + encodeURIComponent('某 长 查询'));
    assert.equal(calls.length, 1);  // 只搜了一次，没拆词
  });
});
