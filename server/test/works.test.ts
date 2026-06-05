import request from 'supertest';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { makeTestDb, makeFakeTmdb, makeFakeBangumi, makeFakeDouban } from './helpers.js';

const FAKE_MOVIE = {
  id: 695932, title: '花束般的恋爱', original_title: '花束みたいな恋をした',
  release_date: '2022-01-21', overview: '...', genres: [{id:18,name:'剧情'}],
  runtime: 124, origin_country: ['JP'], vote_average: 8.2, vote_count: 100,
  poster_path: '/a.jpg', external_ids: { imdb_id: 'tt12345' },
};

const FAKE_TV_ANIME = {
  id: 328609, name: '孤独摇滚！', original_name: 'ぼっち・ざ・ろっく！',
  first_air_date: '2022-10-08', overview: '...', genres: [{id:16,name:'动画'}],
  episode_run_time: [23], origin_country: ['JP'], vote_average: 8.4, vote_count: 200,
  poster_path: '/b.jpg', external_ids: { imdb_id: null },
};

describe('POST /api/works', () => {
  let db: any;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('首次入库电影 → 调 movieDetail → 返回 work', async () => {
    let calls = 0;
    const tmdb = makeFakeTmdb({ movieDetail: async (id: any) => { calls++; assert.equal(id, 695932); return FAKE_MOVIE; } });
    const app = createApp({ db, tmdb });
    const res = await request(app).post('/api/works').send({ tmdb_id: 695932, tmdb_type: 'movie' });
    assert.equal(res.status, 200);
    assert.equal(res.body.title, '花束般的恋爱');
    assert.equal(res.body.year, 2022);
    assert.equal(res.body.is_anime, 0);
    assert.equal(res.body.rating_source, 'tmdb');
    assert.equal(res.body.primary_poster_url, 'https://image.tmdb.org/t/p/w500/a.jpg');
    assert.equal(calls, 1);
  });

  it('重复入库 → cached，不再调 movieDetail', async () => {
    let calls = 0;
    const tmdb = makeFakeTmdb({ movieDetail: async () => { calls++; return FAKE_MOVIE; } });
    const app = createApp({ db, tmdb });
    await request(app).post('/api/works').send({ tmdb_id: 695932, tmdb_type: 'movie' });
    const res2 = await request(app).post('/api/works').send({ tmdb_id: 695932, tmdb_type: 'movie' });
    assert.equal(res2.status, 200);
    assert.equal(res2.body.tmdb_id, 695932);
    assert.equal(calls, 1);  // 只调一次
  });

  it('电视剧/动漫入库 → 调 tvDetail + is_anime=1', async () => {
    const tmdb = makeFakeTmdb({ tvDetail: async () => FAKE_TV_ANIME });
    const app = createApp({ db, tmdb });
    const res = await request(app).post('/api/works').send({ tmdb_id: 328609, tmdb_type: 'tv' });
    assert.equal(res.status, 200);
    assert.equal(res.body.is_anime, 1);
    assert.equal(res.body.runtime, 23);
  });

  it('参数缺失 → 400', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const res = await request(app).post('/api/works').send({ tmdb_id: 1 });
    assert.equal(res.status, 400);
  });

  it('tmdb_type 非法 → 400', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const res = await request(app).post('/api/works').send({ tmdb_id: 1, tmdb_type: 'book' });
    assert.equal(res.status, 400);
  });

  it('tmdb 上游 5xx → 502', async () => {
    const tmdb = makeFakeTmdb({ movieDetail: async () => { const e: any = new Error('x'); e.code = 'tmdb_upstream'; throw e; } });
    const app = createApp({ db, tmdb });
    const res = await request(app).post('/api/works').send({ tmdb_id: 1, tmdb_type: 'movie' });
    assert.equal(res.status, 502);
  });
});

describe('GET /api/works/:id', () => {
  let db: any;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('返回 work + 空关联', async () => {
    const tmdb = makeFakeTmdb({ movieDetail: async () => FAKE_MOVIE });
    const app = createApp({ db, tmdb });
    const created = (await request(app).post('/api/works').send({ tmdb_id: 695932, tmdb_type: 'movie' })).body;
    const res = await request(app).get(`/api/works/${created.id}`).set('Cookie', 'loweve_user_id=1');
    assert.equal(res.status, 200);
    assert.equal(res.body.id, created.id);
    assert.equal(res.body.title, '花束般的恋爱');
    assert.equal(res.body.my_mark, null);
    assert.deepEqual(res.body.all_marks, []);
    assert.deepEqual(res.body.sessions, []);
    assert.equal(res.body.plan, null);
  });

  it('id 不存在 → 404', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const res = await request(app).get('/api/works/999');
    assert.equal(res.status, 404);
  });
});

const FAKE_TV_ANIME_BGM = {
  id: 328609, name: '孤独摇滚！', original_name: 'ぼっち・ざ・ろっく！',
  first_air_date: '2022-10-08', overview: '...', genres: [{id:16,name:'动画'}],
  episode_run_time: [23], origin_country: ['JP'], vote_average: 7.9, vote_count: 100,
  poster_path: '/tmdb.jpg', external_ids: { imdb_id: null },
};
const FAKE_MOVIE2 = {
  id: 695932, title: '花束般的恋爱', original_title: '花束みたいな恋をした',
  release_date: '2021-01-29', overview: '', genres: [{id:18,name:'剧情'}],
  runtime: 124, origin_country: ['JP'], vote_average: 8.0, vote_count: 50,
  poster_path: '/movie.jpg', external_ids: { imdb_id: 'tt1' },
};
const BGM_HIT = {
  bangumi_id: 328609, name: 'ぼっち・ざ・ろっく！', name_cn: '孤独摇滚！',
  year: 2022, score: 8.4, votes: 39589, poster_url: 'https://lain.bgm.tv/x.jpg',
};

describe('upsertWork Bangumi 升级', () => {
  let db: any;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('番剧命中 Bangumi → 升级评分/海报/来源', async () => {
    const tmdb = makeFakeTmdb({ tvDetail: async () => FAKE_TV_ANIME_BGM });
    const bangumi = makeFakeBangumi({ searchAnime: async () => [BGM_HIT] });
    const app = createApp({ db, tmdb, bangumi });
    const res = await request(app).post('/api/works').send({ tmdb_id: 328609, tmdb_type: 'tv' });
    assert.equal(res.status, 200);
    assert.equal(res.body.rating_source, 'bangumi');
    assert.equal(res.body.primary_rating, 8.4);
    assert.equal(res.body.primary_rating_count, 39589);
    assert.equal(res.body.primary_poster_url, 'https://lain.bgm.tv/x.jpg');
    assert.equal(res.body.bangumi_id, 328609);
  });

  it('电影不查 Bangumi → 保持 tmdb', async () => {
    let bgmCalled = false;
    const tmdb = makeFakeTmdb({ movieDetail: async () => FAKE_MOVIE2 });
    const bangumi = makeFakeBangumi({ searchAnime: async () => { bgmCalled = true; return []; } });
    const app = createApp({ db, tmdb, bangumi });
    const res = await request(app).post('/api/works').send({ tmdb_id: 695932, tmdb_type: 'movie' });
    assert.equal(res.body.rating_source, 'tmdb');
    assert.equal(bgmCalled, false);
  });

  it('番剧 Bangumi 无可信匹配 → 保持 tmdb', async () => {
    const tmdb = makeFakeTmdb({ tvDetail: async () => FAKE_TV_ANIME_BGM });
    const bangumi = makeFakeBangumi({ searchAnime: async () => [] });  // 空候选 → matcher null
    const app = createApp({ db, tmdb, bangumi });
    const res = await request(app).post('/api/works').send({ tmdb_id: 328609, tmdb_type: 'tv' });
    assert.equal(res.body.rating_source, 'tmdb');
    assert.equal(res.body.primary_rating, 7.9);  // TMDB 原值
  });

  it('番剧 Bangumi 抛错 → 优雅降级保持 tmdb', async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const tmdb = makeFakeTmdb({ tvDetail: async () => FAKE_TV_ANIME_BGM });
      const bangumi = makeFakeBangumi({ searchAnime: async () => { throw new Error('bangumi down'); } });
      const app = createApp({ db, tmdb, bangumi });
      const res = await request(app).post('/api/works').send({ tmdb_id: 328609, tmdb_type: 'tv' });
      assert.equal(res.status, 200);
      assert.equal(res.body.rating_source, 'tmdb');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('cached 番剧不重新匹配 Bangumi', async () => {
    let calls = 0;
    const tmdb = makeFakeTmdb({ tvDetail: async () => FAKE_TV_ANIME_BGM });
    const bangumi = makeFakeBangumi({ searchAnime: async () => { calls++; return [BGM_HIT]; } });
    const app = createApp({ db, tmdb, bangumi });
    await request(app).post('/api/works').send({ tmdb_id: 328609, tmdb_type: 'tv' });
    await request(app).post('/api/works').send({ tmdb_id: 328609, tmdb_type: 'tv' });
    assert.equal(calls, 1);  // 第二次 cached，不再查 bangumi
  });

  it('已存在但仍 tmdb 的番剧，再次完整 upsert → 同步重试 Bangumi（自愈，对应推荐 want）', async () => {
    const { upsertWork } = await import('../src/routes/works.js');
    const tmdb = makeFakeTmdb({ tvDetail: async () => FAKE_TV_ANIME_BGM });
    const bangumi = makeFakeBangumi({ searchAnime: async () => [BGM_HIT] });
    // 先 skipUpgrade 入库（模拟推荐纯 tmdb 入库）→ 停留 tmdb
    const w1 = await upsertWork(db, tmdb, bangumi, makeFakeDouban(), { tmdb_id: 328609, tmdb_type: 'tv', skipUpgrade: true });
    assert.equal(w1.rating_source, 'tmdb');
    // 再完整 upsert（如点「想看」）→ 应升级到 bangumi
    const w2 = await upsertWork(db, tmdb, bangumi, makeFakeDouban(), { tmdb_id: 328609, tmdb_type: 'tv' });
    assert.equal(w2.rating_source, 'bangumi');
    assert.equal(w2.primary_rating, 8.4);
    assert.equal(w2.bangumi_id, 328609);
  });
});

describe('upsertWork Douban 异步升级', () => {
  let db: any;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('电影入库立即返回 TMDB，后台升级为 Douban', async () => {
    let calls = 0;
    const tmdb = makeFakeTmdb({ movieDetail: async () => FAKE_MOVIE2 });
    const douban = makeFakeDouban({
      match: async ({ title, year }: any) => {
        calls++;
        assert.equal(title, '花束般的恋爱');
        assert.equal(year, 2021);
        return {
          douban_id: '34874432',
          rating: 8.6,
          votes: 835000,
          poster_url: null,
          url: 'https://movie.douban.com/subject/34874432/',
          matched_title: '花束般的恋爱 花束みたいな恋をした (2021)',
          matched_year: 2021,
        };
      },
    });
    const app = createApp({ db, tmdb, douban });

    const res = await request(app).post('/api/works').send({ tmdb_id: 695932, tmdb_type: 'movie' });

    assert.equal(res.status, 200);
    assert.equal(res.body.rating_source, 'tmdb');
    assert.equal(res.body.primary_rating, 8.0);

    const upgraded = await eventually(() => {
      const row = db.prepare('SELECT rating_source, primary_rating, primary_rating_count, primary_poster_url, douban_id, douban_url, douban_raw FROM works WHERE id = ?').get(res.body.id);
      return row.rating_source === 'douban' ? row : null;
    });
    assert.equal(calls, 1);
    assert.equal(upgraded.primary_rating, 8.6);
    assert.equal(upgraded.primary_rating_count, 835000);
    assert.equal(upgraded.primary_poster_url, 'https://image.tmdb.org/t/p/w500/movie.jpg');
    assert.equal(upgraded.douban_id, '34874432');
    assert.equal(upgraded.douban_url, 'https://movie.douban.com/subject/34874432/');
    assert.match(upgraded.douban_raw, /34874432/);
  });

  it('番剧不触发 Douban', async () => {
    let called = false;
    const tmdb = makeFakeTmdb({ tvDetail: async () => FAKE_TV_ANIME_BGM });
    const douban = makeFakeDouban({ match: async () => { called = true; return null; } });
    const app = createApp({ db, tmdb, douban });

    const res = await request(app).post('/api/works').send({ tmdb_id: 328609, tmdb_type: 'tv' });
    await waitMs(10);

    assert.equal(res.status, 200);
    assert.equal(called, false);
  });

  it('已存在但仍是 tmdb 的电影，再次 upsert → 自愈重新入队升级', async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const tmdb = makeFakeTmdb({ movieDetail: async () => FAKE_MOVIE2 });
      let calls = 0;
      const douban = makeFakeDouban({
        match: async () => {
          calls++;
          if (calls === 1) throw new Error('browser down');  // 首次升级失败 → 卡在 tmdb
          return {
            douban_id: '34874432', rating: 8.6, votes: 835000, poster_url: null,
            url: 'https://movie.douban.com/subject/34874432/',
            matched_title: '花束般的恋爱', matched_year: 2021,
          };
        },
      });
      const app = createApp({ db, tmdb, douban });

      const first = await request(app).post('/api/works').send({ tmdb_id: 695932, tmdb_type: 'movie' });
      await waitMs(20);  // 首次升级失败落定，作品仍是 tmdb
      assert.equal(db.prepare('SELECT rating_source FROM works WHERE id = ?').get(first.body.id).rating_source, 'tmdb');

      // 再次 upsert 同一作品（如重新加入列表）→ 应触发自愈重试
      const second = await request(app).post('/api/works').send({ tmdb_id: 695932, tmdb_type: 'movie' });
      assert.equal(second.body.id, first.body.id);

      const upgraded = await eventually(() => {
        const row = db.prepare('SELECT rating_source, primary_rating, douban_id FROM works WHERE id = ?').get(first.body.id);
        return row.rating_source === 'douban' ? row : null;
      });
      assert.ok(calls >= 2);
      assert.equal(upgraded.primary_rating, 8.6);
      assert.equal(upgraded.douban_id, '34874432');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('已升级为 douban 的电影，再次 upsert → 不重复入队', async () => {
    const tmdb = makeFakeTmdb({ movieDetail: async () => FAKE_MOVIE2 });
    let calls = 0;
    const douban = makeFakeDouban({
      match: async () => {
        calls++;
        return {
          douban_id: '34874432', rating: 8.6, votes: 835000, poster_url: null,
          url: 'https://movie.douban.com/subject/34874432/', matched_title: 'x', matched_year: 2021,
        };
      },
    });
    const app = createApp({ db, tmdb, douban });

    const first = await request(app).post('/api/works').send({ tmdb_id: 695932, tmdb_type: 'movie' });
    await eventually(() => {
      const row = db.prepare('SELECT rating_source FROM works WHERE id = ?').get(first.body.id);
      return row.rating_source === 'douban' ? row : null;
    });
    assert.equal(calls, 1);

    await request(app).post('/api/works').send({ tmdb_id: 695932, tmdb_type: 'movie' });
    await waitMs(20);
    assert.equal(calls, 1);  // 已是 douban，不再重试
  });

  it('Douban 失败不影响电影添加，保持 TMDB', async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const tmdb = makeFakeTmdb({ movieDetail: async () => FAKE_MOVIE2 });
      const douban = makeFakeDouban({ match: async () => { throw new Error('browser down'); } });
      const app = createApp({ db, tmdb, douban });

      const res = await request(app).post('/api/works').send({ tmdb_id: 695932, tmdb_type: 'movie' });
      await waitMs(10);
      const row = db.prepare('SELECT rating_source, primary_rating FROM works WHERE id = ?').get(res.body.id);

      assert.equal(res.status, 200);
      assert.equal(res.body.rating_source, 'tmdb');
      assert.equal(row.rating_source, 'tmdb');
      assert.equal(row.primary_rating, 8.0);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('skipUpgrade 时电影不触发 Douban，保持 tmdb', async () => {
    let called = false;
    const tmdb = makeFakeTmdb({ movieDetail: async () => FAKE_MOVIE2 });
    const douban = makeFakeDouban({ match: async () => { called = true; return null; } });
    const { upsertWork } = await import('../src/routes/works.js');
    const work = await upsertWork(db, tmdb, makeFakeBangumi(), douban, { tmdb_id: 695932, tmdb_type: 'movie', skipUpgrade: true });
    await waitMs(20);
    assert.equal(work.rating_source, 'tmdb');
    assert.equal(called, false);   // 完全没调豆瓣
  });
});

async function eventually(read: any, timeoutMs = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = read();
    if (value) return value;
    await waitMs(5);
  }
  assert.fail('condition was not met before timeout');
}

function waitMs(ms: any) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
