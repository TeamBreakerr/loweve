// server/src/routes/settings.js
import { Router } from 'express';
import { readForApi, updateSettings } from '../settings.js';

export function settingsRoutes() {
  const router = Router();

  // 当前有效配置（密钥脱敏，只回是否已配置）
  router.get('/', (req, res) => {
    res.json(readForApi(req.app.locals.db));
  });

  // 更新覆盖项；空串=回退 env。需身份。
  router.put('/', (req, res) => {
    if (!req.viewing_user_id) return res.status(401).json({ error: 'not_authenticated' });
    updateSettings(req.app.locals.db, req.body || {});
    res.json(readForApi(req.app.locals.db));
  });

  return router;
}
