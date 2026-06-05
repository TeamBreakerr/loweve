// server/test/health.test.js
import request from 'supertest';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { makeTestDb } from './helpers.js';

describe('GET /api/health', () => {
  let app, db;
  beforeEach(() => {
    db = makeTestDb();
    app = createApp({ db });
  });
  afterEach(() => db.close());

  it('返回 200 + ok=true + db status', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.db, 'ok');
    assert.ok(typeof res.body.browser === 'string'); // 'unknown' | 'ok' | 'down'
  });
});
