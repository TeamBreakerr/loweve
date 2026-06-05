import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cachePoster } from '../src/posters/cache.js';

describe('cachePoster', () => {
  let dir: any;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loweve-posters-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('downloads a poster once and returns same-origin API URL', async () => {
    let captured: any;
    const fetch = async (url: any, opts: any) => {
      captured = { url, opts };
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'image/webp']]),
        arrayBuffer: async () => Buffer.from('poster-bytes'),
      };
    };

    const localUrl = await cachePoster({
      source: 'douban',
      id: '2361266',
      url: 'https://img9.doubanio.com/view/photo/s_ratio_poster/public/p575424244.webp',
      referer: 'https://movie.douban.com/subject/2361266/',
      posterDir: dir,
      fetch,
    });

    assert.equal(localUrl, '/api/posters/douban/2361266.webp');
    assert.equal(captured.url, 'https://img9.doubanio.com/view/photo/s_ratio_poster/public/p575424244.webp');
    assert.equal(captured.opts.headers.Referer, 'https://movie.douban.com/subject/2361266/');
    assert.equal(fs.readFileSync(path.join(dir, 'douban', '2361266.webp'), 'utf8'), 'poster-bytes');
  });

  it('uses the cached file without fetching again', async () => {
    fs.mkdirSync(path.join(dir, 'douban'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'douban', '2361266.webp'), 'cached');
    let fetched = false;

    const localUrl = await cachePoster({
      source: 'douban',
      id: '2361266',
      url: 'https://img9.doubanio.com/view/photo/s_ratio_poster/public/p575424244.webp',
      posterDir: dir,
      fetch: async () => { fetched = true; throw new Error('should not fetch'); },
    });

    assert.equal(localUrl, '/api/posters/douban/2361266.webp');
    assert.equal(fetched, false);
  });
});
