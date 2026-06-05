// server/test/recos-service.test.js
import assert from 'node:assert/strict';
import { makeTestDb, makeFakeTmdb, makeFakeBangumi, makeFakeDouban, makeFakeLlm } from './helpers.js';
import { generateStanding, getCurrentRecos, gatherContext } from '../src/recos/service.js';
import { markRecosStale, isRecosStale, getStandingBatchId } from '../src/recos/state.js';

const FAKE_MOVIE = (id: any) => ({
  id, title: `片${id}`, original_title: `Movie ${id}`, release_date: '2020-01-01',
  overview: '', genres: [{ id: 18, name: '剧情' }], runtime: 100, origin_country: ['US'],
  vote_average: 8.0, vote_count: 100, poster_path: `/p${id}.jpg`, external_ids: { imdb_id: null },
});

// 两条推荐都能在 TMDB 命中
function deps({ chat }: any = {}) {
  return {
    llm: makeFakeLlm({ chat: chat ?? (async () => JSON.stringify([
      { title: '片101', year: 2020, type: 'movie', is_anime: false, reason: '你们都爱剧情片' },
      { title: '片102', year: 2020, type: 'movie', is_anime: false, reason: '导演同款' },
    ])) }),
    tmdb: makeFakeTmdb({
      search: async (q: any) => ({ results: [{
        tmdb_id: q === '片101' ? 101 : 102, tmdb_type: 'movie',
        title: q, original_title: q, year: 2020,
      }] }),
      movieDetail: async (id: any) => FAKE_MOVIE(id),
    }),
    bangumi: makeFakeBangumi(),
    douban: {},   // 推荐不再 skipUpgrade；这里用无 match 的 douban，避免电影异步入队污染测试
  };
}

describe('recos/service', () => {
  let db: any;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('generateStanding 落库 validated 行 + 建 works + 清 stale', async () => {
    markRecosStale(db);
    const out = await generateStanding(db, deps(), {});
    assert.equal(out.rec_type, 'standing');
    assert.equal(out.items.length, 2);
    assert.equal(out.items[0].title, '片101');
    assert.ok(out.items[0].work_id);
    assert.equal(out.items[0].rating_source, 'tmdb');
    assert.equal(isRecosStale(db), false);
    assert.equal(getStandingBatchId(db), out.batch_id);
  });

  it('番剧推荐生成时同步升级 Bangumi（不再停留 tmdb）', async () => {
    const llm = makeFakeLlm({ chat: async () => JSON.stringify([{ title: '孤独摇滚', year: 2022, type: 'tv', is_anime: true, reason: 'r' }]) });
    const tmdb = makeFakeTmdb({
      search: async () => ({ results: [{ tmdb_id: 328609, tmdb_type: 'tv', title: '孤独摇滚！', original_title: 'ぼっち・ざ・ろっく！', year: 2022 }] }),
      tvDetail: async () => ({ id: 328609, name: '孤独摇滚！', original_name: 'ぼっち・ざ・ろっく！', first_air_date: '2022-10-08', overview: '', genres: [{ id: 16, name: '动画' }], episode_run_time: [23], origin_country: ['JP'], vote_average: 7.9, vote_count: 100, poster_path: '/t.jpg', external_ids: { imdb_id: null } }),
    });
    const bangumi = makeFakeBangumi({ searchAnime: async () => [{ bangumi_id: 328609, name: 'ぼっち・ざ・ろっく！', name_cn: '孤独摇滚！', year: 2022, score: 8.4, votes: 39589, poster_url: 'https://lain.bgm.tv/x.jpg' }] });
    const out = await generateStanding(db, { llm, tmdb, bangumi, douban: {} }, {});
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0].rating_source, 'bangumi');
    assert.equal(out.items[0].primary_rating, 8.4);
  });

  it('getCurrentRecos：空→生成；缓存→秒回不重生；stale→重生', async () => {
    let chatCalls = 0;
    const d = deps({ chat: async () => { chatCalls++; return JSON.stringify([
      { title: '片101', year: 2020, type: 'movie', reason: 'r' }]); } });
    const r1 = await getCurrentRecos(db, d);     // 空 → 生成
    assert.equal(chatCalls, 1);
    assert.equal(r1.items.length, 1);
    const r2 = await getCurrentRecos(db, d);     // 缓存 → 不重生
    assert.equal(chatCalls, 1);
    assert.equal(r2.batch_id, r1.batch_id);
    markRecosStale(db);
    await getCurrentRecos(db, d);                // stale → 重生
    assert.equal(chatCalls, 2);
  });

  it('LLM 失败：有旧批次回落旧批次不抛', async () => {
    await generateStanding(db, deps(), {});       // 先有一批
    const oldBatch = getStandingBatchId(db);
    markRecosStale(db);
    const bad = deps({ chat: async () => { throw new Error('llm down'); } });
    const r = await getCurrentRecos(db, bad);
    assert.equal(r.error, 'llm_unavailable');
    assert.equal(r.batch_id, oldBatch);           // 回落
    assert.ok(r.items.length >= 1);
  });

  it('已知作品（已在列表）不重复推荐', async () => {
    // 先把 work 101 加入 plan，使其进入 knownKeys
    const d = deps();
    const w = await (await import('../src/routes/works.js')).upsertWork(db, d.tmdb, d.bangumi, d.douban, { tmdb_id: 101, tmdb_type: 'movie', skipUpgrade: true });
    db.prepare(`INSERT INTO plan_items (work_id, added_by, priority, status, created_at, updated_at) VALUES (?,1,0,'pending',?,?)`).run(w.id, Date.now(), Date.now());
    const out = await generateStanding(db, d, {});
    assert.deepEqual(out.items.map((i: any) => i.title), ['片102']);   // 101 被排除
  });

  it('避雷池作品（feedback not_interested）硬过滤，LLM 重复返回也不再推荐', async () => {
    const d = deps();
    // 先建 work 101 并写一条 not_interested 反馈（带 work_id）
    const w = await (await import('../src/routes/works.js')).upsertWork(db, d.tmdb, d.bangumi, d.douban, { tmdb_id: 101, tmdb_type: 'movie', skipUpgrade: true });
    db.prepare(`INSERT INTO recommendations (batch_id, rec_type, work_id, raw_title, reason, validated, feedback, created_at) VALUES ('old','standing',?,'片101','r',1,'not_interested',?)`).run(w.id, Date.now());
    // LLM 仍返回 片101 + 片102（默认 deps 的 chat）→ 101 应被避雷池硬挡
    const out = await generateStanding(db, d, {});
    assert.deepEqual(out.items.map((i: any) => i.title), ['片102']);
  });

  it('gatherContext 汇集双方与避雷池', async () => {
    const d = deps();
    const w = await (await import('../src/routes/works.js')).upsertWork(db, d.tmdb, d.bangumi, d.douban, { tmdb_id: 101, tmdb_type: 'movie', skipUpgrade: true });
    db.prepare(`INSERT INTO user_marks (user_id, work_id, status, rating, marked_at) VALUES (1, ?, 'watched', 9, ?)`).run(w.id, Date.now());
    db.prepare(`INSERT INTO recommendations (batch_id, rec_type, raw_title, reason, validated, feedback, created_at) VALUES ('b','standing','烂片A','r',0,'not_interested',?)`).run(Date.now());
    const ctx = gatherContext(db);
    assert.equal(ctx.marksA.length, 1);
    assert.ok(ctx.avoidTitles.includes('烂片A'));
    assert.ok(ctx.knownKeys.has('movie:101'));
  });
});
