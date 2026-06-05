// server/src/routes/users.js
// 用户元数据管理（v1: 仅 display_name 改名）
import { Router } from 'express';

export function usersRoutes() {
  const router = Router();

  router.patch('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (id !== 1 && id !== 2) {
      return res.status(400).json({ error: 'invalid_user_id', got: req.params.id });
    }
    const { display_name } = req.body || {};
    if (typeof display_name !== 'string' || !display_name.trim()) {
      return res.status(400).json({ error: 'display_name_required' });
    }
    const trimmed = display_name.trim();
    if (trimmed.length > 50) {
      return res.status(400).json({ error: 'display_name_too_long', max: 50 });
    }
    const db = req.app.locals.db;
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(trimmed, id);
    const row = db.prepare('SELECT id, display_name, avatar FROM users WHERE id = ?').get(id);
    res.json(row);
  });

  return router;
}
