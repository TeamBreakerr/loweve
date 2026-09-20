import assert from 'node:assert/strict';
import { runRecommendationAgent } from '../src/recos/agent.js';
import { normalizePlan, retrieveMovies, movieIdentity } from '../src/recos/discovery.js';
import { createTmdbClient } from '../src/tmdb/client.js';
import { createBangumiClient } from '../src/bangumi/client.js';
import { generateStanding, readBatch } from '../src/recos/service.js';
import { makeTestDb, makeFakeTmdb, makeFakeBangumi } from './helpers.js';

const movie = (id: number, score = 8) => ({ tmdb_id: id, tmdb_type: 'movie', title: `电影${id}`, year: 2020, vote_average: score, vote_count: 500, overview: '数据库剧情' });
const discover = (args: any = {}) => [{ tool: 'discover', args: { source: 'tmdb', kind: 'movie', order: 'personalized', ...args } }];
const finish = (args: any = {}) => [{ tool: 'finish', args: { items: [{ candidate_id: 'tmdb:movie:1', reason: '根据资料推荐' }], ...args } }];
function scripted(turns: any[], inspect?: (messages: any[], index: number) => void) {
  let calls = 0;
  return { isConfigured: () => true, chat: async (messages: any[]) => {
    inspect?.(messages, calls);
    const turn = turns[calls++];
    if (!turn) throw new Error('unexpected agent turn');
    return JSON.stringify(turn);
  } };
}
const options = { domain: 'movie' as const, userPrompt: '按我们口味找电影', messages: [] };

describe('推荐检索 agent', () => {
  it('先获取资源、再补查详情、最后选取候选；评分来自接口', async () => {
    let searches = 0;
    const deps = {
      llm: scripted([discover(), [{ tool: 'details', args: { candidate_id: 'tmdb:movie:1' } }], finish()], (messages, i) => {
        if (i === 1) assert.match(messages.at(-1).content, /数据库剧情/);
        if (i === 2) assert.match(messages.at(-1).content, /核实后的详情/);
      }),
      tmdb: { discover: async () => { searches++; return { total: 1, results: [movie(1, 8.7)] }; }, movieDetail: async () => ({ overview: '核实后的详情' }) },
    };
    const result = await runRecommendationAgent(deps, options);
    assert.equal(searches, 1);
    assert.equal(result.items[0].score, 8.7);
    assert.equal(result.items[0].hit?.tmdb_id, 1);
    assert.match(result.items[0].reason!, /TMDB 8.7分/);
  });

  it('没有检索就直接完成会被拒绝，允许模型纠正', async () => {
    const result = await runRecommendationAgent({ llm: scripted([finish(), discover(), finish()], (m, i) => {
      if (i === 1) assert.match(m.at(-1).content, /必须先成功检索/);
    }), tmdb: { discover: async () => ({ total: 1, results: [movie(1)] }) } }, options);
    assert.equal(result.items.length, 1);
  });

  it('模型编造候选ID不会成为推荐，必须重新选择', async () => {
    const llm = scripted([discover(), finish({ items: [{ candidate_id: 'tmdb:movie:999' }] }), finish()], (m, i) => {
      if (i === 2) assert.match(m.at(-1).content, /未返回的候选/);
    });
    const result = await runRecommendationAgent({ llm, tmdb: { discover: async () => ({ total: 1, results: [movie(1)] }) } }, options);
    assert.deepEqual(result.items.map(c => c.id), ['tmdb:movie:1']);
  });

  it('可以根据结果追加不同类型查询，并合并真实候选', async () => {
    const seen: any[] = [];
    const llm = scripted([discover({ genres: ['悬疑'] }), discover({ genres: ['科幻'] }), finish({ items: [
      { candidate_id: 'tmdb:movie:2', reason: '来自第二次查询' }, { candidate_id: 'tmdb:movie:1', reason: '来自第一次查询' },
    ] })]);
    const result = await runRecommendationAgent({ llm, tmdb: { discover: async (_kind: string, params: any) => {
      seen.push(params.with_genres); return { total: 1, results: [movie(seen.length)] };
    } } }, options);
    assert.deepEqual(seen, ['9648', '878']);
    assert.deepEqual(result.items.map(c => c.id), ['tmdb:movie:2', 'tmdb:movie:1']);
  });

  it('工具故障作为错误反馈，允许换源，不能伪造成功', async () => {
    const llm = scripted([discover({ source: 'douban' }), discover(), finish()], (m, i) => {
      if (i === 1) assert.match(m.at(-1).content, /尚未提供可靠/);
    });
    const result = await runRecommendationAgent({ llm, tmdb: { discover: async () => ({ total: 1, results: [movie(1)] }) } }, options);
    assert.equal(result.queries.filter(q => q.ok).length, 1);
    assert.equal(result.items[0].source, 'TMDB');
  });

  it('游戏可以独立使用Steam检索，不要求配置IGDB', async () => {
    let lookedUp = false;
    const result = await runRecommendationAgent({
      igdb: { isConfigured: () => false },
      steam: { discover: async ({ tagNames }: any) => {
        lookedUp = true; assert.deepEqual(tagNames, ['解谜', '多人']);
        return { results: [{ steam_appid: 620, title: 'Portal 2', release_year: 2011, review_percent: 98, review_total: 1000, supports_together: 1 }] };
      } },
      llm: scripted([[{ tool: 'discover', args: { source: 'steam', genres: ['解谜'] } }],
        finish({ items: [{ candidate_id: 'steam:620', reason: '合作解谜', taste_tier: 5, together_tier: 5 }] })]),
    }, { ...options, domain: 'game', userPrompt: '找合作解谜游戏' });
    assert.ok(lookedUp); assert.equal(result.items[0].source, 'Steam');
    assert.equal(result.items[0].score, 98); assert.equal(result.items[0].game.steam_appid, 620);
  });

  it('拒绝不能实际执行的条件，不默默忽略', () => {
    assert.throws(() => normalizePlan({ source: 'tmdb', director: '某导演' }, 'movie'), /不支持的筛选字段/);
    assert.throws(() => normalizePlan({ source: 'tmdb', tags: ['完结'] }, 'movie'), /不支持/);
    assert.throws(() => normalizePlan({ source: 'steam', excludeGenres: ['射击'] }, 'game'), /暂不支持/);
  });

  it('豆瓣只能使用已接入的真实Top250片单，保留来源排名', async () => {
    const result = await runRecommendationAgent({
      douban: { collectionItems: async (name: string) => {
        assert.equal(name, 'movie_top250');
        return { items: [{ douban_id: '1292052', title: '肖申克的救赎', kind: 'movie', year: 1994, score: 9.7, votes: 100000, rank: 1, url: 'https://movie.douban.com/subject/1292052/' }] };
      } },
      llm: scripted([[{ tool: 'collection', args: { source: 'douban', collection: 'movie_top250' } }], finish({ order: 'rank', query_id: 'q1', count: 1 })]),
    }, options);
    assert.equal(result.items[0].id, 'douban:1292052'); assert.equal(result.items[0].rank, 1);
  });

  it('评分排序由程序执行，不采信模型排序或评分', async () => {
    const result = await runRecommendationAgent({ llm: scripted([discover({ order: 'score' }), finish({ order: 'score', query_id: 'q1', count: 2,
      items: [{ candidate_id: 'tmdb:movie:1', score: 10 }] })]),
    tmdb: { discover: async () => ({ total: 2, results: [movie(1, 7), movie(2, 9)] }) } }, options);
    assert.deepEqual(result.items.map(c => c.score), [9, 7]);
    assert.equal(result.ordered, true);
  });

  it('后续关键词搜索不能改写先前排序查询的评分快照', async () => {
    const result = await runRecommendationAgent({
      llm: scripted([discover({ order: 'score' }), [{ tool: 'search', args: { source: 'tmdb', query: '电影1' } }], finish({ order: 'score', query_id: 'q1', count: 2 })]),
      tmdb: {
        discover: async () => ({ total: 2, results: [movie(1, 7), movie(2, 9)] }),
        search: async () => ({ results: [movie(1, 10)] }),
      },
    }, options);
    assert.deepEqual(result.items.map(c => c.score), [9, 7]);
  });

  it('来源明确拒绝访问后不重复请求，允许使用其他真实来源', async () => {
    let calls = 0;
    const result = await runRecommendationAgent({
      llm: scripted([discover({ source: 'bangumi' }), discover({ source: 'bangumi' }), discover(), finish()]),
      bangumi: { discoverAnime: async () => {
        calls++;
        throw Object.assign(new Error('bangumi_upstream'), { body: { cloudflare_error: true } });
      } },
      tmdb: { discover: async () => ({ total: 1, results: [movie(1)] }) },
    }, options);
    assert.equal(calls, 1);
    assert.equal(result.items[0].source, 'TMDB');
    assert.equal(result.queries.filter(q => !q.ok).length, 2);
  });

  it('Bangumi按查询顺序分页并校验剧场版，不将TV冒充电影', async () => {
    const offsets: number[] = [];
    const plan = normalizePlan({ source: 'bangumi', kind: 'movie', order: 'score', count: 2 }, 'movie');
    const result = await retrieveMovies({ bangumi: { discoverAnime: async ({ offset, filter, sort }: any) => {
      assert.deepEqual(filter.meta_tags, ['剧场版']); assert.equal(sort, 'score'); offsets.push(offset);
      return { total: 40, items: offset === 0 ? [{ bangumi_id: 1, name: 'TV', platform: 'TV' }]
        : [2, 3].map(id => ({ bangumi_id: id, name: `电影${id}`, platform: '剧场版', score: 9 })) };
    } } }, plan);
    assert.deepEqual(offsets, [0, 20]); assert.equal(result.length, 2);
  });

  it('跨库匹配不到正确类型时不冒充匹配成功', async () => {
    const hit = await movieIdentity({ tmdb: { search: async () => ({ results: [{ ...movie(1), tmdb_type: 'tv' }] }) } },
      { id: 'bangumi:1', title: '电影1', year: 2020, type: 'movie', source: 'Bangumi', score: 8, votes: 500, url: 'https://bgm.tv/subject/1' });
    assert.equal(hit, null);
  });

  it('空结果和重复工具循环最终终止，不回退为模型猜测', async () => {
    let calls = 0;
    await assert.rejects(runRecommendationAgent({ llm: { chat: async () => { calls++; return JSON.stringify(discover()); } },
      tmdb: { discover: async () => ({ total: 0, results: [] }) } }, options), /检索未在预算内完成/);
    assert.equal(calls, 8);
  });

  it('真实推荐入口保存十条、来源证据，刷新后不截成九条', async () => {
    const db = makeTestDb();
    try {
      const tmdb: any = makeFakeTmdb({ movieDetail: async (id: number) => ({ id, title: `电影${id}`, release_date: '2020-01-01', genres: [], vote_average: 8, vote_count: 500 }) });
      tmdb.discover = async () => ({ total: 10, results: Array.from({ length: 10 }, (_, i) => movie(i + 1)) });
      const llm = scripted([discover({ order: 'score', count: 10 }), finish({ order: 'score', query_id: 'q1', count: 10 })]);
      const result = await generateStanding(db, { llm, tmdb, bangumi: makeFakeBangumi(), douban: {} }, { userPrompt: '评分前十的电影' });
      assert.equal(result.items.length, 10);
      const persisted: any = readBatch(db, result.batch_id);
      assert.equal(persisted.length, 10);
      assert.equal(persisted[0].evidence.source, 'TMDB');
      assert.equal(persisted[0].evidence.source_votes, 500);
    } finally { db.close(); }
  });
});

describe('数据源条件检索请求', () => {
  it('TMDB将筛选和分页发给discover接口', async () => {
    const client = createTmdbClient({ token: 'test', fetch: async (url: string) => {
      const u = new URL(url); assert.equal(u.pathname, '/3/discover/movie');
      assert.equal(u.searchParams.get('with_genres'), '27'); assert.equal(u.searchParams.get('vote_count.gte'), '300');
      return { ok: true, json: async () => ({ total_results: 1, results: [{ id: 1, title: 'test', vote_count: 500 }] }) };
    } });
    const result = await client.discover('movie', { with_genres: '27', 'vote_count.gte': '300' });
    assert.equal(result.results[0].vote_count, 500);
  });
  it('Bangumi请求保持score与rank的区别，限制条目类型', async () => {
    const client = createBangumiClient({ userAgent: 'test', fetch: async (url: string, options: any) => {
      const body = JSON.parse(options.body); assert.equal(body.sort, 'score'); assert.deepEqual(body.filter.type, [2]);
      assert.match(url, /offset=20/);
      return { ok: true, json: async () => ({ total: 1, data: [{ id: 1, rating: { score: 9, total: 300, rank: 2 }, platform: '剧场版' }] }) };
    } });
    const result = await client.discoverAnime({ sort: 'score', filter: { meta_tags: ['剧场版'] }, offset: 20 });
    assert.equal(result.items[0].platform, '剧场版'); assert.equal(result.items[0].score, 9);
  });
});
