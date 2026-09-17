// 榜单添加：GET /api/charts/:chart?page=N 榜单页（带本地状态）；POST /api/charts/resolve 条目 → TMDB 候选
import { Router } from 'express';
import { CHARTS, getChartPage, isChartKey, resolveChartItem } from './service.js';

export function chartsRoutes() {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ charts: (Object.keys(CHARTS) as (keyof typeof CHARTS)[]).map(key => ({ key, label: CHARTS[key].label, source: CHARTS[key].source, page_size: CHARTS[key].pageSize })) });
  });

  router.get('/:chart', async (req, res) => {
    const chart = req.params.chart;
    if (!isChartKey(chart)) return res.status(404).json({ error: 'unknown_chart' });
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    try {
      res.json(await getChartPage(req.app.locals.db, { douban: req.app.locals.douban, bangumi: req.app.locals.bangumi }, { chart, page, viewingUserId: req.viewing_user_id ?? null }));
    } catch (e) {
      res.status(502).json({ error: e?.code || 'chart_unavailable', message: e?.message });
    }
  });

  router.post('/resolve', async (req, res) => {
    const body = req.body || {};
    if (!body.source_id || !body.title) return res.status(400).json({ error: 'invalid_item' });
    if (!req.app.locals.tmdb?.isConfigured?.()) return res.status(503).json({ error: 'tmdb_not_configured' });
    try {
      const candidate = await resolveChartItem(req.app.locals.db, { tmdb: req.app.locals.tmdb }, body);
      if (!candidate) return res.status(404).json({ error: 'tmdb_not_found' });
      res.json({ candidate });
    } catch (e) {
      res.status(502).json({ error: e?.code || 'tmdb_unknown', message: e?.message });
    }
  });

  return router;
}
