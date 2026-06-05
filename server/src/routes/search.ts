// server/src/routes/search.js
import { Router } from 'express';
import { mergeDedupe } from '../tmdb/client.js';

export function searchRoutes() {
  const router = Router();

  router.get('/', async (req, res) => {
    const tmdb = req.app.locals.tmdb;
    const q = ((req.query.q as string) || '').trim();
    if (!q) return res.status(400).json({ error: 'missing_query' });
    if (!tmdb.isConfigured()) return res.status(503).json({ error: 'tmdb_not_configured' });
    try {
      let { results } = await tmdb.search(q);
      // 组合查兜底：结果稀疏且含空格（如「恋之罪 园子温」片名+导演）→ 拆词分别搜再合并
      if (results.length < 3 && /\s/.test(q)) {
        const tokens = q.split(/\s+/).filter(t => t.length >= 2).slice(0, 3);
        const extra = await Promise.all(tokens.map(t => tmdb.search(t).catch(() => ({ results: [] }))));
        results = mergeDedupe(results, ...extra.map(e => e.results)).slice(0, 30);
      }
      res.json({ results });
    } catch (e) {
      const code = e.code || 'tmdb_unknown';
      res.status(502).json({ error: code, message: e.message });
    }
  });

  return router;
}
