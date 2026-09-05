import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { createSteamClient, mapSteamGame, parseDiscountEndDate, parseRecentReviewSummary, parseSteamReference } from '../src/steam/client.js';

const base = {
  type: 'game', steam_appid: 620, name: '传送门 2', is_free: false,
  short_description: '双人解谜', developers: ['Valve'], publishers: ['Valve'],
  genres: [{ id: '23', description: '独立' }],
  categories: [{ id: 38, description: '在线合作' }],
  platforms: { windows: true, mac: true, linux: true },
  header_image: 'https://shared.fastly.steamstatic.com/a.jpg',
  price_overview: { currency: 'CNY', initial: 4200, final: 840, discount_percent: 80, final_formatted: '¥ 8.40' },
  release_date: { coming_soon: false, date: '2011 年 4 月 19 日' },
};

describe('Steam client', () => {
  it('识别 AppID 与 Steam 商店链接', () => {
    assert.equal(parseSteamReference('620'), 620);
    assert.equal(parseSteamReference('https://store.steampowered.com/app/620/Portal_2/'), 620);
    assert.equal(parseSteamReference('传送门'), null);
  });

  it('映射国区价格、好评率、双人能力和素材', () => {
    const game: any = mapSteamGame({
      zh: base, en: { name: 'Portal 2' }, now: 123,
      discountEndDate: '2026-08-14',
      reviews: { query_summary: { review_score: 9, review_score_desc: '好评如潮', total_positive: 100, total_negative: 5, total_reviews: 105 } },
      recentReviews: { query_summary: { review_score: 8, review_score_desc: '特别好评', total_positive: 20, total_negative: 2, total_reviews: 22 } },
    });
    assert.equal(game.steam_appid, 620);
    assert.equal(game.original_title, 'Portal 2');
    assert.equal(game.release_year, 2011);
    assert.equal(game.release_state, 'released');
    assert.equal(game.supports_together, 1);
    assert.equal(game.current_price, 840);
    assert.equal(game.review_percent, 95);
    assert.equal(game.discount_end_date, '2026-08-14');
    assert.match(game.cover_url, /library_600x900/);
  });

  it('普通多人或 PvP 不冒充双人合作', () => {
    for (const id of [1, 24, 36, 37, 47]) {
      const game: any = mapSteamGame({ zh: { ...base, categories: [{ id, description: '多人' }] } });
      assert.equal(game.supports_together, 0);
    }
    for (const id of [9, 38, 39, 48]) {
      const game: any = mapSteamGame({ zh: { ...base, categories: [{ id, description: '合作' }] } });
      assert.equal(game.supports_together, 1);
    }
  });

  it('抢先体验等同未正式发售', () => {
    const game: any = mapSteamGame({
      zh: { ...base, genres: [{ id: 70, description: '抢先体验' }] },
      reviews: null, recentReviews: null,
    });
    assert.equal(game.release_state, 'early_access');
  });

  it('从商店页提取真实过去 30 天评测，而非复用总评', () => {
    const parsed: any = parseRecentReviewSummary('data-tooltip-html="过去 30 天内的 2,518 篇用户评测中有 98% 为好评。"');
    assert.equal(parsed.query_summary.total_reviews, 2518);
    assert.equal(parsed.query_summary.total_positive, 2468);
    assert.equal(parseRecentReviewSummary('无近期评测'), null);
  });

  it('从 Steam 官方促销提示解析截止日并处理跨年', () => {
    assert.equal(parseDiscountEndDate('<p class="game_purchase_discount_countdown">特别促销！8 月 14 日截止</p>', Date.UTC(2026, 7, 12)), '2026-08-14');
    assert.equal(parseDiscountEndDate('<p class="game_purchase_discount_countdown">每日特惠！8 月 19 日截止</p>', Date.UTC(2026, 7, 12)), '2026-08-19');
    assert.equal(parseDiscountEndDate(`
      <script>$J(function(){ InitDailyDealTimer($J('#countdown'), 1786640400); });</script>
      <p class="game_purchase_discount_countdown">特价促销！剩余时间 <span id="countdown"></span></p>
    `, Date.UTC(2026, 7, 12)), '2026-08-14');
    assert.equal(parseDiscountEndDate('SPECIAL PROMOTION! Offer ends January 3', Date.UTC(2026, 11, 30)), '2027-01-03');
    assert.equal(parseDiscountEndDate('没有明确促销截止日', Date.UTC(2026, 7, 12)), null);
  });

  it('直接 AppID 搜索拉取中英详情与评测', async () => {
    const calls: string[] = [];
    let storeCookie = '';
    const fetch = async (url: any, options: any = {}) => {
      const text = String(url); calls.push(text);
      if (text.includes('/appdetails')) {
        const data = text.includes('l=english') ? { ...base, name: 'Portal 2' } : base;
        return new Response(JSON.stringify({ '620': { success: true, data } }));
      }
      if (text.includes('/appreviews/')) return new Response(JSON.stringify({ query_summary: { review_score: 8, total_positive: 10, total_negative: 1, total_reviews: 11 } }));
      storeCookie = options.headers?.Cookie || '';
      return new Response('<p class="game_purchase_discount_countdown">每日特惠！8 月 19 日截止</p>过去 30 天内的 100 篇用户评测中有 90% 为好评。');
    };
    const client = createSteamClient({ fetch, now: () => Date.UTC(2026, 7, 12) });
    const result = await client.search('620');
    assert.equal(result.results[0].title, '传送门 2');
    assert.equal(result.results[0].original_title, 'Portal 2');
    assert.equal(result.results[0].discount_end_date, '2026-08-19');
    assert.ok(calls.some(url => url.includes('/appreviews/620')));
    assert.match(storeCookie, /timezoneOffset=28800,0/);
  });

  it('hotReviews 请求 Steam 高赞评测并映射前三条', async () => {
    let requested = '';
    const fetch = async (url: any) => {
      requested = String(url);
      return new Response(JSON.stringify({ reviews: [
        { recommendationid: '1', review: '合作神作', voted_up: true, votes_up: 20, timestamp_created: 1_700_000_000, author: { steamid: '76561198000001234', playtime_forever: 1234 } },
        { recommendationid: '2', review: '谜题很棒', voted_up: true, votes_up: 10, author: { steamid: '76561198000005678' } },
        { recommendationid: '3', review: '后半段一般', voted_up: false, votes_up: 3, author: { steamid: '76561198000009012' } },
      ] }));
    };
    const reviews = await createSteamClient({ fetch }).hotReviews(620, 3);
    assert.match(requested, /appreviews\/620/);
    assert.match(requested, /filter=toprated/);
    assert.equal(reviews.length, 3);
    assert.equal(reviews[0].sentiment, 'positive');
    assert.equal(reviews[0].playtime_hours, 20.6);
    assert.equal(reviews[2].sentiment, 'negative');
  });

  it('旧 AppID 重定向后用规范 AppID 重抓评测和商品页并复用缓存', async () => {
    const calls: string[] = [];
    const canonicalAppid = 435150;
    const legacyAppid = 380370;
    const redirected = { ...base, steam_appid: canonicalAppid, name: '神界：原罪 2 - 终极版' };
    const fetch = async (url: any) => {
      const text = String(url); calls.push(text);
      if (text.includes('/appdetails')) {
        const requestedAppid = new URL(text).searchParams.get('appids')!;
        return new Response(JSON.stringify({ [requestedAppid]: { success: true, data: redirected } }));
      }
      if (text.includes(`/appreviews/${canonicalAppid}`)) {
        return new Response(JSON.stringify({
          query_summary: {
            review_score: 9, review_score_desc: '好评如潮',
            total_positive: 96, total_negative: 4, total_reviews: 100,
          },
        }));
      }
      if (text.includes(`/appreviews/${legacyAppid}`)) {
        return new Response(JSON.stringify({ query_summary: {
          review_score: 0, review_score_desc: '无用户评测',
          total_positive: 0, total_negative: 0, total_reviews: 0,
        } }));
      }
      if (text.includes(`/app/${canonicalAppid}/`)) {
        return new Response('过去 30 天内的 100 篇用户评测中有 91% 为好评。');
      }
      return new Response('过去 30 天内的 100 篇用户评测中有 10% 为好评。');
    };
    const client = createSteamClient({ fetch });

    const result: any = await client.gameDetail(legacyAppid);
    assert.equal(result.steam_appid, canonicalAppid);
    assert.equal(result.review_percent, 96);
    assert.equal(result.review_total, 100);
    assert.equal(result.recent_review_percent, 91);
    assert.ok(calls.some(url => url.includes(`/appreviews/${canonicalAppid}`)));
    assert.ok(calls.some(url => url.includes(`/app/${canonicalAppid}/`)));

    const callsBeforeCanonicalLookup = calls.length;
    assert.equal(await client.gameDetail(canonicalAppid), result);
    assert.equal(calls.length, callsBeforeCanonicalLookup);
  });

  it('国区不可见的国际版 AppID 会回退到 US 商店详情', async () => {
    const calls: string[] = [];
    const international = { ...base, steam_appid: 2739990, name: 'Mahjong Soul', is_free: true, price_overview: undefined };
    const fetch = async (url: any) => {
      const text = String(url); calls.push(text);
      if (text.includes('/appdetails')) {
        if (text.includes('cc=CN')) return new Response(JSON.stringify({ '2739990': { success: false } }));
        return new Response(JSON.stringify({ '2739990': { success: true, data: international } }));
      }
      if (text.includes('/appreviews/')) return new Response(JSON.stringify({ query_summary: {} }));
      return new Response('');
    };
    const client = createSteamClient({ fetch });
    const result: any = await client.gameDetail(2739990);
    assert.equal(result.title, 'Mahjong Soul');
    assert.equal(result.is_free, 1);
    assert.ok(calls.some(url => url.includes('cc=CN')));
    assert.ok(calls.some(url => url.includes('cc=US')));
  });

  it('相同搜索和详情合并并发请求并复用短时缓存', async () => {
    let searchCalls = 0;
    let detailCalls = 0;
    const fetch = async (url: any) => {
      const text = String(url);
      if (text.includes('/api/storesearch/')) {
        searchCalls++;
        return new Response(JSON.stringify({ items: [{ type: 'app', id: 620 }] }));
      }
      if (text.includes('/api/appdetails')) {
        detailCalls++;
        const data = text.includes('l=english') ? { ...base, name: 'Portal 2' } : base;
        return new Response(JSON.stringify({ '620': { success: true, data } }));
      }
      if (text.includes('/appreviews/')) return new Response(JSON.stringify({ query_summary: {} }));
      return new Response('');
    };
    const client = createSteamClient({ fetch });
    const [first, second] = await Promise.all([client.search('传送门'), client.search('传送门')]);
    const third = await client.search('传送门');
    assert.equal(searchCalls, 2); // CN 与 US 各一次，而不是每个调用各两次。
    assert.equal(detailCalls, 2); // 中英文详情各一次。
    assert.deepEqual(second, first);
    assert.deepEqual(third, first);
  });

  it('别名候选只取轻量中英文商店搜索，不抓详情与评测', async () => {
    const calls: string[] = [];
    const fetch = async (url: any) => {
      const text = String(url); calls.push(text);
      const parsed = new URL(text);
      const english = parsed.searchParams.get('l') === 'english';
      return new Response(JSON.stringify({ items: [{
        type: 'app', id: 2129530, name: english ? 'REANIMAL' : '生灵重塑', tiny_image: 'poster.jpg',
      }] }));
    };
    const client: any = createSteamClient({ fetch });
    const result = await client.searchCandidates('生灵重塑');
    assert.equal(result.results[0].steam_appid, 2129530);
    assert.equal(result.results[0].title, '生灵重塑');
    assert.equal(result.results[0].original_title, 'REANIMAL');
    assert.equal(calls.length, 4);
    assert.ok(calls.every(url => url.includes('/api/storesearch/')));
  });

  it('DLC 独立映射并保留所属本体，工具仍过滤', () => {
    const dlc: any = mapSteamGame({ zh: {
      ...base, type: 'dlc', steam_appid: 2138330,
      fullgame: { appid: '1091500', name: '赛博朋克 2077' },
    } });
    assert.equal(dlc.content_type, 'dlc');
    assert.equal(dlc.parent_steam_appid, 1091500);
    assert.equal(dlc.parent_title, '赛博朋克 2077');
    assert.equal(mapSteamGame({ zh: { ...base, type: 'tool' } }), null);
  });
});
