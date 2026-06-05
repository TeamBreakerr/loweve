// server/test/me.test.js
import request from 'supertest';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { makeTestDb } from './helpers.js';

describe('GET /api/me', () => {
  let app, db;
  beforeEach(() => { db = makeTestDb({ userA: '小爱', userB: '小波' }); app = createApp({ db }); });
  afterEach(() => db.close());

  it('未设置 cookie 时返回 user_id=null + 两个用户的元数据', async () => {
    const res = await request(app).get('/api/me');
    assert.equal(res.status, 200);
    assert.equal(res.body.user_id, null);
    assert.deepEqual(res.body.users, [
      { id: 1, display_name: '小爱', avatar: null },
      { id: 2, display_name: '小波', avatar: null },
    ]);
  });

  it('cookie=1 时返回 user_id=1', async () => {
    const res = await request(app).get('/api/me').set('Cookie', ['loweve_user_id=1']);
    assert.equal(res.body.user_id, 1);
  });
});

describe('POST /api/me/switch', () => {
  let app, db;
  beforeEach(() => { db = makeTestDb(); app = createApp({ db }); });
  afterEach(() => db.close());

  it('合法 user_id=2 → 设置 cookie + 返回新身份', async () => {
    const res = await request(app)
      .post('/api/me/switch')
      .send({ user_id: 2 });
    assert.equal(res.status, 200);
    assert.equal(res.body.user_id, 2);
    const setCookie = (res.headers['set-cookie'] as any).join(';');
    assert.match(setCookie, /loweve_user_id=2/);
    assert.match(setCookie, /Max-Age=2592000/);  // 30d
  });

  it('非法 user_id → 400', async () => {
    const res = await request(app).post('/api/me/switch').send({ user_id: 99 });
    assert.equal(res.status, 400);
  });

  it('缺 body → 400', async () => {
    const res = await request(app).post('/api/me/switch').send({});
    assert.equal(res.status, 400);
  });
});
