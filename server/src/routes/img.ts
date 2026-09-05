// 海报代理 + 磁盘缓存：前端所有外链海报走 /api/img?u=<编码URL>。
// 服务器去拉 CDN（服务器能连 image.tmdb.org / lain.bgm.tv），落盘缓存，再吐给浏览器——
// 这样没梯子的访客也能看到海报（首次即可，之后命中缓存）。
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths } from '../config.js';

const ALLOW = new Set([
  'image.tmdb.org', 'lain.bgm.tv',
  'img1.doubanio.com', 'img2.doubanio.com', 'img3.doubanio.com',
  'img9.doubanio.com',
  'shared.fastly.steamstatic.com', 'shared.akamai.steamstatic.com',
  'cdn.cloudflare.steamstatic.com', 'steamcdn-a.akamaihd.net',
  'images.igdb.com',
]);   // 白名单，防 SSRF
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

// 仅允许 https + 白名单 host；返回 URL 或 null
export function parseAllowedUrl(u: any) {
  if (typeof u !== 'string' || !u) return null;
  let url: any;
  try { url = new URL(u); } catch { return null; }
  if (url.protocol !== 'https:' || !ALLOW.has(url.hostname)) return null;
  return url;
}

export function imgRoutes({ fetch = globalThis.fetch, dir = path.join(paths.posterDir, 'proxy') }: { fetch?: any; dir?: string } = {}) {
  const router = Router();

  router.get('/', async (req, res) => {
    const u = req.query.u as string;
    const url = parseAllowedUrl(u);
    if (!url) return res.status(400).json({ error: 'bad_url' });

    let ext = path.extname(url.pathname).toLowerCase();
    if (!TYPES[ext as keyof typeof TYPES]) ext = '.jpg';
    const key = crypto.createHash('sha1').update(u).digest('hex');
    const file = path.join(dir, key + ext);

    const send = () => {
      res.set('Content-Type', TYPES[ext as keyof typeof TYPES]);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      fs.createReadStream(file).pipe(res);
    };

    if (fs.existsSync(file)) return send();

    try {
      const r = await fetch(url.href, { headers: { 'User-Agent': UA, Referer: url.origin + '/' } });
      if (!r.ok) return res.status(502).json({ error: 'upstream', status: r.status });
      const buf = Buffer.from(await r.arrayBuffer());
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, buf);
      send();
    } catch (e) {
      res.status(502).json({ error: 'fetch_failed', message: e.message });
    }
  });

  return router;
}
