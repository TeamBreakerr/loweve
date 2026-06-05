import assert from 'node:assert/strict';
import { mapMovie, mapTv, isAnime } from '../src/tmdb/mapper.js';
import { createTmdbClient } from '../src/tmdb/client.js';

describe('isAnime', () => {
  it('动画+JP=1', () => {
    assert.equal(isAnime({ genres: [{id:16}], origin_country: ['JP'] }), 1);
  });
  it('动画+US=0（origin 不在亚洲）', () => {
    assert.equal(isAnime({ genres: [{id:16}], origin_country: ['US'] }), 0);
  });
  it('剧情+JP=0（genre 不是动画）', () => {
    assert.equal(isAnime({ genres: [{id:18}], origin_country: ['JP'] }), 0);
  });
  it('无 genres 字段=0', () => {
    assert.equal(isAnime({}), 0);
  });
});

describe('mapMovie', () => {
  const tmdbPayload = {
    id: 695932,
    title: '花束般的恋爱',
    original_title: '花束みたいな恋をした',
    release_date: '2022-01-21',
    overview: '从东京车站偶遇开始……',
    genres: [{id:18, name:'剧情'}, {id:10749, name:'爱情'}],
    runtime: 124,
    origin_country: ['JP'],
    vote_average: 8.2,
    vote_count: 1234,
    poster_path: '/abc.jpg',
    external_ids: { imdb_id: 'tt12345' },
  };

  it('映射核心字段', () => {
    const m = mapMovie(tmdbPayload);
    assert.equal(m.tmdb_id, 695932);
    assert.equal(m.tmdb_type, 'movie');
    assert.equal(m.title, '花束般的恋爱');
    assert.equal(m.original_title, '花束みたいな恋をした');
    assert.equal(m.year, 2022);
    assert.equal(m.runtime, 124);
    assert.equal(m.is_anime, 0);  // 剧情非动画
    assert.equal(m.primary_rating, 8.2);
    assert.equal(m.primary_rating_count, 1234);
    assert.equal(m.primary_poster_url, 'https://image.tmdb.org/t/p/w500/abc.jpg');
    assert.equal(m.rating_source, 'tmdb');
    assert.equal(m.imdb_id, 'tt12345');
    assert.deepEqual(JSON.parse(m.genres), ['剧情','爱情']);
    assert.equal(JSON.parse(m.tmdb_raw).id, 695932);
  });

  it('release_date 缺失 → year=null', () => {
    const m = mapMovie({ ...tmdbPayload, release_date: '' });
    assert.equal(m.year, null);
  });

  it('poster_path 缺失 → primary_poster_url=null', () => {
    const m = mapMovie({ ...tmdbPayload, poster_path: null });
    assert.equal(m.primary_poster_url, null);
  });
});

describe('mapTv', () => {
  it('tv 字段映射 + runtime 取首集时长', () => {
    const p = {
      id: 100, name: '孤独摇滚！', original_name: 'ぼっち・ざ・ろっく！',
      first_air_date: '2022-10-08', overview: '...',
      genres: [{id:16, name:'动画'}], episode_run_time: [23, 24],
      origin_country: ['JP'], vote_average: 8.4, vote_count: 500,
      poster_path: '/x.jpg',
    };
    const m = mapTv(p);
    assert.equal(m.tmdb_type, 'tv');
    assert.equal(m.year, 2022);
    assert.equal(m.runtime, 23);
    assert.equal(m.is_anime, 1);
    assert.equal(m.title, '孤独摇滚！');
  });
});

describe('createTmdbClient', () => {
  it('isConfigured: 无 token 无 key → false', () => {
    const c = createTmdbClient({ token: null, key: null, fetch: async () => {} });
    assert.equal(c.isConfigured(), false);
  });

  it('isConfigured: 有 token → true', () => {
    const c = createTmdbClient({ token: 'X', key: null, fetch: async () => {} });
    assert.equal(c.isConfigured(), true);
  });

  // 按路径分发的 fakeFetch：search 现在并行打 movie/tv/person（+ 可能 person credits）
  function routedFetch(routes: any) {
    return async (url: any) => {
      for (const [frag, payload] of Object.entries(routes)) {
        if (url.includes(frag)) return { ok: true, status: 200, json: async () => payload };
      }
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    };
  }

  it('search: v4 Bearer 优先 + include_adult + 合并 movie/tv', async () => {
    const seen: any[] = [];
    const fakeFetch = async (url: any, opts: any) => {
      seen.push({ url, auth: opts.headers.Authorization });
      const payload = url.includes('/search/movie')
        ? { results: [{ id: 1, title: 'A', release_date: '2020-01-01', poster_path: '/a.jpg', vote_average: 7, popularity: 9 }] }
        : url.includes('/search/tv')
        ? { results: [{ id: 3, name: 'B', first_air_date: '2021-01-01', vote_average: 8, popularity: 3 }] }
        : { results: [] };
      return { ok: true, status: 200, json: async () => payload };
    };
    const c = createTmdbClient({ token: 'TOK', key: 'KEY', fetch: fakeFetch });
    const r = await c.search('花束');
    // 每个 search 请求都带 Bearer + include_adult + 中文 + url-encoded query
    assert.ok(seen.every(s => s.auth === 'Bearer TOK'));
    assert.ok(seen.some(s => s.url.includes('/search/movie') && s.url.includes('include_adult=true') && s.url.includes('language=zh-CN') && s.url.includes('query=%E8%8A%B1%E6%9D%9F')));
    assert.ok(seen.some(s => s.url.includes('/search/tv')));
    assert.ok(seen.some(s => s.url.includes('/search/person')));
    // movie(pop9) 在 tv(pop3) 前；popularity 内部字段不外泄
    assert.equal(r.results.length, 2);
    assert.equal(r.results[0].tmdb_id, 1);
    assert.equal(r.results[0].tmdb_type, 'movie');
    assert.equal(r.results[1].tmdb_type, 'tv');
    assert.equal(r.results[0].popularity, undefined);
  });

  it('search: 无 token 有 key → v3 query string', async () => {
    let captured: any;
    const fakeFetch = async (url: any, opts: any) => {
      captured = { url, opts };
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    };
    const c = createTmdbClient({ token: null, key: 'KEY3', fetch: fakeFetch });
    await c.search('x');
    assert.match(captured.url, /api_key=KEY3/);
    assert.equal(captured.opts.headers?.Authorization, undefined);
  });

  it('5xx 重试 3 次后抛错（movieDetail 单请求）', async () => {
    let calls = 0;
    const fakeFetch = async () => { calls++; return { ok: false, status: 500, json: async () => ({}) }; };
    const c = createTmdbClient({ token: 'T', key: null, fetch: fakeFetch, retryDelays: [1,1,1] });
    await assert.rejects(() => c.movieDetail(1), /tmdb_upstream/);
    assert.equal(calls, 4);  // 1 + 3 retries
  });

  it('4xx 不重试直接抛错（movieDetail 单请求）', async () => {
    let calls = 0;
    const fakeFetch = async () => { calls++; return { ok: false, status: 401, json: async () => ({ status_message: 'auth' }) }; };
    const c = createTmdbClient({ token: 'T', key: null, fetch: fakeFetch });
    await assert.rejects(() => c.movieDetail(1));
    assert.equal(calls, 1);
  });

  it('search: 人物命中 → 拉 combined_credits 补充导演/主演作品（标 via）', async () => {
    const fakeFetch = routedFetch({
      '/search/movie': { results: [{ id: 1, title: '恋之罪', release_date: '2011-01-01', vote_average: 7, popularity: 5 }] },
      '/search/tv': { results: [] },
      '/search/person': { results: [{ id: 67075, name: '园子温' }] },
      '/person/67075/combined_credits': {
        crew: [{ id: 99, media_type: 'movie', title: '冰冷热带鱼', job: 'Director', release_date: '2010-01-01', popularity: 4 }],
        cast: [{ id: 1, media_type: 'movie', title: '恋之罪', job: 'Actor', release_date: '2011-01-01', popularity: 5 }],
      },
    });
    const c = createTmdbClient({ token: 'T', key: null, fetch: fakeFetch });
    const r = await c.search('园子温');
    // 标题命中(恋之罪 id1) 在前；导演作品 冰冷热带鱼 id99 被补充且标 via；id1 不重复
    const ids = r.results.map(x => x.tmdb_id);
    assert.ok(ids.includes(1));
    assert.ok(ids.includes(99));
    assert.equal(ids.filter(x => x === 1).length, 1);  // 去重
    const director = r.results.find(x => x.tmdb_id === 99);
    assert.equal(director.via, '导演 园子温');
  });

  it('search: 人物 credits 拉取失败 → 不影响标题结果', async () => {
    const fakeFetch = async (url: any) => {
      if (url.includes('/combined_credits')) return { ok: false, status: 500, json: async () => ({}) };
      const payload = url.includes('/search/movie')
        ? { results: [{ id: 1, title: 'A', release_date: '2020-01-01', vote_average: 7, popularity: 1 }] }
        : url.includes('/search/person')
        ? { results: [{ id: 5, name: 'X' }] }
        : { results: [] };
      return { ok: true, status: 200, json: async () => payload };
    };
    const c = createTmdbClient({ token: 'T', key: null, fetch: fakeFetch, retryDelays: [1, 1, 1] });
    const r = await c.search('x');
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].tmdb_id, 1);
  });

  it('movieDetail / tvDetail 走对应 endpoint', async () => {
    const seen: any[] = [];
    const fakeFetch = async (url: any) => {
      seen.push(url);
      return { ok: true, status: 200, json: async () => ({ id: 1, title: 't', genres: [] }) };
    };
    const c = createTmdbClient({ token: 'T', key: null, fetch: fakeFetch });
    await c.movieDetail(123);
    await c.tvDetail(456);
    assert.ok(seen[0].includes('/movie/123'));
    assert.ok(seen[0].includes('append_to_response=external_ids'));
    assert.ok(seen[1].includes('/tv/456'));
  });
});
