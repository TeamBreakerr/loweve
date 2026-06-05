// server/src/routes/me.js
import { Router } from 'express';
import { COOKIE_NAME, COOKIE_MAX_AGE_MS } from '../middleware/identity.js';

export function meRoutes() {
  const router = Router();

  router.get('/', (req, res) => {
    const db = req.app.locals.db;
    const users = db.prepare(
      'SELECT id, display_name, avatar FROM users ORDER BY id'
    ).all();
    res.json({ user_id: req.user_id, users });
  });

  router.post('/switch', (req, res) => {
    const { user_id } = req.body || {};
    if (user_id !== 1 && user_id !== 2) {
      return res.status(400).json({ error: 'invalid_user_id', got: user_id });
    }
    res.cookie(COOKIE_NAME, String(user_id), {
      maxAge: COOKIE_MAX_AGE_MS,
      httpOnly: false,        // 前端要读，方便调试
      sameSite: 'lax',
      path: '/',
    });
    res.json({ user_id });
  });

  return router;
}
