import request from 'supertest';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import { identityMiddleware } from '../src/middleware/identity.js';
import { viewingMiddleware } from '../src/middleware/viewing.js';

function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.use(identityMiddleware());
  app.use(viewingMiddleware());
  app.get('/probe', (req, res) => res.json({
    user_id: req.user_id,
    viewing_user_id: req.viewing_user_id,
  }));
  return app;
}

describe('viewingMiddleware', () => {
  it('无 as_user 且无 cookie 时 viewing_user_id 为 null', async () => {
    const res = await request(makeApp()).get('/probe');
    assert.equal(res.body.viewing_user_id, null);
  });

  it('cookie=1 无 as_user → viewing_user_id=1', async () => {
    const res = await request(makeApp()).get('/probe').set('Cookie', ['loweve_user_id=1']);
    assert.equal(res.body.viewing_user_id, 1);
  });

  it('cookie=1 + as_user=2 → viewing_user_id=2（as_user 覆盖）', async () => {
    const res = await request(makeApp()).get('/probe?as_user=2').set('Cookie', ['loweve_user_id=1']);
    assert.equal(res.body.user_id, 1);
    assert.equal(res.body.viewing_user_id, 2);
  });

  it('as_user=99 非法 → 忽略，fallback 到 cookie', async () => {
    const res = await request(makeApp()).get('/probe?as_user=99').set('Cookie', ['loweve_user_id=1']);
    assert.equal(res.body.viewing_user_id, 1);
  });

  it('as_user=abc 非数字 → 忽略', async () => {
    const res = await request(makeApp()).get('/probe?as_user=abc').set('Cookie', ['loweve_user_id=2']);
    assert.equal(res.body.viewing_user_id, 2);
  });
});
