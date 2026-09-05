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

  it('hotReviews 保持官方吐槽页默认顺序，点赞数只作为附加信息', async () => {
    let requested = '';
    const fakeFetch = async (url: any) => {
      requested = String(url);
      return {
        ok: true, status: 200, text: async () => `
          <div id="comment_box">
            <div class="item clearit" data-item-user="u1">
              <a href="/user/u1" class="avatar"><span style="background-image:url('//lain.bgm.tv/a.jpg')"></span></a>
              <a href="/user/u1" class="l">甲&amp;一</a>
              <span class="starlight stars9"></span>
              <p class="comment">演出&lt;太棒&gt;了</p><div class="likes_grid" id="likes_grid_11"></div>
            </div>
            <div class="item clearit" data-item-user="u2">
              <a href="/user/u2" class="l">乙</a><span class="starlight stars8"></span>
              <p class="comment">音乐很好<br>值得重听</p><div class="likes_grid" id="likes_grid_12"></div>
            </div>
            <div class="item clearit" data-item-user="u3">
              <a href="/user/u3" class="l">丙</a><span class="starlight stars7"></span>
              <p class="comment">值得一看</p><div class="likes_grid" id="likes_grid_13"></div>
            </div>
            <div class="item clearit" data-item-user="u4">
              <a href="/user/u4" class="l">丁</a><p class="comment">第四条</p>
              <div class="likes_grid" id="likes_grid_14"></div>
            </div>
          </div>
          <script>
            var data_likes_list = {
              "11":{"1":{"total":5}},
              "12":{"1":{"total":18},"2":{"total":2}},
              "13":{"1":{"total":9}},
              "14":{}
            };
          </script>`,
        };
    };
    const reviews = await createBangumiClient({ userAgent: 'X', fetch: fakeFetch }).hotReviews(328609, 3);
    assert.equal(requested, 'https://bgm.tv/subject/328609/comments');
    assert.equal(reviews.length, 3);
    assert.deepEqual(reviews[0], {
      id: '11', author: '甲&一', avatar_url: 'https://lain.bgm.tv/a.jpg', content: '演出<太棒>了', rating: 9,
      votes: 5, created_at: null, url: 'https://bgm.tv/subject/328609/comments',
    });
    assert.equal(reviews[1]!.id, '12');
    assert.equal(reviews[1]!.votes, 20);
    assert.equal(reviews[2]!.id, '13');
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

  it('续作未播（year=null，名称更贴）也不误配到正作 —— 复现「赛博朋克边缘行者→2」', () => {
    const candidates = [
      cand({ bangumi_id: 10, name: 'サイバーパンク: エッジランナーズ２', name_cn: '赛博朋克：边缘行者 2', year: null, score: 9.3 }),
      cand({ bangumi_id: 11, name: 'Cyberpunk: Edgerunners', name_cn: '赛博浪客', year: 2022, score: 8.3 }),
    ];
    const best = matchAnime(
      { title: '赛博朋克：边缘行者', original_title: 'サイバーパンク: エッジランナーズ', year: 2022 },
      candidates
    );
    assert.notEqual(best?.bangumi_id, 10);  // 绝不能选中「2」续作
  });

  it('靠英文名/AKA 命中：中/日文都对不上、但英文名能对上（边缘行者拿到正作）', () => {
    const candidates = [
      cand({ bangumi_id: 20, name: 'Cyberpunk: Edgerunners', name_cn: '赛博浪客', year: 2022, score: 8.3 }),
    ];
    // 只有 title/original_title 时名称分太低 → 不会命中；names 里带上英文名后命中
    const noNames = matchAnime({ title: '赛博朋克：边缘行者', original_title: 'サイバーパンク: エッジランナーズ', year: 2022 }, candidates);
    assert.equal(noNames, null);
    const withNames = matchAnime({
      title: '赛博朋克：边缘行者', original_title: 'サイバーパンク: エッジランナーズ',
      names: ['サイバーパンク: エッジランナーズ', '赛博朋克：边缘行者', 'Cyberpunk: Edgerunners'], year: 2022,
    }, candidates);
    assert.equal(withNames?.bangumi_id, 20);
  });

  it('真要找续作 2 时，季号对上才命中', () => {
    const candidates = [
      cand({ bangumi_id: 10, name: 'サイバーパンク: エッジランナーズ２', name_cn: '赛博朋克：边缘行者 2', year: null }),
    ];
    const best = matchAnime(
      { title: '赛博朋克：边缘行者2', original_title: 'サイバーパンク: エッジランナーズ2', year: 2026 },
      candidates
    );
    assert.equal(best?.bangumi_id, 10);
  });

  it('日文标题末尾大写 S 识别为第二季', () => {
    const best = matchAnime(
      {
        title: '小林家的龙女仆 第二季',
        original_title: '小林さんちのメイドラゴン',
        names: ['小林さんちのメイドラゴン', '小林家的龙女仆 第二季', 'Miss Kobayashi\'s Dragon Maid S'],
        year: 2021,
        season_number: 2,
      },
      [cand({
        bangumi_id: 274234,
        name: '小林さんちのメイドラゴンS',
        name_cn: '小林家的龙女仆S',
        year: 2021,
      })]
    );
    assert.equal(best?.bangumi_id, 274234);
  });

  it('英文 AKA 可命中 Vivy 与 Redline 等中文译名不同的动画', () => {
    const vivy = matchAnime(
      {
        title: '薇薇 -萤石眼之歌-',
        original_title: 'Vivy -Fluorite Eye\'s Song-',
        names: ['Vivy -Fluorite Eye\'s Song-', '薇薇 -萤石眼之歌-', 'Vivy'],
        year: 2021,
      },
      [cand({ bangumi_id: 282241, name: 'Vivy -Fluorite Eye\'s Song-', name_cn: 'Vivy -Fluorite Eye\'s Song-', year: 2021 })]
    );
    assert.equal(vivy?.bangumi_id, 282241);

    const redline = matchAnime(
      { title: '红线', original_title: 'レッドライン', names: ['レッドライン', '红线', 'Redline'], year: 2009 },
      [cand({ bangumi_id: 8726, name: 'REDLINE', name_cn: '红线', year: 2009 })]
    );
    assert.equal(redline?.bangumi_id, 8726);
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
