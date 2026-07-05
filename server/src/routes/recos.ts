// server/src/routes/recos.js
import { Router } from 'express';
import { getCurrentRecos, generateStanding } from '../recos/service.js';
import { markRecosStale } from '../recos/state.js';
import { upsertWork } from './works.js';
import type { Mark, PlanItem } from '../../../shared/types.js';

const ACTIONS = { want: 'interested', not_interested: 'not_interested', already_seen: 'already_seen' };

function depsOf(req: any) {
  return {
    llm: req.app.locals.llm,
    tmdb: req.app.locals.tmdb,
    bangumi: req.app.locals.bangumi,
    douban: req.app.locals.douban,
  };
}

export function recosRoutes() {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await getCurrentRecos(req.app.locals.db, depsOf(req)));
  });

  router.post('/refresh', async (req, res) => {
    try {
      res.json({ ...(await generateStanding(req.app.locals.db, depsOf(req), {})), error: null });
    } catch (e) {
      res.status(502).json({ error: 'llm_unavailable', message: e.message });
    }
  });

  router.post('/custom', async (req, res) => {
    const prompt = (req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'prompt_required' });
    try {
      res.json({ ...(await generateStanding(req.app.locals.db, depsOf(req), { userPrompt: prompt })), error: null });
    } catch (e) {
      res.status(502).json({ error: 'llm_unavailable', message: e.message });
    }
  });

  router.post('/:id/feedback', async (req, res) => {
    if (!req.viewing_user_id) return res.status(401).json({ error: 'not_authenticated' });
    const db = req.app.locals.db;
    const id = parseInt(req.params.id, 10);
    const action = req.body?.action;
    const feedback = ACTIONS[action as keyof typeof ACTIONS];
    if (!feedback) return res.status(400).json({ error: 'invalid_action' });
    // 想看时可带优先级（0–3），非法值归 0
    const priority = (Number.isInteger(req.body?.priority) && req.body.priority >= 0 && req.body.priority <= 3) ? req.body.priority : 0;

    const rec = db.prepare('SELECT id, work_id FROM recommendations WHERE id = ?').get(id);
    if (!rec) return res.status(404).json({ error: 'not_found' });

    const now = Date.now();
    db.prepare(`UPDATE recommendations SET feedback = @feedback, feedback_by = @by, feedback_at = @now WHERE id = @id`)
      .run({ feedback, by: req.viewing_user_id, now, id });

    let plan: PlanItem | null = null, mark: Mark | null = null;
    if (action === 'already_seen' && rec.work_id) {
      // 「看过」→ 直接加入当前视角用户的「我已观看」（已在列表则忽略）
      try {
        db.prepare(`INSERT INTO user_marks (user_id, work_id, status, rating, comment, marked_at)
          VALUES (?, ?, 'watched', NULL, NULL, ?)`).run(req.viewing_user_id, rec.work_id, now);
      } catch (e) { if (!String(e).includes('UNIQUE')) throw e; }
      mark = db.prepare('SELECT id, user_id, work_id, status FROM user_marks WHERE user_id = ? AND work_id = ?').get(req.viewing_user_id, rec.work_id);
    }
    if (action === 'want' && rec.work_id) {
      const w = db.prepare('SELECT tmdb_id, tmdb_type FROM works WHERE id = ?').get(rec.work_id);
      if (w) {
        // 完整升级（电影触发豆瓣自愈），再入「一起想看」
        try { await upsertWork(db, req.app.locals.tmdb, req.app.locals.bangumi, req.app.locals.douban, { tmdb_id: w.tmdb_id, tmdb_type: w.tmdb_type }); }
        catch (e) { console.warn('[recos] want upsert failed', e.message); }
        try {
          const info = db.prepare(`INSERT INTO plan_items (work_id, added_by, note, priority, status, created_at, updated_at)
            VALUES (?, ?, NULL, ?, 'pending', ?, ?)`).run(rec.work_id, req.viewing_user_id, priority, now, now);
          plan = db.prepare('SELECT id, work_id, added_by, note, priority, status, created_at, updated_at FROM plan_items WHERE id = ?').get(info.lastInsertRowid);
        } catch (e) { if (!String(e).includes('UNIQUE')) throw e; }   // 已在计划里就忽略
      }
    }

    markRecosStale(db);
    res.json({ ok: true, plan, mark });
  });

  return router;
}
