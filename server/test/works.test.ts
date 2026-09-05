import request from 'supertest';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { makeWorkDetails, sweepStuckBangumi } from '../src/routes/works.js';
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

  it('详情页独立返回前三条豆瓣热评', async () => {
    const reviews = [
      { id: 'r1', author: '甲', content: '第一条', votes: 88, rating: 5 },
      { id: 'r2', author: '乙', content: '第二条', votes: 66, rating: 4 },
      { id: 'r3', author: '丙', content: '第三条', votes: 33, rating: 5 },
    ];
    const douban = makeFakeDouban({
      hotReviews: async (id: string, kind: string, limit: number) => {
        assert.equal(id, '34874432');
        assert.equal(kind, 'movie');
        assert.equal(limit, 3);
        return reviews;
      },
    });
    const app = createApp({ db, tmdb: makeFakeTmdb({ movieDetail: async () => FAKE_MOVIE }), douban });
    const work = (await request(app).post('/api/works').send({ tmdb_id: 695932, tmdb_type: 'movie' })).body;
    db.prepare(`UPDATE works SET douban_id = '34874432', douban_url = 'https://movie.douban.com/subject/34874432/' WHERE id = ?`).run(work.id);

    const res = await request(app).get(`/api/works/${work.id}/hot-reviews`);

    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'douban');
    assert.deepEqual(res.body.reviews, reviews);
  });

  it('动画详情使用 Bangumi 短评且不调用 TMDB 热评', async () => {
    const reviews = [
      { id: 'b1', author: '甲', content: '第一条', rating: 9 },
      { id: 'b2', author: '乙', content: '第二条', rating: 8 },
      { id: 'b3', author: '丙', content: '第三条', rating: 7 },
    ];
    let tmdbReviewCalls = 0;
    const tmdb = makeFakeTmdb({
      tvDetail: async () => FAKE_TV_ANIME,
    });
    Object.defineProperty(tmdb, 'hotReviews', { get: () => { tmdbReviewCalls++; throw new Error('不应读取 TMDB 热评'); } });
    const bangumi = makeFakeBangumi({ hotReviews: async () => reviews });
    const app = createApp({ db, tmdb, bangumi });
    const work = (await request(app).post('/api/works').send({ tmdb_id: 328609, tmdb_type: 'tv' })).body;
    db.prepare('UPDATE works SET bangumi_id = 328609 WHERE id = ?').run(work.id);

    const res = await request(app).get(`/api/works/${work.id}/hot-reviews`);

    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'bangumi');
    assert.deepEqual(res.body.reviews, reviews);
    assert.equal(tmdbReviewCalls, 0);
  });

  it('没有豆瓣或 Bangumi 来源时返回空短评，不回退 TMDB', async () => {
    let tmdbReviewCalls = 0;
    const tmdb = makeFakeTmdb({
      movieDetail: async () => FAKE_MOVIE,
    });
    Object.defineProperty(tmdb, 'hotReviews', { get: () => { tmdbReviewCalls++; throw new Error('不应读取 TMDB 热评'); } });
    const app = createApp({ db, tmdb });
    const work = (await request(app).post('/api/works').send({ tmdb_id: 695932, tmdb_type: 'movie' })).body;

    const res = await request(app).get(`/api/works/${work.id}/hot-reviews`);

    assert.equal(res.status, 200);
    assert.equal(res.body.source, null);
    assert.equal(res.body.source_label, null);
    assert.deepEqual(res.body.reviews, []);
    assert.equal(tmdbReviewCalls, 0);
  });

  it('详情响应抽取背景图、制作信息和上游评分，不暴露原始 JSON', async () => {
    const tmdb = makeFakeTmdb({ movieDetail: async () => ({
      ...FAKE_MOVIE,
      backdrop_path: '/backdrop.jpg',
      release_date: '2022-01-21',
      original_language: 'ja',
      production_countries: [{ name: '日本' }],
      production_companies: [{ name: 'Little More' }],
      credits: { crew: [{ job: 'Director', name: '导演甲' }], cast: [{ name: '演员乙', character: '角色丙' }] },
      vote_average: 8.2,
      vote_count: 100,
    }) });
    const app = createApp({ db, tmdb });
    const created = (await request(app).post('/api/works').send({ tmdb_id: 695932, tmdb_type: 'movie' })).body;
    const res = await request(app).get(`/api/works/${created.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.details.backdrop_url, 'https://image.tmdb.org/t/p/w1280/backdrop.jpg');
    assert.deepEqual(res.body.details.directors, ['导演甲']);
    assert.deepEqual(res.body.details.cast, [{ name: '演员乙', character: '角色丙' }]);
    assert.equal(res.body.details.countries[0], '日本');
    assert.equal(res.body.tmdb_raw, undefined);
  });

  it('双方各自标记同一作品时，详情同时返回双方的评分和短评', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb({ movieDetail: async () => FAKE_MOVIE }) });
    const work = (await request(app).post('/api/works').send({ tmdb_id: 695932, tmdb_type: 'movie' })).body;
    await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=1')
      .send({ work_id: work.id, status: 'watched', rating: 9, comment: '甲的短评' });
    await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=2')
      .send({ work_id: work.id, status: 'watched', rating: 8, comment: '乙的短评' });

    for (const userId of [1, 2]) {
      const detail = await request(app).get(`/api/works/${work.id}`).set('Cookie', `loweve_user_id=${userId}`);
      assert.deepEqual(detail.body.all_marks.map((mark: any) => [mark.user_id, mark.rating, mark.comment]), [
        [1, 9, '甲的短评'], [2, 8, '乙的短评'],
      ]);
    }
  });
});

describe('makeWorkDetails', () => {
  it('缺少原始数据时仍返回可渲染的安全默认值', () => {
    const details = makeWorkDetails({ tmdb_id: 1, tmdb_type: 'movie', imdb_id: null });
    assert.equal(details.backdrop_url, null);
    assert.deepEqual(details.directors, []);
    assert.deepEqual(details.cast, []);
    assert.equal(details.tmdb_url, 'https://www.themoviedb.org/movie/1');
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

  it('Bangumi 匹配会依次尝试 TMDB 原名、中文名和英文 AKA', async () => {
    const searched: string[] = [];
    const tmdb = makeFakeTmdb({ movieDetail: async () => ({
      id: 71883,
      name: '红线',
      original_name: 'レッドライン',
      title: '红线',
      original_title: 'レッドライン',
      release_date: '2009-08-14',
      overview: '...', genres: [{ id: 16, name: '动画' }],
      origin_country: ['JP'], vote_average: 8, vote_count: 10, poster_path: null,
      external_ids: { imdb_id: 'tt1483797' },
      translations: { translations: [{ iso_639_1: 'en', data: { title: 'Redline' } }] },
    }) });
    const bangumi = makeFakeBangumi({ searchAnime: async (keyword: string) => {
      searched.push(keyword);
      return keyword === 'Redline' ? [{
        bangumi_id: 8726, name: 'REDLINE', name_cn: '红线', year: 2009,
        score: 8.7, votes: 1000, poster_url: null,
      }] : [];
    } });
    const { upsertWork } = await import('../src/routes/works.js');
    const work: any = await upsertWork(db, tmdb, bangumi, makeFakeDouban(), { tmdb_id: 71883, tmdb_type: 'movie' });
    assert.equal(work.bangumi_id, 8726);
    assert.deepEqual(searched, ['レッドライン', '红线', 'Redline']);
  });

  it('启动自愈只扫描仍停留 TMDB 的动画，不误触碰非动画', async () => {
    const anime = await (async () => {
      const tmdb = makeFakeTmdb({ tvDetail: async () => FAKE_TV_ANIME });
      return (await import('../src/routes/works.js')).upsertWork(db, tmdb, makeFakeBangumi(), makeFakeDouban(), {
        tmdb_id: 328609, tmdb_type: 'tv', skipUpgrade: true,
      });
    })();
    const nonAnime = await (async () => {
      const tmdb = makeFakeTmdb({ movieDetail: async () => FAKE_MOVIE });
      return (await import('../src/routes/works.js')).upsertWork(db, tmdb, makeFakeBangumi(), makeFakeDouban(), {
        tmdb_id: 695932, tmdb_type: 'movie', skipUpgrade: true,
      });
    })();
    const calls: number[] = [];
    const bangumi = makeFakeBangumi({ searchAnime: async () => {
      calls.push(1);
      return [BGM_HIT];
    } });
    const sweep = sweepStuckBangumi(db, bangumi, { delayMs: 0 });
    await sweep.done;
    assert.ok(sweep.ids.includes(anime.id));
    assert.ok(!sweep.ids.includes(nonAnime.id));
    assert.equal(db.prepare('SELECT rating_source FROM works WHERE id = ?').get(anime.id).rating_source, 'bangumi');
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

describe('upsertWork 分季', () => {
  const FAKE_TV_ST = {
    id: 66732, name: '怪奇物语', original_name: 'Stranger Things',
    first_air_date: '2016-07-15', overview: '...', genres: [], episode_run_time: [50],
    origin_country: ['US'], vote_average: 8.6, vote_count: 100, poster_path: '/st.jpg',
    external_ids: { imdb_id: null }, seasons: [],
  };

  it('同剧第1季与第4季各自独立入库、标题带「第N季」、用季首播年', async () => {
    const db = makeTestDb();
    const tmdb = makeFakeTmdb({
      tvDetail: async () => FAKE_TV_ST,
      tvSeasonDetail: async (_id: any, n: any) => ({ name: `第 ${n} 季`, air_date: n === 4 ? '2022-05-27' : '2016-07-15', poster_path: `/s${n}.jpg`, overview: '' }),
    });
    const { upsertWork } = await import('../src/routes/works.js');
    const s1: any = await upsertWork(db, tmdb, makeFakeBangumi(), makeFakeDouban(), { tmdb_id: 66732, tmdb_type: 'tv', season_number: 1, skipUpgrade: true });
    const s4: any = await upsertWork(db, tmdb, makeFakeBangumi(), makeFakeDouban(), { tmdb_id: 66732, tmdb_type: 'tv', season_number: 4, skipUpgrade: true });
    assert.notEqual(s1.id, s4.id);
    assert.equal(s1.season_number, 1);
    assert.match(s4.title, /第四季/);
    assert.equal(s4.year, 2022);
    // 再加同一季 → 复用不新建（身份含季维度）
    const s4b: any = await upsertWork(db, tmdb, makeFakeBangumi(), makeFakeDouban(), { tmdb_id: 66732, tmdb_type: 'tv', season_number: 4, skipUpgrade: true });
    assert.equal(s4b.id, s4.id);
    db.close();
  });

  it('整部（season_number 缺省）与分季并存、互不覆盖', async () => {
    const db = makeTestDb();
    const tmdb = makeFakeTmdb({
      tvDetail: async () => FAKE_TV_ST,
      tvSeasonDetail: async (_id: any, n: any) => ({ name: `第 ${n} 季`, air_date: '2022-05-27', poster_path: null, overview: '' }),
    });
    const { upsertWork } = await import('../src/routes/works.js');
    const whole: any = await upsertWork(db, tmdb, makeFakeBangumi(), makeFakeDouban(), { tmdb_id: 66732, tmdb_type: 'tv', skipUpgrade: true });
    const s4: any = await upsertWork(db, tmdb, makeFakeBangumi(), makeFakeDouban(), { tmdb_id: 66732, tmdb_type: 'tv', season_number: 4, skipUpgrade: true });
    assert.notEqual(whole.id, s4.id);
    assert.equal(whole.season_number, null);
    assert.equal(whole.title, '怪奇物语');       // 整部不带季后缀
    db.close();
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
