import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeFakeIgdb, makeFakeLlm, makeFakeSteam, makeFakeWikidata, makeTestDb } from './helpers.js';
import { gameOfferNeedsRefresh, isDefaultRecommendationEligible } from '../src/games/service.js';
import { buildGameMessages, customAllowsDlc, customAllowsSolo, customAllowsUnreleased, customPriceCeiling } from '../src/games/prompt.js';
import { gameReviewQualityTier, isGameRecommendationEligible, rankGameCandidates } from '../src/games/recos.js';
import { resolveCatalogGame } from '../src/games/service.js';

function game(appid: number, overrides: any = {}) {
  const now = Date.now();
  return {
    steam_appid: appid, title: `游戏${appid}`, original_title: `Game ${appid}`,
    release_date: '2024 年 1 月 2 日', release_year: 2024, release_state: 'released', is_free: 0,
    short_description: '双人游戏', about_game: '介绍', developers: '["Dev"]', publishers: '["Pub"]',
    genres: '["动作"]', platforms: '{"windows":true}', play_modes: '[{"id":38,"description":"在线合作"}]',
    supports_together: 1, cover_url: `https://shared.fastly.steamstatic.com/${appid}.jpg`,
    header_url: `https://shared.fastly.steamstatic.com/${appid}-h.jpg`, price_currency: 'CNY',
    initial_price: 6800, current_price: 3400, discount_percent: 50, price_formatted: '¥ 34.00',
    review_score: 8, review_desc: '特别好评', review_positive: 900, review_negative: 100,
    review_total: 1000, review_percent: 90, recent_review_score: 8, recent_review_desc: '特别好评',
    recent_review_positive: 90, recent_review_negative: 10, recent_review_total: 100,
    recent_review_percent: 90, steam_raw: '{"_loweve_offer_parser_version":3}', reviews_raw: '{}', fetched_at: now, updated_at: now,
    store_url: `https://store.steampowered.com/app/${appid}/`, ...overrides,
  };
}

function setup(steamImpl: any = {}, llmImpl: any = {}) {
  const db = makeTestDb();
  const steam = makeFakeSteam({
    search: async (q: any) => ({ results: [game(Number(String(q).replace(/\D/g, '')) || 1)] }),
    gameDetail: async (appid: number) => game(appid),
    ...steamImpl,
  });
  const llm = makeFakeLlm(llmImpl);
  return { db, app: createApp({ db, steam, llm }) };
}

describe('游戏空间 API', () => {
  it('自定义范围只在明确允许时放开，否定表达不误判', () => {
    assert.equal(customAllowsSolo('允许单人 RPG'), true);
    assert.equal(customAllowsSolo('不要推荐单人游戏'), false);
    assert.equal(customAllowsUnreleased('看看抢先体验期待作'), true);
    assert.equal(customAllowsUnreleased('排除未发售游戏'), false);
    assert.equal(customAllowsDlc('推荐赛博朋克的资料片'), true);
    assert.equal(customAllowsDlc('别推荐 DLC'), false);
    assert.equal(customPriceCeiling('找 50 元以内的合作游戏'), 5000);
    assert.equal(customPriceCeiling('价格不重要'), null);
  });

  it('推荐提示明确核心适配优先，价格只破同分且输出适配分档', () => {
    const messages = buildGameMessages({
      userA: '甲', userB: '乙', marksA: [], marksB: [], sessions: [], plan: [],
      avoidTitles: [], userPrompt: null,
    });
    const text = messages.map(message => message.content).join('\n');
    assert.match(text, /口味匹配、双人适配度和评价质量/);
    assert.match(text, /PC、Nintendo、PlayStation、Xbox 与复古平台/);
    assert.match(text, /只有核心适配相同时/);
    assert.match(text, /不得因为价格高而排除/);
    assert.match(text, /taste_tier/);
    assert.match(text, /together_tier/);
  });

  it('核心适配严格先于价格，核心同分时免费或折扣游戏优先', () => {
    const ranked = rankGameCandidates([
      { sourceIndex: 0, item: { taste_tier: 5, together_tier: 5 }, game: game(1, { current_price: 99900, discount_percent: 0 }) },
      { sourceIndex: 1, item: { taste_tier: 4, together_tier: 4 }, game: game(2, { is_free: 0, discount_percent: 0 }) },
      { sourceIndex: 2, item: { taste_tier: 4, together_tier: 4 }, game: game(3, { is_free: 0, discount_percent: 60 }) },
    ]);
    assert.deepEqual(ranked.map(entry => entry.game.steam_appid), [1, 3, 2]);
    assert.equal(gameReviewQualityTier(game(4, { review_percent: 100, review_total: 5 })), 3);
    assert.equal(gameReviewQualityTier(game(5, { review_percent: 95, review_total: 10_000 })), 5);
  });

  it('允许 DLC 不会顺带放开纯单人内容', () => {
    const soloDlc = game(10, { content_type: 'dlc', supports_together: 0 });
    assert.equal(isGameRecommendationEligible(soloDlc, '推荐一些 DLC'), false);
    assert.equal(isGameRecommendationEligible(soloDlc, '允许单人 DLC'), true);
  });

  it('推荐解析先用 Steam 补齐评价价格，且 IGDB 可用时不回退 Steam-only 身份', async () => {
    const catalog = game(20, {
      igdb_id: 2000, catalog_source: 'igdb', review_percent: null, review_total: null,
      current_price: null, discount_percent: 0,
    });
    const enriched: any = await resolveCatalogGame({
      igdb: makeFakeIgdb({ gameDetail: async () => catalog }),
      steam: makeFakeSteam({ gameDetail: async () => game(20, { review_percent: 42, current_price: 8800 }) }),
    }, { igdb_id: 2000, title: catalog.title });
    assert.equal(enriched.igdb_id, 2000);
    assert.equal(enriched.review_percent, 42);
    assert.equal(enriched.current_price, 8800);

    const missing = await resolveCatalogGame({
      igdb: makeFakeIgdb({ search: async () => ({ results: [] }) }),
      steam: makeFakeSteam({ search: async () => ({ results: [game(99)] }) }),
    }, { title: 'Steam Only' });
    assert.equal(missing, null);
  });

  it('促销解析器升级后会回填旧的空截止日，当前版本不会反复抓取', () => {
    assert.equal(gameOfferNeedsRefresh(game(1, { discount_end_date: '', steam_raw: '{}' })), true);
    assert.equal(gameOfferNeedsRefresh(game(1, { discount_end_date: '', steam_raw: '{"_loweve_offer_parser_version":2}' })), true);
    assert.equal(gameOfferNeedsRefresh(game(1, { discount_end_date: '', steam_raw: '{"_loweve_offer_parser_version":3}' })), false);
    assert.equal(gameOfferNeedsRefresh(game(1, { discount_percent: 0, discount_end_date: null })), false);
  });

  it('个人游戏记录独立于影视记录', async () => {
    const { app, db } = setup();
    const created = await request(app).post('/api/games/marks').set('Cookie', 'loweve_user_id=1')
      .send({ steam_appid: 620, rating: 9, comment: '双人神作' });
    assert.equal(created.status, 200);
    assert.equal(db.prepare('SELECT count(*) AS n FROM game_marks').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM user_marks').get().n, 0);
    const list = await request(app).get('/api/games/marks').set('Cookie', 'loweve_user_id=1');
    assert.equal(list.body.marks[0].work.steam_appid, 620);
    assert.equal(list.body.marks[0].work.store_url, 'https://store.steampowered.com/app/620/');
  });

  it('DLC 可作为独立作品加入清单并保留所属本体', async () => {
    const dlc = game(2138330, {
      content_type: 'dlc', parent_steam_appid: 1091500, parent_title: '赛博朋克 2077',
      title: '赛博朋克 2077：往日之影',
    });
    const { app, db } = setup({ gameDetail: async () => dlc });
    const created = await request(app).post('/api/games/plan').set('Cookie', 'loweve_user_id=1')
      .send({ steam_appid: 2138330 });
    assert.equal(created.status, 200);
    const listed = await request(app).get('/api/games/plan').set('Cookie', 'loweve_user_id=1');
    assert.equal(listed.body.items[0].work.content_type, 'dlc');
    assert.equal(listed.body.items[0].work.parent_title, '赛博朋克 2077');
    const stored: any = db.prepare('SELECT content_type, parent_steam_appid FROM game_works WHERE steam_appid = ?').get(2138330);
    assert.deepEqual(stored, { content_type: 'dlc', parent_steam_appid: 1091500 });
  });

  it('IGDB 搜索并保存没有 Steam 版本的 GBA 游戏，价格保持为空', async () => {
    const db = makeTestDb();
    const catalogGame = game(1, {
      igdb_id: 1234, steam_appid: null, catalog_source: 'igdb',
      title: 'The Legend of Zelda: The Minish Cap', original_title: null,
      release_date: '2005-01-10', release_year: 2005,
      platforms: JSON.stringify([{ id: 24, name: 'Game Boy Advance', abbreviation: 'GBA' }]),
      platform_releases: [{ igdb_platform_id: 24, platform_name: 'Game Boy Advance', platform_abbreviation: 'GBA', release_date: '2005-01-10', release_year: 2005 }],
      current_price: null, initial_price: null, price_formatted: null,
      review_score: null, review_percent: null, review_total: null,
      catalog_rating: 89, catalog_rating_count: 400, igdb_url: 'https://www.igdb.com/games/minish-cap',
      external_links: '[]', igdb_raw: '{}', steam_raw: null, reviews_raw: null, store_url: null,
    });
    const igdb = makeFakeIgdb({
      search: async () => ({ results: [catalogGame] }),
      gameDetail: async () => catalogGame,
    });
    const app = createApp({ db, igdb, steam: makeFakeSteam(), llm: makeFakeLlm() });
    const search = await request(app).get('/api/games/search?q=Minish%20Cap');
    assert.equal(search.status, 200);
    assert.equal(search.body.results[0].igdb_id, 1234);
    const created = await request(app).post('/api/games/marks').set('Cookie', 'loweve_user_id=1')
      .send({ igdb_id: 1234, rating: 9 });
    assert.equal(created.status, 200);
    const work: any = db.prepare('SELECT * FROM game_works WHERE igdb_id = 1234').get();
    assert.equal(work.steam_appid, null);
    assert.equal(work.current_price, null);
    assert.equal((db.prepare('SELECT count(*) n FROM game_platform_releases WHERE work_id = ?').get(work.id) as any).n, 1);
    assert.equal((db.prepare('SELECT count(*) n FROM game_store_offers WHERE work_id = ?').get(work.id) as any).n, 0);
  });

  it('启用 IGDB 后名称搜索由 IGDB 独占，Steam 仅按外部 AppID 增强同一条结果', async () => {
    const db = makeTestDb();
    const catalogGame = game(2739990, {
      igdb_id: 117263, catalog_source: 'igdb', title: 'Mahjong Soul',
      current_price: null, price_formatted: null, review_percent: null, review_total: null,
    });
    const steamGame = game(2739990, {
      title: 'Mahjong Soul', is_free: 1, current_price: 0, initial_price: 0,
      price_formatted: '免费', review_percent: 83, review_total: 4038,
    });
    let steamSearchCalls = 0;
    const app = createApp({
      db,
      igdb: makeFakeIgdb({ search: async () => ({ results: [catalogGame] }) }),
      steam: makeFakeSteam({
        search: async () => { steamSearchCalls++; return { results: [] }; },
        gameDetail: async (appid: number) => { assert.equal(appid, 2739990); return steamGame; },
      }),
      llm: makeFakeLlm(),
    });
    const search = await request(app).get('/api/games/search?q=%E9%9B%80%E9%AD%82');
    assert.equal(search.status, 200);
    assert.equal(search.body.results.length, 1);
    const merged = search.body.results[0];
    assert.equal(merged.igdb_id, 117263);
    assert.equal(merged.title, 'Mahjong Soul');
    assert.equal(merged.review_percent, 83);
    assert.equal(steamSearchCalls, 0);
    assert.deepEqual(search.body.catalog_sources, ['igdb']);
  });

  it('Steam 链接只作为身份桥，旧 AppID 也必须回到 IGDB 目录身份', async () => {
    const db = makeTestDb();
    const catalogGame = game(380370, {
      igdb_id: 103337, catalog_source: 'igdb', title: 'Divinity: Original Sin 2',
      review_percent: null, review_total: null,
    });
    const steamGame = game(435150, { title: '神界：原罪2 - 终极版', original_title: 'Divinity: Original Sin 2' });
    const app = createApp({
      db,
      igdb: makeFakeIgdb({ search: async () => ({ results: [catalogGame] }) }),
      steam: makeFakeSteam({ gameDetail: async () => steamGame }),
      llm: makeFakeLlm(),
    });
    const search = await request(app).get('/api/games/search?q=https%3A%2F%2Fstore.steampowered.com%2Fapp%2F380370%2F');
    assert.equal(search.status, 200);
    assert.equal(search.body.results.length, 1);
    assert.equal(search.body.results[0].igdb_id, 103337);
    assert.equal(search.body.results[0].steam_appid, 435150);
    assert.equal(search.body.alias_bridge, 'steam_reference_verified_by_igdb');
  });

  it('IGDB 缺少中文译名时允许 Steam 找别名，但必须按 AppID 反查 IGDB 验证', async () => {
    const db = makeTestDb();
    const catalogGame = game(2129530, {
      igdb_id: 314265, catalog_source: 'igdb', title: 'Reanimal', original_title: null,
    });
    const localizedSteamGame = game(2129530, {
      title: '生灵重塑', original_title: 'REANIMAL', discount_end_date: '2026-08-14',
    });
    const dlc = game(4733900, {
      igdb_id: 412645, catalog_source: 'igdb', content_type: 'dlc',
      parent_igdb_id: 314265, parent_steam_appid: 2129530, parent_title: 'Reanimal',
      title: 'Reanimal: Chapter 1', original_title: null,
    });
    let detailCalls = 0;
    const app = createApp({
      db,
      igdb: makeFakeIgdb({
        search: async (query: string) => ({ results: query === 'REANIMAL' ? [catalogGame, dlc] : [] }),
      }),
      steam: makeFakeSteam({
        search: async (query: string) => ({ results: query === '生灵重塑' ? [localizedSteamGame] : [] }),
        gameDetail: async () => { detailCalls++; return localizedSteamGame; },
      }),
      llm: makeFakeLlm(),
    });
    const result = await request(app).get('/api/games/search?q=%E7%94%9F%E7%81%B5%E9%87%8D%E5%A1%91');
    assert.equal(result.status, 200);
    assert.equal(result.body.results.length, 2);
    assert.equal(result.body.results[0].igdb_id, 314265);
    assert.equal(result.body.results[0].title, '生灵重塑');
    assert.equal(result.body.results[0].original_title, 'Reanimal');
    assert.equal(result.body.results[0].discount_end_date, '2026-08-14');
    assert.equal(result.body.results[1].igdb_id, 412645);
    assert.equal(result.body.results[1].content_type, 'dlc');
    assert.equal(result.body.alias_bridge, 'steam_verified_by_igdb');
    assert.equal(detailCalls, 1);
  });

  it('中文目录、Steam 别名与 Wikidata 桥接并行启动，相同请求合并并缓存', async () => {
    const db = makeTestDb();
    const catalogGame = game(2129530, {
      igdb_id: 314265, catalog_source: 'igdb', title: 'Reanimal', original_title: null,
    });
    const localizedSteamGame = game(2129530, { title: '生灵重塑', original_title: 'REANIMAL' });
    let directRelease!: () => void;
    const directGate = new Promise<void>(resolve => { directRelease = resolve; });
    let directStarted = false;
    let steamStarted = false;
    let wikidataStarted = false;
    let routeSearches = 0;
    const app = createApp({
      db,
      igdb: makeFakeIgdb({
        search: async (query: string, options?: any) => {
          if (query === '生灵重塑' && options?.aliases === false) {
            routeSearches++;
            directStarted = true;
            await directGate;
            return { results: [] };
          }
          return { results: query === 'REANIMAL' ? [catalogGame] : [] };
        },
      }),
      steam: makeFakeSteam({
        search: async () => { steamStarted = true; return { results: [localizedSteamGame] }; },
        gameDetail: async () => localizedSteamGame,
      }),
      wikidata: makeFakeWikidata({
        searchGameAliases: async () => { wikidataStarted = true; return []; },
      }),
      llm: makeFakeLlm(),
    });
    const first = request(app).get('/api/games/search?q=%E7%94%9F%E7%81%B5%E9%87%8D%E5%A1%91').then(response => response);
    const second = request(app).get('/api/games/search?q=%E7%94%9F%E7%81%B5%E9%87%8D%E5%A1%91').then(response => response);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(directStarted, true);
    assert.equal(steamStarted, true);
    assert.equal(wikidataStarted, true);
    directRelease();
    const [a, b] = await Promise.all([first, second]);
    const third = await request(app).get('/api/games/search?q=%E7%94%9F%E7%81%B5%E9%87%8D%E5%A1%91');
    assert.equal(a.status, 200);
    assert.deepEqual(b.body, a.body);
    assert.deepEqual(third.body, a.body);
    assert.equal(routeSearches, 1);
  });

  it('非 Steam 游戏的简体中文别名经 Wikidata 映射后仍只返回 IGDB 身份及其 DLC', async () => {
    const db = makeTestDb();
    const base = game(1, {
      igdb_id: 7346, steam_appid: null, catalog_source: 'igdb',
      title: 'The Legend of Zelda: Breath of the Wild', original_title: null,
      platforms: JSON.stringify([{ id: 130, name: 'Nintendo Switch', abbreviation: 'Switch' }]),
    });
    const dlc = game(2, {
      igdb_id: 41825, steam_appid: null, catalog_source: 'igdb', content_type: 'dlc',
      parent_igdb_id: 7346, parent_title: base.title,
      title: 'The Legend of Zelda: Breath of the Wild - The Master Trials', original_title: null,
    });
    const app = createApp({
      db,
      igdb: makeFakeIgdb({
        search: async (query: string) => ({
          results: query === 'The Legend of Zelda: Breath of the Wild' ? [dlc, base] : [],
        }),
      }),
      steam: makeFakeSteam(),
      wikidata: makeFakeWikidata({
        searchGameAliases: async (query: string) => query === '荒野之息' ? [{
          id: 'Q17185964', localized_title: '塞尔达传说 旷野之息',
          lookup_titles: ['The Legend of Zelda: Breath of the Wild'],
        }] : [],
      }),
      llm: makeFakeLlm(),
    });
    const result = await request(app).get('/api/games/search?q=%E8%8D%92%E9%87%8E%E4%B9%8B%E6%81%AF');
    assert.equal(result.status, 200);
    assert.equal(result.body.results.length, 2);
    assert.equal(result.body.results[0].igdb_id, 7346);
    assert.equal(result.body.results[0].title, '塞尔达传说 旷野之息');
    assert.equal(result.body.results[1].igdb_id, 41825);
    assert.equal(result.body.results[1].content_type, 'dlc');
    assert.ok(result.body.results.every((item: any) => item.catalog_source === 'igdb'));
    assert.equal(result.body.alias_bridge, 'wikidata_verified_by_igdb');
  });

  it('Steam 中文别名找到了但 IGDB 无同 AppID 时不产生候选', async () => {
    const db = makeTestDb();
    const steamOnly = game(999999, { title: '只在 Steam 有的中文名', original_title: 'Steam Only' });
    const app = createApp({
      db,
      igdb: makeFakeIgdb({ search: async () => ({ results: [] }) }),
      steam: makeFakeSteam({ search: async () => ({ results: [steamOnly] }) }),
      llm: makeFakeLlm(),
    });
    const result = await request(app).get('/api/games/search?q=%E5%8F%AA%E5%9C%A8Steam%E6%9C%89%E7%9A%84%E4%B8%AD%E6%96%87%E5%90%8D');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.results, []);
  });

  it('IGDB 已配置但名称搜索失败时不偷偷回退 Steam', async () => {
    const db = makeTestDb();
    let steamSearchCalls = 0;
    const app = createApp({
      db,
      igdb: makeFakeIgdb({ search: async () => { throw new Error('igdb_down'); } }),
      steam: makeFakeSteam({ search: async () => { steamSearchCalls++; return { results: [] }; } }),
      llm: makeFakeLlm(),
    });
    const search = await request(app).get('/api/games/search?q=%E9%9B%80%E9%AD%82');
    assert.equal(search.status, 502);
    assert.equal(steamSearchCalls, 0);
  });

  it('从共同计划首次游玩 → 创建记录并转为 playing', async () => {
    const { app, db } = setup();
    const plan = await request(app).post('/api/games/plan').set('Cookie', 'loweve_user_id=1')
      .send({ steam_appid: 620, priority: 2 });
    const session = await request(app).post(`/api/games/sessions?from_plan=${plan.body.id}`)
      .set('Cookie', 'loweve_user_id=2').send({ rating: 8, review: '继续玩' });
    assert.equal(session.status, 200);
    assert.equal(session.body.rating_b, 8);
    assert.equal(session.body.completed_at, null);
    assert.equal(db.prepare('SELECT status FROM game_plan_items WHERE id = ?').get(plan.body.id).status, 'playing');
  });

  it('通关日期在“正在玩”和“一起玩过”之间切换，并同步共同计划状态', async () => {
    const { app, db } = setup();
    const plan = await request(app).post('/api/games/plan').set('Cookie', 'loweve_user_id=1')
      .send({ steam_appid: 620 });
    const created = await request(app).post(`/api/games/sessions?from_plan=${plan.body.id}`)
      .set('Cookie', 'loweve_user_id=1').send({ played_at: 20260801 });
    assert.equal((await request(app).get('/api/games/sessions?status=playing')).body.sessions.length, 1);
    assert.equal((await request(app).get('/api/games/sessions?status=completed')).body.sessions.length, 0);

    const completed = await request(app).put(`/api/games/sessions/${created.body.id}`)
      .send({ completed_at: 20260810 });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.completed_at, 20260810);
    assert.equal(db.prepare('SELECT status FROM game_plan_items WHERE id = ?').get(plan.body.id).status, 'done');
    assert.equal((await request(app).get('/api/games/sessions?status=completed')).body.sessions.length, 1);

    await request(app).put(`/api/games/sessions/${created.body.id}`).send({ completed_at: null });
    assert.equal(db.prepare('SELECT status FROM game_plan_items WHERE id = ?').get(plan.body.id).status, 'playing');
    assert.equal((await request(app).get('/api/games/sessions?status=playing')).body.sessions.length, 1);
  });

  it('补录已通关游戏时允许首次游玩日留空，不伪造成今天', async () => {
    const { app } = setup();
    const created = await request(app).post('/api/games/sessions').set('Cookie', 'loweve_user_id=1')
      .send({ steam_appid: 621, played_at: null, completed_at: 20260701 });
    assert.equal(created.status, 200);
    assert.equal(created.body.played_at, null);
    assert.equal(created.body.completed_at, 20260701);
  });

  it('重复项按个人/共同/计划分别探测', async () => {
    const { app } = setup();
    await request(app).post('/api/games/marks').set('Cookie', 'loweve_user_id=1').send({ steam_appid: 620 });
    const duplicate = await request(app).get('/api/games/works/duplicate?target=played&steam_appid=620')
      .set('Cookie', 'loweve_user_id=1');
    assert.deepEqual(duplicate.body, { duplicate: true, error: 'game_mark_exists' });
  });

  it('删除与恢复走独立游戏回收站', async () => {
    const { app } = setup();
    const mark = await request(app).post('/api/games/marks').set('Cookie', 'loweve_user_id=1').send({ steam_appid: 620 });
    assert.equal((await request(app).delete(`/api/games/marks/${mark.body.id}`).set('Cookie', 'loweve_user_id=1')).status, 204);
    const trash = await request(app).get('/api/games/trash').set('Cookie', 'loweve_user_id=1');
    assert.equal(trash.body.items[0].work.steam_appid, 620);
    assert.equal((await request(app).post(`/api/games/trash/${trash.body.items[0].id}/restore`).set('Cookie', 'loweve_user_id=1')).status, 200);
  });

  it('默认 AI 资格排除 DLC、未发售、抢先体验、纯单人和差评', () => {
    assert.equal(isDefaultRecommendationEligible(game(1)), true);
    assert.equal(isDefaultRecommendationEligible(game(1, { current_price: 199900, discount_percent: 0 })), true);
    assert.equal(isDefaultRecommendationEligible(game(1, { release_state: 'unreleased' })), false);
    assert.equal(isDefaultRecommendationEligible(game(1, { release_state: 'early_access' })), false);
    assert.equal(isDefaultRecommendationEligible(game(1, { supports_together: 0 })), false);
    assert.equal(isDefaultRecommendationEligible(game(1, { review_score: 4 })), false);
    assert.equal(isDefaultRecommendationEligible(game(1, { content_type: 'dlc' })), false);
    assert.equal(isDefaultRecommendationEligible(game(1, { current_price: null, steam_appid: null, igdb_id: 99 })), true);
  });

  it('AI 推荐落独立批次，反馈想玩进入游戏计划', async () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      title: `游戏${100 + i}`, year: 2024, steam_appid: 100 + i, reason: `因为双方喜欢合作 ${i}`,
    }));
    const { app, db } = setup({}, { chat: async () => JSON.stringify(items) });
    const recos = await request(app).get('/api/games/recos');
    assert.equal(recos.status, 200);
    assert.equal(recos.body.items.length, 9);
    assert.equal(db.prepare('SELECT count(*) AS n FROM recommendations').get().n, 0);
    const feedback = await request(app).post(`/api/games/recos/${recos.body.items[0].id}/feedback`)
      .set('Cookie', 'loweve_user_id=1').send({ action: 'want', priority: 3 });
    assert.equal(feedback.status, 200);
    assert.equal(db.prepare('SELECT priority FROM game_plan_items').get().priority, 3);
  });

  it('首个常驻推荐不足 9 条时不发布残缺批次', async () => {
    const { app, db } = setup({}, { chat: async () => JSON.stringify([{
      title: '唯一候选', year: 2024, steam_appid: 777, reason: '唯一真实候选',
    }]) });
    const recos = await request(app).get('/api/games/recos');
    assert.equal(recos.status, 200);
    assert.equal(recos.body.items.length, 0);
    assert.equal(recos.body.error, 'llm_unavailable');
    assert.equal(db.prepare('SELECT count(*) AS n FROM game_recommendations').get().n, 0);
  });

  it('旧的 6 条推荐批次首次读取时自动后台补齐为 9 条', async () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      title: `游戏${300 + i}`, year: 2024, steam_appid: 300 + i, reason: `合作候选 ${i}`,
    }));
    const { app, db } = setup({}, { chat: async () => JSON.stringify(items) });
    const initial = await request(app).get('/api/games/recos');
    assert.equal(initial.body.items.length, 9);
    db.prepare(`DELETE FROM game_recommendations WHERE id IN (
      SELECT id FROM game_recommendations WHERE batch_id = ? ORDER BY id DESC LIMIT 3
    )`).run(initial.body.batch_id);

    const cached = await request(app).get('/api/games/recos');
    assert.equal(cached.body.items.length, 6);
    assert.equal(cached.body.generating, true);

    let completed: any = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5));
      completed = await request(app).get('/api/games/recos');
      if (!completed.body.generating) break;
    }
    assert.equal(completed.body.items.length, 9);
    assert.equal(completed.body.generating, false);
  });

  it('只有自定义预算才用真实国区现价硬过滤', async () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      title: `游戏${200 + i}`, year: 2024, steam_appid: 200 + i, reason: `合作候选 ${i}`,
    }));
    const { app } = setup({
      gameDetail: async (appid: number) => game(appid, { current_price: appid % 2 ? 8800 : 2800 }),
      search: async (q: any) => ({ results: [game(Number(String(q).replace(/\D/g, '')) || 1)] }),
    }, { chat: async () => JSON.stringify(items) });
    const recos = await request(app).post('/api/games/recos/custom')
      .send({ prompt: '找一些 50 元以内的本地合作游戏' });
    assert.equal(recos.status, 200);
    assert.ok(recos.body.items.length > 0);
    assert.ok(recos.body.items.every((item: any) => item.current_price <= 5000));
  });
});
