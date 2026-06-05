// server/test/identity.test.js
import request from 'supertest';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import { identityMiddleware } from '../src/middleware/identity.js';

function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.use(identityMiddleware());
  app.get('/whoami', (req, res) => res.json({ user_id: req.user_id }));
  return app;
}

describe('identityMiddleware', () => {
  it('无 cookie 时 req.user_id 为 null', async () => {
    const res = await request(makeApp()).get('/whoami');
    assert.equal(res.body.user_id, null);
  });

  it('cookie loweve_user_id=1 → req.user_id=1', async () => {
    const res = await request(makeApp())
      .get('/whoami')
      .set('Cookie', ['loweve_user_id=1']);
    assert.equal(res.body.user_id, 1);
  });

  it('cookie loweve_user_id=2 → req.user_id=2', async () => {
    const res = await request(makeApp())
      .get('/whoami')
      .set('Cookie', ['loweve_user_id=2']);
    assert.equal(res.body.user_id, 2);
  });

  it('cookie 值非 1/2 时视为 null', async () => {
    const res = await request(makeApp())
      .get('/whoami')
      .set('Cookie', ['loweve_user_id=99']);
    assert.equal(res.body.user_id, null);
  });
});
