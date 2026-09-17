// 榜单添加：豆瓣 Top250 / Bangumi 动画排行 → 带本地状态的榜单页 + 条目解析成 TMDB 候选
import request from 'supertest';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { makeTestDb, makeFakeTmdb, makeFakeBangumi, makeFakeDouban, makeFakeLlm } from './helpers.js';
import { getState } from '../src/recos/state.js';

const doubanItems = (start: number, n: number) => ({
  total: 250,
  items: Array.from({ length: n }, (_, i) => ({
    douban_id: String(1000 + start + i), title: `豆瓣片${start + i + 1}`, year: 1994 + i, kind: 'movie',
    rank: start + i + 1, score: 9.7 - i * 0.1, votes: 100000 - i, poster_url: `https://img.douban/${start + i}.jpg`,
    subtitle: `${1994 + i} / 美国 / 剧情`, url: `https://movie.douban.com/subject/${1000 + start + i}/`,
  })),
});
const bangumiItems = (offset: number, n: number) => ({
  total: 1000,
  items: Array.from({ length: n }, (_, i) => ({
    bangumi_id: 500 + offset + i, name: `Anime ${offset + i + 1}`, name_cn: `番${offset + i + 1}`, year: 2010 + i,
    score: 9.2, votes: 10000, poster_url: `https://lain.bgm.tv/${offset + i}.jpg`,
    rank: i === 0 ? null : offset + i + 1, platform: i === 1 ? '剧场版' : 'TV', url: `https://bgm.tv/subject/${500 + offset + i}`,
  })),
});

function setup({ douban = {}, bangumi = {}, tmdb = {} }: any = {}) {
  const db = makeTestDb();
  const app = createApp({
    db,
    tmdb: makeFakeTmdb(tmdb),
    bangumi: makeFakeBangumi(bangumi),
    douban: makeFakeDouban(douban),
    llm: makeFakeLlm(),
  });
  return { db, app };
}

// 直接插一条 work（不经 TMDB）
function insertWork(db: any, { tmdb_id, title, year, douban_id = null, bangumi_id = null, tmdb_type = 'movie' }: any) {
  const now = Date.now();
  return db.prepare(`INSERT INTO works (tmdb_id, tmdb_type, title, year, is_anime, rating_source, douban_id, bangumi_id, tmdb_raw, fetched_at, updated_at)
    VALUES (?, ?, ?, ?, 0, 'tmdb', ?, ?, '{}', ?, ?)`).run(tmdb_id, tmdb_type, title, year, douban_id, bangumi_id, now, now).lastInsertRowid;
}

describe('charts', () => {
  it('GET /api/charts 列出可用榜单', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/charts');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.charts.map((c: any) => c.key), ['douban_top250', 'bangumi_anime']);
  });

  it('豆瓣 Top250：分页取条目，并按 douban_id / 标题+年份 标注我看过、一起看过、想看', async () => {
    const calls: any[] = [];
    const { db, app } = setup({ douban: { collectionItems: async (coll: string, opts: any) => { calls.push([coll, opts]); return doubanItems(opts.start, 3); } } });
    const now = Date.now();
    // 第 2 页从 start=50 起：条目 51/52 对应 douban_id 1050/1051
    const w1 = insertWork(db, { tmdb_id: 11, title: '豆瓣片51', year: 1994, douban_id: '1050' });   // 按 douban_id 对上
    const w2 = insertWork(db, { tmdb_id: 12, title: '豆瓣片52', year: 1995 });                       // 没有 douban_id，按标题+年份兜底
    db.prepare(`INSERT INTO user_marks (user_id, work_id, status, marked_at) VALUES (1, ?, 'watched', ?)`).run(w1, now);
    db.prepare(`INSERT INTO couple_sessions (work_id, watched_at, created_at) VALUES (?, 20260101, ?)`).run(w2, now);
    db.prepare(`INSERT INTO plan_items (work_id, added_by, priority, status, created_at, updated_at) VALUES (?, 1, 0, 'pending', ?, ?)`).run(w1, now, now);

    const res = await request(app).get('/api/charts/douban_top250?page=2').set('Cookie', 'loweve_user_id=1');
    assert.equal(res.status, 200);
    assert.deepEqual(calls, [['movie_top250', { start: 50, count: 50 }]]);
    assert.equal(res.body.label, '豆瓣电影 Top250');
    assert.equal(res.body.total, 250);
    assert.equal(res.body.has_more, true);
    const [a, b, c] = res.body.items;
    assert.equal(a.source, 'douban');
    assert.equal(a.rank, 51);
    assert.equal(a.work_id, w1);
    assert.deepEqual([a.mine, a.couple, a.plan], [true, false, true]);
    assert.equal(b.work_id, w2);
    assert.deepEqual([b.mine, b.couple, b.plan], [false, true, false]);
    assert.equal(c.work_id, null);
    assert.deepEqual([c.mine, c.couple, c.plan], [false, false, false]);

    // 换个视角用户：mine 随视角变化
    const other = await request(app).get('/api/charts/douban_top250?page=2').set('Cookie', 'loweve_user_id=2');
    assert.equal(other.body.items[0].mine, false);
    assert.equal(calls.length, 1, '第二次读同一页走缓存，不再请求豆瓣');
  });

  it('Bangumi 动画排行：rank 缺失按 offset 补，剧场版归电影，中文名优先', async () => {
    const { app } = setup({ bangumi: { rankAnime: async ({ offset }: any) => bangumiItems(offset, 3) } });
    const res = await request(app).get('/api/charts/bangumi_anime?page=3');
    assert.equal(res.status, 200);
    assert.equal(res.body.page_size, 20);
    const [a, b] = res.body.items;
    assert.equal(a.source, 'bangumi');
    assert.equal(a.source_id, '540');
    assert.equal(a.rank, 41);                 // offset 40 + 1
    assert.equal(a.title, '番41');
    assert.equal(a.original_title, 'Anime 41');
    assert.equal(a.kind, 'tv');
    assert.equal(b.kind, 'movie');            // 剧场版
    assert.equal(b.subtitle, '剧场版');
  });

  it('上游失败：有过期缓存则回落旧数据，否则 502', async () => {
    let fail = false;
    const { db, app } = setup({ douban: { collectionItems: async (_c: string, opts: any) => { if (fail) throw Object.assign(new Error('boom'), { code: 'douban_upstream' }); return doubanItems(opts.start, 2); } } });
    assert.equal((await request(app).get('/api/charts/douban_top250')).status, 200);
    // 把缓存改成过期
    const key = 'chart:douban_top250:1';
    const cached = JSON.parse(getState(db, key));
    db.prepare('UPDATE app_state SET value = ? WHERE key = ?').run(JSON.stringify({ ...cached, fetched_at: 0 }), key);
    fail = true;
    const stale = await request(app).get('/api/charts/douban_top250');
    assert.equal(stale.status, 200);
    assert.equal(stale.body.items.length, 2);
    const none = await request(app).get('/api/charts/douban_top250?page=4');
    assert.equal(none.status, 502);
    assert.equal(none.body.error, 'douban_upstream');
  });

  it('未知榜单 → 404', async () => {
    const { app } = setup();
    assert.equal((await request(app).get('/api/charts/imdb_top')).status, 404);
  });

  it('resolve：已在库按来源 id 直接返回本地作品', async () => {
    const { db, app } = setup();
    insertWork(db, { tmdb_id: 603, title: '黑客帝国', year: 1999, douban_id: '1291843' });
    const res = await request(app).post('/api/charts/resolve').send({ source: 'douban', source_id: '1291843', title: '黑客帝国', year: 1999, kind: 'movie' });
    assert.equal(res.status, 200);
    assert.equal(res.body.candidate.tmdb_id, 603);
    assert.equal(res.body.candidate.tmdb_type, 'movie');
    assert.equal(res.body.candidate.via, '已在库');
  });

  it('resolve：不在库走 TMDB 搜索择优；中文名搜不到用原名兜底；都没有 → 404', async () => {
    const searches: string[] = [];
    const { app } = setup({ tmdb: { search: async (q: string) => {
      searches.push(q);
      if (q === '黑客帝国') return { results: [{ tmdb_id: 603, tmdb_type: 'movie', title: '黑客帝国', original_title: 'The Matrix', year: 1999, poster_path: '/m.jpg' }, { tmdb_id: 604, tmdb_type: 'movie', title: '黑客帝国2', original_title: 'The Matrix Reloaded', year: 2003, poster_path: '/m2.jpg' }] };
      if (q === 'Cowboy Bebop') return { results: [{ tmdb_id: 30991, tmdb_type: 'tv', title: '星际牛仔', original_title: 'Cowboy Bebop', year: 1998, poster_path: '/cb.jpg' }] };
      // 番剧某季：同名总集篇剧场版标题更像、但类型不对 → 应选同类型的剧集
      if (q === '攻壳机动队 S.A.C. 2nd GIG') return { results: [
        { tmdb_id: 111224, tmdb_type: 'movie', title: '攻壳机动队SAC 2nd GIG：个别的十一人', original_title: 'Individual Eleven', year: 2006, poster_path: '/m.jpg' },
        { tmdb_id: 9, tmdb_type: 'tv', title: '攻壳机动队 S.A.C.', original_title: 'Ghost in the Shell: SAC', year: 2002, poster_path: '/tv.jpg' },
      ] };
      return { results: [] };
    } } });
    const movie = await request(app).post('/api/charts/resolve').send({ source: 'douban', source_id: '1', title: '黑客帝国', year: 1999, kind: 'movie' });
    assert.equal(movie.status, 200);
    assert.equal(movie.body.candidate.tmdb_id, 603);
    assert.equal(movie.body.candidate.poster_path, '/m.jpg');
    assert.equal(movie.body.candidate.via, '豆瓣榜单');

    const anime = await request(app).post('/api/charts/resolve').send({ source: 'bangumi', source_id: '253', title: '星际牛仔（找不到的名字）', original_title: 'Cowboy Bebop', year: 1998, kind: 'tv' });
    assert.equal(anime.status, 200);
    assert.equal(anime.body.candidate.tmdb_id, 30991);
    assert.equal(anime.body.candidate.via, 'Bangumi 榜单');

    const season = await request(app).post('/api/charts/resolve').send({ source: 'bangumi', source_id: '326', title: '攻壳机动队 S.A.C. 2nd GIG', year: 2004, kind: 'tv' });
    assert.equal(season.status, 200);
    assert.equal(season.body.candidate.tmdb_type, 'tv');
    assert.equal(season.body.candidate.tmdb_id, 9);

    const none = await request(app).post('/api/charts/resolve').send({ source: 'douban', source_id: '2', title: '不存在', year: 2000, kind: 'movie' });
    assert.equal(none.status, 404);
    assert.equal(none.body.error, 'tmdb_not_found');

    assert.equal((await request(app).post('/api/charts/resolve').send({})).status, 400);
  });
});
