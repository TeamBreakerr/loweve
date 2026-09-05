import { Router } from 'express';
import { upsertWork } from './works.js';
import { markRecosStale } from '../recos/state.js';
import type { Session } from '../../../shared/types.js';
import { moveToTrash } from '../trash/service.js';
import { ensureExperiencePair, getMovieSession, listMovieSessions } from '../experiences/service.js';

function validateRating(r: any) { return r == null || (Number.isInteger(r) && r >= 1 && r <= 10); }

export function currentDateKey(now = Date.now()) {
  const d = new Date(now);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

export function sessionsRoutes() {
  const router = Router();

  router.get('/', (req, res) => {
    const db = req.app.locals.db;
    const rows = listMovieSessions(db);
    const workIds = [...new Set(rows.map((row: any) => row.work_id))];
    const works = workIds.length
      ? db.prepare(`SELECT * FROM works WHERE id IN (${workIds.map(() => '?').join(',')})`).all(...workIds)
      : [];
    const workMap = new Map(works.map((work: any) => [work.id, work]));
    res.json({ sessions: rows.map((row: any) => ({ ...row, work: workMap.get(row.work_id) })) satisfies Session[] });
  });

  router.post('/', async (req, res) => {
    if (!req.viewing_user_id) return res.status(401).json({ error: 'not_authenticated' });
    const db = req.app.locals.db;
    const tmdb = req.app.locals.tmdb;
    const fromPlanId = parseInt(req.query.from_plan as string, 10);
    const { work_id, tmdb_id, tmdb_type, season_number, watched_at, rating, review, joint_note } = req.body || {};
    const effectiveWatchedAt = watched_at == null ? currentDateKey() : watched_at;
    if (!Number.isInteger(effectiveWatchedAt)) return res.status(400).json({ error: 'invalid_watched_at' });
    if (!validateRating(rating)) return res.status(400).json({ error: 'invalid_rating' });

    let finalWorkId = work_id;
    let planId: number | null = null;
    if (Number.isInteger(fromPlanId)) {
      const plan = db.prepare('SELECT id, work_id FROM plan_items WHERE id = ?').get(fromPlanId);
      if (!plan) return res.status(404).json({ error: 'plan_not_found' });
      finalWorkId = plan.work_id;
      planId = plan.id;
    } else if (!finalWorkId) {
      if (!Number.isInteger(tmdb_id) || (tmdb_type !== 'movie' && tmdb_type !== 'tv')) {
        return res.status(400).json({ error: 'work_id_or_tmdb_required' });
      }
      try {
        const work = await upsertWork(db, tmdb, req.app.locals.bangumi, req.app.locals.douban, {
          tmdb_id, tmdb_type, season_number,
        });
        finalWorkId = work.id;
      } catch (e) {
        return res.status(502).json({ error: e.code || 'tmdb_unknown', message: e.message });
      }
    }

    if (db.prepare('SELECT 1 FROM couple_sessions WHERE work_id = ?').get(finalWorkId)) {
      return res.status(409).json({ error: 'session_exists' });
    }

    const now = Date.now();
    const viewer = req.viewing_user_id === 1 ? 1 : 2;
    const id = db.transaction(() => {
      const info = db.prepare(`INSERT INTO couple_sessions
        (work_id, watched_at, joint_note, created_at) VALUES (?, ?, ?, ?)`)
        .run(finalWorkId, effectiveWatchedAt, joint_note ?? null, now);
      ensureExperiencePair(db, 'movie', finalWorkId, now, {
        [viewer]: { rating: rating ?? null, comment: review ?? null },
      });
      if (planId != null) {
        db.prepare('UPDATE plan_items SET status = ?, updated_at = ? WHERE id = ?').run('done', now, planId);
      }
      return Number(info.lastInsertRowid);
    })();
    markRecosStale(db);
    res.json(getMovieSession(db, id) satisfies Session);
  });

  router.put('/:id', (req, res) => {
    if (!req.viewing_user_id) return res.status(401).json({ error: 'not_authenticated' });
    const db = req.app.locals.db;
    const id = parseInt(req.params.id, 10);
    const existing = getMovieSession(db, id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const body = req.body || {};
    const experienceFields = ['rating', 'review', 'rating_a', 'rating_b', 'review_a', 'review_b'];
    if (experienceFields.some(field => Object.hasOwn(body, field))) {
      return res.status(400).json({ error: 'experience_fields_belong_to_marks' });
    }
    const { watched_at, joint_note } = body;
    const hasWatchedAt = Object.hasOwn(body, 'watched_at');
    const hasJointNote = Object.hasOwn(body, 'joint_note');
    if (hasWatchedAt && watched_at != null && !Number.isInteger(watched_at)) {
      return res.status(400).json({ error: 'invalid_watched_at' });
    }

    db.prepare(`UPDATE couple_sessions SET
      watched_at = CASE WHEN @setWatched = 1 THEN @watched_at ELSE watched_at END,
      joint_note = CASE WHEN @setJointNote = 1 THEN @joint_note ELSE joint_note END
      WHERE id = @id`).run({
        setWatched: hasWatchedAt ? 1 : 0,
        watched_at: watched_at ?? null,
        setJointNote: hasJointNote ? 1 : 0,
        joint_note: joint_note ?? null,
        id,
      });
    if (hasJointNote && joint_note !== existing.joint_note) markRecosStale(db);
    res.json(getMovieSession(db, id) satisfies Session);
  });

  router.delete('/:id', (req, res) => {
    if (!req.viewing_user_id) return res.status(401).json({ error: 'not_authenticated' });
    const db = req.app.locals.db;
    const id = parseInt(req.params.id, 10);
    if (!moveToTrash(db, 'session', id, req.viewing_user_id)) return res.status(404).json({ error: 'not_found' });
    markRecosStale(db);
    res.status(204).end();
  });

  return router;
}
