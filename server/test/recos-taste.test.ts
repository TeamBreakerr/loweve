// server/test/recos-taste.test.js
import assert from 'node:assert/strict';
import { tasteProfileLines } from '../src/recos/taste.js';

const g = (...names: string[]) => JSON.stringify(names);
const base = { userA: 'Alice', userB: 'Bob', marksA: [], marksB: [], sessions: [] };
const mark = (genres: string, rating: number | null, is_anime = 0) => ({ genres, is_anime, rating, status: 'watched' });

describe('recos/taste tasteProfileLines', () => {
  it('样本不足（<3 部）不成方向', () => {
    const lines = tasteProfileLines({ ...base, marksA: [mark(g('科幻'), 10), mark(g('科幻'), 9)] });
    assert.deepEqual(lines, []);
  });

  it('≥3 部且均分≥8 → 偏爱，中置信；≥6 部 → 高置信', () => {
    const marksA = [...Array(3)].map(() => mark(g('科幻'), 9));
    const marksB = [...Array(6)].map(() => mark(g('悬疑'), 8));
    const lines = tasteProfileLines({ ...base, marksA, marksB }).join('\n');
    assert.match(lines, /Alice 偏爱：科幻（均9\.0分×3部，中置信）/);
    assert.match(lines, /Bob 偏爱：悬疑（均8\.0分×6部，高置信）/);
  });

  it('常看（≥5部）但均分<7 → 爱看但常踩雷，绝不判成讨厌题材', () => {
    const lines = tasteProfileLines({ ...base, marksA: [...Array(7)].map(() => mark(g('恐怖'), 5)) }).join('\n');
    assert.match(lines, /Alice 爱看但常踩雷（对题材有兴趣，只是老挑到烂片）：恐怖（均5\.0分×7部，高置信）/);
    assert.doesNotMatch(lines, /不对味/);
  });

  it('低分但看得少（<5部）→ 不成任何方向（兴趣与雷都证据不足）', () => {
    const lines = tasteProfileLines({ ...base, marksA: [...Array(4)].map(() => mark(g('爱情'), 4)) });
    assert.deepEqual(lines, []);
  });

  it('无评分的 mark 不计入样本', () => {
    const lines = tasteProfileLines({ ...base, marksA: [...Array(5)].map(() => mark(g('科幻'), null))});
    assert.deepEqual(lines, []);
  });

  it('sessions 各自评分计入各自画像；共同方向按两人中较低分统计', () => {
    const s = (a: number | null, b: number | null) => ({ genres: g('爱情'), is_anime: 0, rating_a: a, rating_b: b });
    const lines = tasteProfileLines({ ...base, sessions: [s(9, 8), s(10, 8), s(9, 9)] }).join('\n');
    assert.match(lines, /Alice 偏爱：爱情（均9\.3分×3部，中置信）/);
    assert.match(lines, /Bob 偏爱：爱情（均8\.3分×3部，中置信）/);
    assert.match(lines, /两人一起看时都满意（按两人中较低分统计）：爱情（均8\.3分×3部，中置信）/);   // min: 8,8,9
  });

  it('两人较低分不到 8 → 不进共同方向（哪怕单方很爱）', () => {
    const s = () => ({ genres: g('动作'), is_anime: 0, rating_a: 10, rating_b: 6 });
    const lines = tasteProfileLines({ ...base, sessions: [s(), s(), s()] }).join('\n');
    assert.doesNotMatch(lines, /两人一起看时都满意/);
    assert.match(lines, /Alice 偏爱：动作/);
  });

  it('番剧作为伪题材参与统计', () => {
    const lines = tasteProfileLines({ ...base, marksA: [...Array(3)].map(() => mark(g('奇幻'), 9, 1)) }).join('\n');
    assert.match(lines, /番剧（均9\.0分×3部，中置信）/);
  });

  it('genres 脏数据/缺失不报错', () => {
    const lines = tasteProfileLines({ ...base, marksA: [mark('not json', 9), { rating: 8, status: 'watched' }] });
    assert.deepEqual(lines, []);
  });
});
