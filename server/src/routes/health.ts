// server/src/routes/health.js
import { Router } from 'express';

export function healthRoutes() {
  const router = Router();

  router.get('/', async (req, res) => {
    const db = req.app.locals.db;
    let dbStatus = 'unknown';
    try {
      db.prepare('SELECT 1').get();
      dbStatus = 'ok';
    } catch (e) {
      dbStatus = 'down';
    }

    // Phase 1 暂不连 browser-svc，标 'unknown'
    // Phase 4 改成实际 fetch BROWSER_SVC_URL/health
    const browserStatus = 'unknown';

    res.json({
      ok: dbStatus === 'ok',
      db: dbStatus,
      browser: browserStatus,
      ts: Date.now(),
    });
  });

  return router;
}
