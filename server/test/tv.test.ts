// server/test/tv.test.js
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeTestDb, makeFakeTmdb, makeFakeBangumi, makeFakeDouban, makeFakeLlm } from './helpers.js';

function appWith(tmdbImpl: any) {
  return createApp({ db: makeTestDb(), tmdb: makeFakeTmdb(tmdbImpl), bangumi: makeFakeBangumi(), douban: makeFakeDouban(), llm: makeFakeLlm() });
}

describe('GET /api/tv/:id/seasons', () => {
  it('返回 season>=1 的季，过滤 Specials', async () => {
    const app = appWith({ tvDetail: async () => ({ id: 66732, seasons: [
      { season_number: 0, name: '特别篇', air_date: '2016-01-01', episode_count: 2, poster_path: '/sp.jpg' },
      { season_number: 1, name: '第 1 季', air_date: '2016-07-15', episode_count: 8, poster_path: '/s1.jpg' },
      { season_number: 4, name: '第 4 季', air_date: '2022-05-27', episode_count: 9, poster_path: '/s4.jpg' },
    ] }) });
    const res = await request(app).get('/api/tv/66732/seasons');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.seasons.map((s: any) => s.season_number), [1, 4]);
    assert.equal(res.body.seasons[1].year, 2022);
    assert.equal(res.body.track_by_season, true);
    assert.equal(res.body.episode_count, null);
  });

  it('TMDB 未配置 → 503', async () => {
    const app = appWith({ isConfigured: () => false, tvDetail: async () => ({}) });
    const res = await request(app).get('/api/tv/1/seasons');
    assert.equal(res.status, 503);
  });

  it('《特别的她》完全遵循 TMDB 的季定义，不在服务端猜测合集', async () => {
    const app = appWith({ tvDetail: async () => ({
      id: 5895,
      name: '特别的她',
      first_air_date: '2000-04-26',
      seasons: [
        { season_number: 1, name: '特别的她', air_date: '2000-04-26', episode_count: 6 },
        { season_number: 2, name: '进步', air_date: '2018-06-02', episode_count: 6 },
        { season_number: 3, name: '另类', air_date: '2018-09-07', episode_count: 6 },
        { season_number: 4, name: '垃圾摇滚', air_date: '2023-09-10', episode_count: 3 },
        { season_number: 5, name: '盯鞋摇滚', air_date: '2023-10-01', episode_count: 3 },
      ],
    }) });

    const res = await request(app).get('/api/tv/5895/seasons');

    assert.equal(res.status, 200);
    assert.equal(res.body.track_by_season, true);
    assert.equal(res.body.episode_count, null);
    assert.deepEqual(res.body.seasons.map((season: any) => season.season_number), [1, 2, 3, 4, 5]);
  });

  it('非法 id → 400', async () => {
    const app = appWith({ tvDetail: async () => ({}) });
    const res = await request(app).get('/api/tv/abc/seasons');
    assert.equal(res.status, 400);
  });
});
