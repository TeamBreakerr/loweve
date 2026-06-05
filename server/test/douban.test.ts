import assert from 'node:assert/strict';
import { createDoubanClient, DoubanError } from '../src/douban/client.js';
import { enqueueDoubanUpgrade, resetDoubanQueueForTests, upgradeWithDouban, sweepStuckDouban } from '../src/douban/queue.js';
import { makeFakeDouban, makeTestDb } from './helpers.js';

describe('createDoubanClient (HTTP)', () => {
  const ok = (json: any) => ({ ok: true, status: 200, json: async () => json });
  const routed = (map: any) => async (url: any) => {
    for (const key of Object.keys(map)) if (url.includes(key)) return map[key];
    throw new Error('unexpected fetch ' + url);
  };

  it('subject_suggest 搜索 → rexxar 拿评分 → 标准结构', async () => {
    const fetch = routed({
      'subject_suggest': ok([{ id: '26384741', title: '湮灭', year: '2018', type: 'movie', sub_title: 'Annihilation' }]),
      'rexxar/api/v2/movie/26384741': ok({ rating: { value: 7.2, count: 390419 }, title: '湮灭' }),
    });
    const r: any = await createDoubanClient({ fetch }).match({ title: '湮灭', year: 2018 });
    assert.equal(r.douban_id, '26384741');
    assert.equal(r.rating, 7.2);
    assert.equal(r.votes, 390419);
    assert.match(r.url, /subject\/26384741/);
  });

  it('豆瓣年份与 TMDB 差 1 仍匹配', async () => {
    const fetch = routed({
      'subject_suggest': ok([{ id: '35597426', title: '稍微想起一些', year: '2021', type: 'movie' }]),
      'rexxar': ok({ rating: { value: 7.7, count: 40498 } }),
    });
    const r: any = await createDoubanClient({ fetch }).match({ title: '稍微想起一些', year: 2022 });
    assert.equal(r.douban_id, '35597426');
    assert.equal(r.rating, 7.7);
  });

  it('搜索无结果 → null', async () => {
    const fetch = routed({ 'subject_suggest': ok([]) });
    assert.equal(await createDoubanClient({ fetch }).match({ title: '查无此片', year: 2020 }), null);
  });

  it('全名搜不到 → 退成"片名 年份"再搜（特别篇等冗长标题）', async () => {
    const queries: any[] = [];
    const fetch = async (url: any) => {
      if (url.includes('subject_suggest')) {
        const q = decodeURIComponent(new URL(url).searchParams.get('q') || '');
        queries.push(q);
        if (q === '世界奇妙物语2022年夏之特别篇') return ok([]);                 // 全名搜不到
        if (q === '世界奇妙物语 2022') return ok([{ id: '35914301', title: '世界奇妙物语 2022夏季特别篇', year: '2022', type: 'movie' }]);
        return ok([]);
      }
      if (url.includes('rexxar')) return ok({ rating: { value: 7.5, count: 1000 } });
      throw new Error('unexpected ' + url);
    };
    const r: any = await createDoubanClient({ fetch }).match({ title: '世界奇妙物语2022年夏之特别篇', year: 2022 });
    assert.equal(r.douban_id, '35914301');
    assert.deepEqual(queries, ['世界奇妙物语2022年夏之特别篇', '世界奇妙物语 2022']);  // 退化查询触发
  });

  it('标题完全对不上 → null（不错配同名）', async () => {
    const fetch = routed({ 'subject_suggest': ok([{ id: '999', title: '完全不相干', year: '2018', type: 'movie' }]) });
    assert.equal(await createDoubanClient({ fetch }).match({ title: '湮灭', year: 2018 }), null);
  });

  it('豆瓣无有效评分 → null（保持 TMDB）', async () => {
    const fetch = routed({
      'subject_suggest': ok([{ id: '111', title: '未上映片', year: '2026', type: 'movie' }]),
      'rexxar': ok({ rating: { value: 0, count: 0 } }),
    });
    assert.equal(await createDoubanClient({ fetch }).match({ title: '未上映片', year: 2026 }), null);
  });

  it('网络错误抛 DoubanError', async () => {
    const fetch = async () => { throw new Error('ECONNRESET'); };
    await assert.rejects(() => createDoubanClient({ fetch }).match({ title: 'x', year: 2020 }), DoubanError);
  });

  it('上游非 200 抛 DoubanError', async () => {
    const fetch = async () => ({ ok: false, status: 403 });
    await assert.rejects(() => createDoubanClient({ fetch }).match({ title: 'x', year: 2020 }), DoubanError);
  });

  it('timeout 抛 DoubanError', async () => {
    const fetch = async (_url: any, opts: any) => new Promise((_res, rej) =>
      opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    await assert.rejects(() => createDoubanClient({ fetch, timeoutMs: 5 }).match({ title: 'x', year: 2020 }), DoubanError);
  });
});

describe('Douban upgrade queue', () => {
  let db: any;
  beforeEach(() => {
    resetDoubanQueueForTests();
    db = makeTestDb();
  });
  afterEach(() => db.close());

  it('upgradeWithDouban 升级评分/票数/来源/raw，海报保持 TMDB（不抓豆瓣海报）', async () => {
    const work = insertMovie(db, { title: '花束般的恋爱', year: 2021 });
    const douban = makeFakeDouban({
      match: async () => ({
        douban_id: '34874432',
        rating: 8.6,
        votes: 835000,
        poster_url: 'https://img/p.jpg',   // 豆瓣返回海报但我们忽略
        url: 'https://movie.douban.com/subject/34874432/',
        matched_title: '花束般的恋爱 花束みたいな恋をした (2021)',
        matched_year: 2021,
      }),
    });

    const updated = await upgradeWithDouban(db, douban, work);

    assert.equal(updated.rating_source, 'douban');
    assert.equal(updated.primary_rating, 8.6);
    assert.equal(updated.primary_rating_count, 835000);
    assert.equal(updated.primary_poster_url, 'https://image.tmdb.org/t/p/w500/movie.jpg');  // TMDB 海报不变
    assert.equal(updated.douban_id, '34874432');
    assert.equal(updated.douban_url, 'https://movie.douban.com/subject/34874432/');
    assert.match(updated.douban_raw, /34874432/);
  });

  it('upgradeWithDouban keeps TMDB values when no match is found', async () => {
    const work = insertMovie(db, { title: '冷门电影', year: 2021 });
    const updated = await upgradeWithDouban(db, makeFakeDouban(), work);

    assert.equal(updated.rating_source, 'tmdb');
    assert.equal(updated.primary_rating, 8.0);
    assert.equal(updated.primary_poster_url, 'https://image.tmdb.org/t/p/w500/movie.jpg');
  });

  it('upgradeWithDouban retries once when the first match returns null', async () => {
    const work = insertMovie(db, { title: '爱的曝光', year: 2008 });
    let calls = 0;
    const douban = makeFakeDouban({
      match: async () => {
        calls++;
        if (calls === 1) return null;
        return {
          douban_id: '2361266',
          rating: 8.3,
          votes: 59885,
          poster_url: null,
          url: 'https://movie.douban.com/subject/2361266/',
          matched_title: '爱的曝光 愛のむきだし (2008)',
          matched_year: 2008,
        };
      },
    });

    const updated = await upgradeWithDouban(db, douban, work);

    assert.equal(calls, 2);
    assert.equal(updated.rating_source, 'douban');
    assert.equal(updated.douban_id, '2361266');
    assert.equal(updated.primary_rating, 8.3);
  });

  it('enqueueDoubanUpgrade catches failures and leaves row unchanged', async () => {
    const work = insertMovie(db, { title: '花束般的恋爱', year: 2021 });
    const douban = makeFakeDouban({ match: async () => { throw new Error('browser down'); } });

    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await enqueueDoubanUpgrade(db, douban, work.id);
    } finally {
      console.warn = originalWarn;
    }
    const row = getWork(db, work.id);

    assert.equal(row.rating_source, 'tmdb');
    assert.equal(row.primary_rating, 8.0);
  });

  it('enqueueDoubanUpgrade runs jobs serially', async () => {
    const first = insertMovie(db, { tmdb_id: 1, title: '第一部', year: 2020 });
    const second = insertMovie(db, { tmdb_id: 2, title: '第二部', year: 2021 });
    let releaseFirst: any;
    const events: any[] = [];
    const douban = makeFakeDouban({
      match: async ({ title }: any) => {
        events.push(`start:${title}`);
        if (title === '第一部') await new Promise(resolve => { releaseFirst = resolve; });
        events.push(`end:${title}`);
        return {
          douban_id: title === '第一部' ? 'first' : 'second',
          rating: 8.0,
          votes: 1,
          poster_url: null,
          url: `https://movie.douban.com/subject/${title === '第一部' ? 'first' : 'second'}/`,
        };
      },
    });

    const p1 = enqueueDoubanUpgrade(db, douban, first.id);
    const p2 = enqueueDoubanUpgrade(db, douban, second.id);
    await Promise.resolve();
    assert.deepEqual(events, ['start:第一部']);

    releaseFirst();
    await Promise.all([p1, p2]);

    assert.deepEqual(events, ['start:第一部', 'end:第一部', 'start:第二部', 'end:第二部']);
  });

  it('sweepStuckDouban 覆盖非动画电影+剧集，排除动画', () => {
    const mv = insertMovie(db, { tmdb_id: 1, title: '某电影', tmdb_type: 'movie', is_anime: 0 });
    const tv = insertMovie(db, { tmdb_id: 2, title: '黑镜', tmdb_type: 'tv', is_anime: 0 });
    const anime = insertMovie(db, { tmdb_id: 3, title: '某番剧', tmdb_type: 'tv', is_anime: 1 });
    const ids = sweepStuckDouban(db, makeFakeDouban());
    assert.ok(ids.includes(mv.id), '电影应补');
    assert.ok(ids.includes(tv.id), '非动画剧集也应补');
    assert.ok(!ids.includes(anime.id), '动画不补豆瓣');
  });
});

function insertMovie(db: any, overrides: any = {}) {
  const now = Date.now();
  const row = {
    tmdb_id: overrides.tmdb_id ?? 695932,
    tmdb_type: overrides.tmdb_type ?? 'movie',
    title: overrides.title ?? '花束般的恋爱',
    original_title: overrides.original_title ?? '花束みたいな恋をした',
    year: overrides.year ?? 2021,
    overview: '',
    genres: '剧情',
    runtime: 124,
    is_anime: overrides.is_anime ?? 0,
    primary_rating: 8.0,
    primary_rating_count: 50,
    primary_poster_url: 'https://image.tmdb.org/t/p/w500/movie.jpg',
    rating_source: 'tmdb',
    bangumi_id: null,
    douban_id: null,
    douban_url: null,
    imdb_id: 'tt1',
    tmdb_raw: '{}',
    bangumi_raw: null,
    douban_raw: null,
    fetched_at: now,
    updated_at: now,
  };
  const info = db.prepare(`
    INSERT INTO works (
      tmdb_id, tmdb_type, title, original_title, year, overview, genres, runtime,
      is_anime, primary_rating, primary_rating_count, primary_poster_url, rating_source,
      bangumi_id, douban_id, douban_url, imdb_id, tmdb_raw, bangumi_raw, douban_raw,
      fetched_at, updated_at
    ) VALUES (
      @tmdb_id, @tmdb_type, @title, @original_title, @year, @overview, @genres, @runtime,
      @is_anime, @primary_rating, @primary_rating_count, @primary_poster_url, @rating_source,
      @bangumi_id, @douban_id, @douban_url, @imdb_id, @tmdb_raw, @bangumi_raw, @douban_raw,
      @fetched_at, @updated_at
    )
  `).run(row);
  return getWork(db, info.lastInsertRowid);
}

function getWork(db: any, id: any) {
  return db.prepare(`SELECT
    id, tmdb_id, tmdb_type, title, original_title, year, overview, genres, runtime, is_anime,
    primary_rating, primary_rating_count, primary_poster_url, rating_source,
    bangumi_id, douban_id, douban_url, imdb_id, fetched_at, updated_at, douban_raw
    FROM works WHERE id = ?`).get(id);
}
