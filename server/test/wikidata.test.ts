import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { createWikidataClient } from '../src/wikidata/client.js';

describe('Wikidata 游戏别名客户端', () => {
  it('只保留实体类型为电子游戏的多语言标题', async () => {
    const calls: string[] = [];
    const fetch = async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('wbsearchentities')) return new Response(JSON.stringify({
        search: [{ id: 'Q17185964' }, { id: 'Q999' }],
      }), { status: 200 });
      return new Response(JSON.stringify({ entities: {
        Q17185964: {
          labels: {
            en: { value: 'The Legend of Zelda: Breath of the Wild' },
            'zh-cn': { value: '塞尔达传说 旷野之息' },
          },
          claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q7889' } } } }] },
        },
        Q999: {
          labels: { en: { value: 'Not a game' } },
          claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }] },
        },
      } }), { status: 200 });
    };
    const aliases = await createWikidataClient({ fetch }).searchGameAliases('荒野之息');
    assert.equal(calls.length, 2);
    assert.deepEqual(aliases, [{
      id: 'Q17185964', localized_title: '塞尔达传说 旷野之息',
      lookup_titles: ['The Legend of Zelda: Breath of the Wild', '塞尔达传说 旷野之息'],
    }]);
  });
});
