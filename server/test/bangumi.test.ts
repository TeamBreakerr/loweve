import assert from 'node:assert/strict';
import { createBangumiClient, BangumiError } from '../src/bangumi/client.js';

describe('createBangumiClient', () => {
  it('isConfigured 始终 true（有 UA）', () => {
    const c = createBangumiClient({ userAgent: 'loweve/0.1', fetch: async () => {} });
    assert.equal(c.isConfigured(), true);
  });

  it('searchAnime: POST /v0/search/subjects with type=[2] + UA header', async () => {
    let captured: any;
    const fakeFetch = async (url: any, opts: any) => {
      captured = { url, opts };
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };
    const c = createBangumiClient({ userAgent: 'loweve/0.1', fetch: fakeFetch });
    await c.searchAnime('孤独摇滚');
    assert.match(captured.url, /api\.bgm\.tv\/v0\/search\/subjects/);
    assert.equal(captured.opts.method, 'POST');
    assert.equal(captured.opts.headers['User-Agent'], 'loweve/0.1');
    const body = JSON.parse(captured.opts.body);
    assert.equal(body.keyword, '孤独摇滚');
    assert.deepEqual(body.filter.type, [2]);
  });

  it('searchAnime: 映射 id/name/name_cn/year/score/votes/poster_url', async () => {
    const fakeFetch = async () => ({
      ok: true, status: 200, json: async () => ({
        data: [{
          id: 328609, name: 'ぼっち・ざ・ろっく！', name_cn: '孤独摇滚！',
          date: '2022-10-08', rating: { score: 8.4, total: 39589 },
          images: { large: 'https://lain.bgm.tv/pic/cover/l/abc.jpg' },
        }],
      }),
    });
    const c = createBangumiClient({ userAgent: 'X', fetch: fakeFetch });
    const r = await c.searchAnime('孤独摇滚');
    assert.equal(r.length, 1);
    assert.deepEqual(r[0], {
      bangumi_id: 328609,
      name: 'ぼっち・ざ・ろっく！',
      name_cn: '孤独摇滚！',
      year: 2022,
      score: 8.4,
      votes: 39589,
      poster_url: 'https://lain.bgm.tv/pic/cover/l/abc.jpg',
    });
  });

  it('searchAnime: date 缺失 → year null；rating/images 缺失 → null', async () => {
    const fakeFetch = async () => ({
      ok: true, status: 200, json: async () => ({ data: [{ id: 1, name: 'X', date: null }] }),
    });
    const c = createBangumiClient({ userAgent: 'X', fetch: fakeFetch });
    const r = await c.searchAnime('x');
    assert.equal(r[0].year, null);
    assert.equal(r[0].score, null);
    assert.equal(r[0].votes, null);
    assert.equal(r[0].poster_url, null);
  });

  it('5xx → 抛 BangumiError（不重试）', async () => {
    let calls = 0;
    const fakeFetch = async () => { calls++; return { ok: false, status: 502, json: async () => ({}) }; };
    const c = createBangumiClient({ userAgent: 'X', fetch: fakeFetch });
    await assert.rejects(() => c.searchAnime('x'), BangumiError);
    assert.equal(calls, 1);  // 不重试
  });

  it('网络错 → 抛 BangumiError', async () => {
    const fakeFetch = async () => { throw new Error('ECONNRESET'); };
    const c = createBangumiClient({ userAgent: 'X', fetch: fakeFetch });
    await assert.rejects(() => c.searchAnime('x'), BangumiError);
  });
});

import { matchAnime, similarity } from '../src/bangumi/matcher.js';

describe('similarity', () => {
  it('完全相同 = 1', () => assert.equal(similarity('abc', 'abc'), 1));
  it('完全不同接近 0', () => assert.ok(similarity('abc', 'xyz') < 0.4));
  it('空串安全', () => assert.equal(similarity('', ''), 1));
});

describe('matchAnime', () => {
  const cand = (over = {}) => ({
    bangumi_id: 1, name: 'ぼっち・ざ・ろっく！', name_cn: '孤独摇滚！',
    year: 2022, score: 8.4, votes: 39589, poster_url: 'x', ...over,
  });

  it('原名完全匹配 + 年份相等 → 命中', () => {
    const best = matchAnime(
      { title: '孤独摇滚！', original_title: 'ぼっち・ざ・ろっく！', year: 2022 },
      [cand()]
    );
    assert.ok(best);
    assert.equal(best.bangumi_id, 1);
  });

  it('续作：名称多「第二季」+ 年份不符 → 不误配（返回正作或 null）', () => {
    const candidates = [
      cand({ bangumi_id: 1, year: 2022 }),  // 正作
      cand({ bangumi_id: 2, name: 'ぼっち・ざ・ろっく！ 第2期', name_cn: '孤独摇滚！第二季', year: 2026 }),
    ];
    const best = matchAnime(
      { title: '孤独摇滚！', original_title: 'ぼっち・ざ・ろっく！', year: 2022 },
      candidates
    );
    assert.equal(best.bangumi_id, 1);  // 选中年份/名称都最贴的正作
  });

  it('名称差太远（蒙年份）→ null', () => {
    const best = matchAnime(
      { title: '完全不同的番', original_title: 'totally different', year: 2022 },
      [cand({ name: 'まったく違う', name_cn: '风马牛不相及' })]
    );
    assert.equal(best, null);
  });

  it('年份差 1 仍可命中（名称够像）', () => {
    const best = matchAnime(
      { title: '孤独摇滚！', original_title: 'ぼっち・ざ・ろっく！', year: 2023 },
      [cand({ year: 2022 })]
    );
    assert.ok(best);
  });

  it('空候选 → null', () => {
    assert.equal(matchAnime({ title: 'x', original_title: 'x', year: 2020 }, []), null);
  });

  it('TMDB 无 original_title 时用 title 匹配 name_cn', () => {
    const best = matchAnime(
      { title: '孤独摇滚！', original_title: null, year: 2022 },
      [cand()]
    );
    assert.ok(best);  // title vs name_cn 相似度高
  });
});
