// server/test/recos-prompt.test.js
import assert from 'node:assert/strict';
import { buildMessages } from '../src/recos/prompt.js';

const base = {
  userA: 'Alice', userB: 'Bob',
  marksA: [
    { title: '爱的曝光', year: 2008, status: 'watched', rating: 9, comment: '太好哭了' },
    { title: '无感片', year: 2010, status: 'watched', rating: null, comment: null },   // 无评分无短评 → 不进推荐理由
  ],
  marksB: [{ title: '寄生兽', year: 2014, status: 'watched', rating: 7 }],
  sessions: [
    { title: '花束般的恋爱', year: 2021, rating_a: 8, rating_b: 9, review_a: '节奏慢但耐看', review_b: '我超爱', joint_note: '哭了' },
    { title: '没记感想', year: 2000, rating_a: null, rating_b: null, review_a: null, review_b: null, joint_note: null }, // 无信号 → 不进
  ],
  plan: [{ title: '海街日记', year: 2015 }],
  avoidTitles: ['某烂片'],
  userPrompt: null,
};

describe('recos/prompt buildMessages', () => {
  it('含 system + user 两条', () => {
    const msgs = buildMessages(base);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'system');
    assert.equal(msgs[1].role, 'user');
  });

  it('user 内容含双方名字/看过/想看就一起看/避雷池', () => {
    const u = buildMessages(base)[1].content;
    assert.match(u, /Alice/);
    assert.match(u, /Bob/);
    assert.match(u, /爱的曝光/);
    assert.match(u, /寄生兽/);          // Bob 看过（有评分）
    assert.match(u, /花束般的恋爱/);
    assert.match(u, /想看就一起看/);     // 共同清单已改名
    assert.match(u, /海街日记/);
    assert.match(u, /某烂片/);          // 避雷池
    assert.match(u, /JSON/i);           // 输出格式要求
    assert.match(u, /推荐 15 部/);       // 首轮留足硬过滤缓冲，最终仍只展示 9 条
    assert.match(u, /Alice评8/);        // 一起看过用名字标注双方评分，而非 A评/B评
    assert.doesNotMatch(u, /（A）|（B）|A评|B评/);  // 不再用 A/B 标签
  });

  it('个人短评 + 一起看过的各自短评都喂给模型', () => {
    const u = buildMessages(base)[1].content;
    assert.match(u, /短评「太好哭了」/);     // 个人看过的短评（comment）
    assert.match(u, /节奏慢但耐看/);          // 一起看过 review_a
    assert.match(u, /我超爱/);                // 一起看过 review_b
  });

  it('无评分无短评的记录排除出推荐理由（但仍在避雷池硬过滤里）', () => {
    const u = buildMessages(base)[1].content;
    assert.doesNotMatch(u, /无感片/);   // 个人看过但没打分没写短评 → 不喂
    assert.doesNotMatch(u, /没记感想/); // 一起看过但毫无信号 → 不喂
  });

  it('system 指示用名字而非 A/B 称呼', () => {
    const sys = buildMessages(base)[0].content;
    assert.match(sys, /Alice/);
    assert.match(sys, /Bob/);
    assert.match(sys, /不要用 A\/B/);
  });

  it('评分样本充足时注入口味画像与画像指令', () => {
    const scifi = (r: number) => ({ title: 'x', year: 2020, status: 'watched', rating: r, genres: '["科幻"]', is_anime: 0 });
    const u = buildMessages({ ...base, marksA: [scifi(9), scifi(9), scifi(10)] })[1].content;
    assert.match(u, /口味画像/);
    assert.match(u, /Alice 偏爱：科幻（均9\.3分×3部，中置信）/);
    assert.match(u, /高置信方向/);   // 画像使用指令
  });

  it('样本不足时不出现画像段', () => {
    const u = buildMessages(base)[1].content;   // base 里无 genres 字段、评分样本也不够
    assert.doesNotMatch(u, /口味画像/);
  });

  it('userPrompt 注入额外要求', () => {
    const u = buildMessages({ ...base, userPrompt: '90分钟内的轻松治愈片' })[1].content;
    assert.match(u, /90分钟内的轻松治愈片/);
  });

  it('原始历史只保留近期代表样本，避免真实数据持续放大推理耗时', () => {
    const many = [...Array(20)].map((_, i) => ({
      title: `历史${i}`, year: 2020, status: 'watched', rating: 8, comment: `短评${i}`,
    }));
    const u = buildMessages({ ...base, marksA: many })[1].content;
    assert.match(u, /历史0/);
    assert.match(u, /历史11/);
    assert.doesNotMatch(u, /历史12/);
  });

  it('空数据不报错', () => {
    const msgs = buildMessages({ userA: 'Alice', userB: 'Bob', marksA: [], marksB: [], sessions: [], plan: [], avoidTitles: [], userPrompt: null });
    assert.equal(msgs.length, 2);
  });
});
