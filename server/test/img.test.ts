import request from 'supertest';
import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { imgRoutes, parseAllowedUrl } from '../src/routes/img.js';

const tmdb = 'https://image.tmdb.org/t/p/w500/a.jpg';

describe('img 海报代理', () => {
  it('parseAllowedUrl：白名单 host + https 才通过', () => {
    assert.ok(parseAllowedUrl(tmdb));
    assert.ok(parseAllowedUrl('https://lain.bgm.tv/pic/x.jpg'));
    assert.equal(parseAllowedUrl('https://evil.com/a.jpg'), null);      // 非白名单
    assert.equal(parseAllowedUrl('http://image.tmdb.org/a.jpg'), null); // 非 https
    assert.equal(parseAllowedUrl('not a url'), null);
    assert.equal(parseAllowedUrl(''), null);
  });

  function appWith(fetch, dir) {
    const app = express();
    app.use('/api/img', imgRoutes({ fetch, dir }));
    return app;
  }

  it('非法/非白名单 → 400，不发起 fetch', async () => {
    const app = appWith(async () => { throw new Error('should not fetch'); }, '/tmp/never');
    assert.equal((await request(app).get('/api/img?u=' + encodeURIComponent('https://evil.com/a.jpg'))).status, 400);
    assert.equal((await request(app).get('/api/img')).status, 400);
  });

  it('首次拉取并缓存，二次命中缓存不再 fetch', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-'));
    let calls = 0;
    const fetch = async () => { calls++; return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; };
    const app = appWith(fetch, dir);
    const u = '/api/img?u=' + encodeURIComponent(tmdb);
    const r1 = await request(app).get(u);
    assert.equal(r1.status, 200);
    assert.equal(r1.headers['content-type'], 'image/jpeg');
    assert.match(r1.headers['cache-control'], /immutable/);
    assert.equal(calls, 1);
    const r2 = await request(app).get(u);
    assert.equal(r2.status, 200);
    assert.equal(calls, 1);   // 命中磁盘缓存，没再 fetch
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('上游失败 → 502', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-'));
    const app = appWith(async () => ({ ok: false, status: 404 }), dir);
    const r = await request(app).get('/api/img?u=' + encodeURIComponent(tmdb));
    assert.equal(r.status, 502);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
