// server/test/users.test.js
import request from 'supertest';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { makeTestDb } from './helpers.js';

describe('PATCH /api/users/:id', () => {
  let app: any, db: any;
  beforeEach(() => { db = makeTestDb({ userA: '小爱', userB: '小波' }); app = createApp({ db }); });
  afterEach(() => db.close());

  it('改 id=1 成功并返回新对象', async () => {
    const res = await request(app)
      .patch('/api/users/1')
      .send({ display_name: 'Alice' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { id: 1, display_name: 'Alice', avatar: null });
    // 验证库里也改了
    const row = db.prepare('SELECT display_name FROM users WHERE id = 1').get();
    assert.equal(row.display_name, 'Alice');
  });

  it('改 id=2 成功', async () => {
    const res = await request(app).patch('/api/users/2').send({ display_name: 'Bob' });
    assert.equal(res.status, 200);
    assert.equal(res.body.display_name, 'Bob');
  });

  it('非法 id 返回 400', async () => {
    const res = await request(app).patch('/api/users/99').send({ display_name: 'x' });
    assert.equal(res.status, 400);
  });

  it('缺 display_name 返回 400', async () => {
    const res = await request(app).patch('/api/users/1').send({});
    assert.equal(res.status, 400);
  });

  it('空白字符串 display_name 返回 400', async () => {
    const res = await request(app).patch('/api/users/1').send({ display_name: '   ' });
    assert.equal(res.status, 400);
  });

  it('display_name 自动 trim', async () => {
    const res = await request(app).patch('/api/users/1').send({ display_name: '  spacy  ' });
    assert.equal(res.status, 200);
    assert.equal(res.body.display_name, 'spacy');
  });

  it('过长 display_name (>50) 返回 400', async () => {
    const res = await request(app).patch('/api/users/1').send({ display_name: 'x'.repeat(51) });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'display_name_too_long');
  });
});
