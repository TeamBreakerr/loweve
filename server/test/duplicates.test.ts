import request from 'supertest';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { makeTestDb, makeFakeTmdb } from './helpers.js';

function seedWork(db: any, { tmdbId = 10, season = null }: { tmdbId?: number; season?: number | null } = {}) {
  const now = Date.now();
  return db.prepare(`INSERT INTO works
    (tmdb_id, tmdb_type, season_number, title, rating_source, tmdb_raw, fetched_at, updated_at)
    VALUES (?, 'tv', ?, ?, 'tmdb', '{}', ?, ?)`)
    .run(tmdbId, season, season == null ? '整部' : `第${season}季`, now, now).lastInsertRowid;
}

describe('GET /api/works/duplicate', () => {
  let db: any;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('按目标列表探测，个人记录按当前 viewing user 隔离', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const workId = seedWork(db);
    await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=1').send({ work_id: workId, status: 'watched' });

    const mine = await request(app).get('/api/works/duplicate?target=watched&work_id=' + workId).set('Cookie', 'loweve_user_id=1');
    const theirs = await request(app).get('/api/works/duplicate?target=watched&work_id=' + workId + '&as_user=2').set('Cookie', 'loweve_user_id=1');
    assert.deepEqual(mine.body, { duplicate: true, error: 'mark_exists' });
    assert.deepEqual(theirs.body, { duplicate: false });
  });

  it('一起看过、一起想看分别探测', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const sessionWork = seedWork(db, { tmdbId: 10 });
    const planWork = seedWork(db, { tmdbId: 11 });
    await request(app).post('/api/sessions').set('Cookie', 'loweve_user_id=1').send({ work_id: sessionWork });
    await request(app).post('/api/plan').set('Cookie', 'loweve_user_id=1').send({ work_id: planWork });

    const session = await request(app).get('/api/works/duplicate?target=couple_watched&work_id=' + sessionWork).set('Cookie', 'loweve_user_id=1');
    const plan = await request(app).get('/api/works/duplicate?target=couple_plan&work_id=' + planWork).set('Cookie', 'loweve_user_id=1');
    assert.equal(session.body.error, 'session_exists');
    assert.equal(plan.body.error, 'plan_exists');
  });

  it('TMDB 身份包含 season_number，不把不同季误判为重复', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const season1 = seedWork(db, { tmdbId: 10, season: 1 });
    seedWork(db, { tmdbId: 10, season: 2 });
    await request(app).post('/api/plan').set('Cookie', 'loweve_user_id=1').send({ work_id: season1 });

    const same = await request(app).get('/api/works/duplicate?target=couple_plan&tmdb_id=10&tmdb_type=tv&season_number=1').set('Cookie', 'loweve_user_id=1');
    const other = await request(app).get('/api/works/duplicate?target=couple_plan&tmdb_id=10&tmdb_type=tv&season_number=2').set('Cookie', 'loweve_user_id=1');
    assert.equal(same.body.duplicate, true);
    assert.equal(other.body.duplicate, false);
  });
});
