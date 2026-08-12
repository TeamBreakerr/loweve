// server/test/recos-validate.test.js
import assert from 'node:assert/strict';
import { resolveTmdb } from '../src/recos/validate.js';
import { makeFakeTmdb } from './helpers.js';

const RES = (results: any) => makeFakeTmdb({ search: async () => ({ results }) });

describe('recos/validate resolveTmdb', () => {
  it('标题+年份命中', async () => {
    const tmdb = RES([
      { tmdb_id: 11, tmdb_type: 'movie', title: '爱在黎明破晓前', original_title: 'Before Sunrise', year: 1995 },
    ]);
    assert.deepEqual(await resolveTmdb(tmdb, { title: '爱在黎明破晓前', year: 1995, type: 'movie' }),
      { tmdb_id: 11, tmdb_type: 'movie' });
  });

  it('原名命中（中文标题对不上但原名对得上）', async () => {
    const tmdb = RES([
      { tmdb_id: 22, tmdb_type: 'movie', title: '怦然心动', original_title: 'Flipped', year: 2010 },
    ]);
    assert.deepEqual(await resolveTmdb(tmdb, { title: 'Flipped', year: 2010, type: 'movie' }),
      { tmdb_id: 22, tmdb_type: 'movie' });
  });

  it('搜不到 → null', async () => {
    assert.equal(await resolveTmdb(RES([]), { title: '不存在的片', year: 2099, type: 'movie' }), null);
  });

  it('名称完全不相关 → null（阈值挡住）', async () => {
    const tmdb = RES([
      { tmdb_id: 99, tmdb_type: 'movie', title: '完全无关的电影', original_title: 'Totally Unrelated', year: 1995 },
    ]);
    assert.equal(await resolveTmdb(tmdb, { title: '爱在黎明破晓前', year: 1995, type: 'movie' }), null);
  });

  it('候选无年份（疑似 stub/软幻觉）→ null', async () => {
    const tmdb = RES([
      { tmdb_id: 77, tmdb_type: 'movie', title: '续·穿越时空的少女', original_title: '续·穿越时空的少女', year: null },
    ]);
    assert.equal(await resolveTmdb(tmdb, { title: '续·穿越时空的少女', year: null, type: 'movie' }), null);
  });

  it('「剧名 第N季」剥掉季号按剧名搜索并可命中', async () => {
    let query: any = null;
    const tmdb = makeFakeTmdb({ search: async (q: any) => { query = q; return { results: [
      { tmdb_id: 66, tmdb_type: 'tv', title: '怪奇物语', original_title: 'Stranger Things', year: 2016 },
    ] }; } });
    const out = await resolveTmdb(tmdb, { title: '怪奇物语 第三季', year: 2019, type: 'tv' });
    assert.equal(query, '怪奇物语');
    assert.deepEqual(out, { tmdb_id: 66, tmdb_type: 'tv' });
  });

  it('年份差太多降权，但名称完全一致仍可命中', async () => {
    const tmdb = RES([
      { tmdb_id: 33, tmdb_type: 'tv', title: '孤独摇滚！', original_title: 'ぼっち・ざ・ろっく！', year: 2022 },
    ]);
    const out = await resolveTmdb(tmdb, { title: '孤独摇滚！', year: 2021, type: 'tv' });
    assert.deepEqual(out, { tmdb_id: 33, tmdb_type: 'tv' });
  });
});
