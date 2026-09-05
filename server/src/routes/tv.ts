// server/src/routes/tv.js
// GET /api/tv/:id/seasons —— 列出某剧的可追踪季（排除 Specials/第0季）。
import { Router } from 'express';

export function tvRoutes() {
  const router = Router();

  router.get('/:id/seasons', async (req, res) => {
    const tmdb = req.app.locals.tmdb;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });
    if (!tmdb.isConfigured()) return res.status(503).json({ error: 'tmdb_not_configured' });
    try {
      const detail = await tmdb.tvDetail(id);
      const seasons = (detail.seasons || [])
        .filter((s: any) => Number.isInteger(s.season_number) && s.season_number >= 1)
        .map((s: any) => ({
          season_number: s.season_number,
          name: s.name || `第 ${s.season_number} 季`,
          year: parseInt((s.air_date || '').slice(0, 4), 10) || null,
          poster_path: s.poster_path || null,
          episode_count: s.episode_count || null,
        }));
      // 季的身份完全遵循 TMDB；服务端不根据标题猜测“真季 / 独立续作”。
      const trackBySeason = seasons.length > 1;
      const episodeCount = trackBySeason
        ? null
        : seasons[0]?.episode_count || detail.number_of_episodes || null;
      res.json({
        seasons: trackBySeason ? seasons : [],
        track_by_season: trackBySeason,
        episode_count: episodeCount,
      });
    } catch (e) {
      res.status(502).json({ error: e.code || 'tmdb_unknown', message: e.message });
    }
  });

  return router;
}
