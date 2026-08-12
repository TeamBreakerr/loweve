import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { createIgdbClient, mapIgdbGame } from '../src/igdb/client.js';

const raw = {
  id: 1234,
  name: 'The Legend of Zelda: The Minish Cap',
  slug: 'the-legend-of-zelda-the-minish-cap',
  summary: 'A tiny adventure.',
  first_release_date: 1107216000,
  cover: { image_id: 'co1234' },
  platforms: [{ id: 24, name: 'Game Boy Advance', abbreviation: 'GBA', slug: 'gba' }],
  release_dates: [{ date: 1107216000, y: 2005, platform: { id: 24, name: 'Game Boy Advance', abbreviation: 'GBA' } }],
  genres: [{ name: 'Adventure' }],
  game_modes: [{ name: 'Single player' }],
  rating: 88.4,
  rating_count: 321,
  total_rating: 89.1,
  total_rating_count: 400,
  url: 'https://www.igdb.com/games/the-legend-of-zelda-the-minish-cap',
};

describe('IGDB client', () => {
  it('映射复古平台、封面、目录评分，且没有报价时保持价格为空', () => {
    const game: any = mapIgdbGame(raw, { now: Date.UTC(2026, 7, 11) });
    assert.equal(game.igdb_id, 1234);
    assert.equal(game.steam_appid, null);
    assert.equal(game.release_state, 'released');
    assert.equal(game.release_year, 2005);
    assert.equal(JSON.parse(game.platforms)[0].abbreviation, 'GBA');
    assert.equal(game.catalog_rating, 89.1);
    assert.equal(game.current_price, null);
    assert.match(game.cover_url, /images\.igdb\.com/);
  });

  it('缺少发售日按尚未发售处理；IGDB 合作字段识别双人能力', () => {
    const game: any = mapIgdbGame({
      ...raw, id: 2, first_release_date: null,
      game_modes: [{ name: 'Multiplayer' }],
      multiplayer_modes: [{ offlinecoop: true, offlinecoopmax: 2 }],
    });
    assert.equal(game.release_state, 'unreleased');
    assert.equal(game.supports_together, 1);
  });

  it('DLC 与扩展包独立映射并保留所属本体，捆绑包仍过滤', () => {
    const dlc: any = mapIgdbGame({
      ...raw, id: 5678, name: 'Phantom Liberty', game_type: { type: 'DLC Addon' },
      parent_game: { id: 1877, name: 'Cyberpunk 2077' },
    });
    assert.equal(dlc.content_type, 'dlc');
    assert.equal(dlc.parent_igdb_id, 1877);
    assert.equal(dlc.parent_title, 'Cyberpunk 2077');
    assert.equal(mapIgdbGame({ ...raw, game_type: { type: 'Expansion' } })?.content_type, 'dlc');
    assert.equal(mapIgdbGame({ ...raw, game_type: { type: 'Bundle' } }), null);
    assert.equal(mapIgdbGame({ ...raw, version_parent: 99 }), null);
  });

  it('识别 Steam 外部 ID，但不把 Steam 价格伪造进 IGDB 响应', () => {
    const game: any = mapIgdbGame({
      ...raw,
      external_games: [{ uid: '620', url: 'https://store.steampowered.com/app/620', category: 1 }],
    });
    assert.equal(game.steam_appid, 620);
    assert.equal(game.current_price, null);
    assert.equal(JSON.parse(game.external_links)[0].provider, 'steam');
  });

  it('用 Client Credentials 获取并缓存 token，搜索请求只在服务端携带认证头', async () => {
    let tokenCalls = 0;
    const apiBodies: string[] = [];
    const fetch = async (url: any, init: any) => {
      if (String(url).includes('id.twitch.tv')) {
        tokenCalls++;
        assert.match(String(init.body), /grant_type=client_credentials/);
        return new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }));
      }
      assert.equal(init.headers['Client-ID'], 'client-id');
      assert.equal(init.headers.Authorization, 'Bearer token-1');
      apiBodies.push(init.body);
      return new Response(JSON.stringify([raw]));
    };
    const client = createIgdbClient({
      fetch,
      now: () => Date.UTC(2026, 7, 11),
      resolve: () => ({ clientId: 'client-id', clientSecret: 'server-secret' }),
    });
    const first: any = await client.search('Zelda');
    const second: any = await client.search('Mario');
    assert.equal(first.results[0].igdb_id, 1234);
    assert.equal(second.results[0].igdb_id, 1234);
    assert.equal(tokenCalls, 1);
    assert.match(apiBodies[0], /search "Zelda"/);
    assert.match(apiBodies[0], /version_parent = null/);
  });

  it('直接 IGDB 引用与详情同样排除版本条目', async () => {
    const apiBodies: string[] = [];
    const fetch = async (url: any, init: any) => {
      if (String(url).includes('id.twitch.tv')) {
        return new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }));
      }
      apiBodies.push(init.body);
      return new Response(JSON.stringify([]));
    };
    const client = createIgdbClient({ fetch, resolve: () => ({ clientId: 'client-id', clientSecret: 'secret' }) });
    await client.search('igdb:1234');
    await assert.rejects(() => client.gameDetail(1234), /igdb_not_found/);
    assert.ok(apiBodies.every(body => body.includes('version_parent = null')));
  });

  it('主标题搜不到时用 IGDB 别名与本地化标题回查同一游戏', async () => {
    const calls: Array<{ endpoint: string; body: string }> = [];
    const mahjong = {
      ...raw, id: 117263, name: 'Mahjong Soul', slug: 'mahjong-soul',
      alternative_names: [
        { name: '雀魂麻將', comment: 'Chinese title - traditional' },
        { name: '雀魂麻将', comment: 'Chinese title - simplified' },
        { name: 'Majsoul', comment: 'Alternative title' },
      ],
    };
    const fetch = async (url: any, init: any) => {
      if (String(url).includes('id.twitch.tv')) {
        return new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }));
      }
      const endpoint = new URL(String(url)).pathname.split('/').pop()!;
      calls.push({ endpoint, body: init.body });
      if (endpoint === 'alternative_names') {
        return new Response(JSON.stringify([{ game: 117263, name: '雀魂麻将' }]));
      }
      if (endpoint === 'game_localizations') return new Response(JSON.stringify([]));
      if (String(init.body).includes('search "雀魂"')) return new Response(JSON.stringify([]));
      return new Response(JSON.stringify([mahjong]));
    };
    const client = createIgdbClient({
      fetch,
      resolve: () => ({ clientId: 'client-id', clientSecret: 'server-secret' }),
    });
    const result: any = await client.search('雀魂');
    const byMainTitle: any = await client.search('Mahjong Soul');
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].igdb_id, 117263);
    assert.equal(result.results[0].title, '雀魂麻将');
    assert.equal(result.results[0].original_title, 'Mahjong Soul');
    assert.equal(byMainTitle.results[0].title, 'Mahjong Soul');
    assert.equal(byMainTitle.results[0].original_title, null);
    assert.ok(calls.some(call => call.endpoint === 'alternative_names' && call.body.includes('name ~ *"雀魂"*')));
    assert.ok(calls.some(call => call.endpoint === 'games' && call.body.includes('id = (117263)')));
  });

  it('相同搜索复用短时缓存，并发重复请求只发送一次 IGDB 查询', async () => {
    let gameCalls = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const fetch = async (url: any, _init: any) => {
      if (String(url).includes('id.twitch.tv')) {
        return new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }));
      }
      gameCalls++;
      if (gameCalls === 1) await firstGate;
      return new Response(JSON.stringify([raw]));
    };
    const client = createIgdbClient({
      fetch,
      resolve: () => ({ clientId: 'client-id', clientSecret: 'server-secret' }),
    });
    const first = client.search('Zelda');
    const second = client.search('zelda');
    releaseFirst();
    const [a, b] = await Promise.all([first, second]);
    const third = await client.search('ZELDA');
    assert.equal(gameCalls, 1);
    assert.equal(a.results[0].igdb_id, 1234);
    assert.deepEqual(b, a);
    assert.deepEqual(third, a);
  });
});
