// server/src/routes/settings.js
import { Router } from 'express';
import { readForApi, updateSettings } from '../settings.js';

export function settingsRoutes() {
  const router = Router();

  // 从当前有效的 OpenAI 兼容端点探测模型；密钥仅在服务端使用，不回前端。
  router.get('/models', async (req, res) => {
    if (!req.viewing_user_id) return res.status(401).json({ error: 'not_authenticated' });
    const llm = req.app.locals.llm;
    if (!llm?.listModels) return res.status(503).json({ error: 'llm_unconfigured' });
    try {
      res.json({ models: await llm.listModels() });
    } catch (e) {
      const code = e?.code || 'llm_models_failed';
      const status = code === 'llm_unconfigured' ? 503 : 502;
      res.status(status).json({ error: code, ...(e?.status ? { upstream_status: e.status } : {}) });
    }
  });

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
