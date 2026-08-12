import request from 'supertest';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { makeTestDb, makeFakeTmdb } from './helpers.js';

function seedWork(db: any, tmdbId = 1) {
  const now = Date.now();
  return db.prepare(`INSERT INTO works
    (tmdb_id, tmdb_type, title, rating_source, tmdb_raw, fetched_at, updated_at)
    VALUES (?, 'movie', ?, 'tmdb', '{}', ?, ?)`)
    .run(tmdbId, `作品${tmdbId}`, now, now).lastInsertRowid;
}

describe('回收站', () => {
  let db: any;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('删除个人记录后进入回收站，并可恢复', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const workId = seedWork(db);
    const mark = (await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=1').send({
      work_id: workId, status: 'watched', rating: 9, comment: '好看',
    })).body;

    assert.equal((await request(app).delete(`/api/marks/${mark.id}`).set('Cookie', 'loweve_user_id=1')).status, 204);
    assert.equal(db.prepare('SELECT 1 FROM user_marks WHERE id = ?').get(mark.id), undefined);

    const list = await request(app).get('/api/trash').set('Cookie', 'loweve_user_id=1');
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.items[0].entity_type, 'mark');
    assert.equal(list.body.items[0].work.title, '作品1');
    assert.equal(list.body.items[0].payload.rating, 9);

    const restored = await request(app).post(`/api/trash/${list.body.items[0].id}/restore`).set('Cookie', 'loweve_user_id=1');
    assert.equal(restored.status, 200);
    const active: any = db.prepare('SELECT * FROM user_marks WHERE user_id = 1 AND work_id = ?').get(workId);
    assert.equal(active.comment, '好看');
    assert.equal((db.prepare('SELECT COUNT(*) AS c FROM trash_items').get() as any).c, 0);
  });

  it('一起看过与一起想看删除后均进入回收站', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const sessionWork = seedWork(db, 1);
    const planWork = seedWork(db, 2);
    const session = (await request(app).post('/api/sessions').set('Cookie', 'loweve_user_id=1').send({
      work_id: sessionWork, watched_at: 20260701, rating: 8,
    })).body;
    const plan = (await request(app).post('/api/plan').set('Cookie', 'loweve_user_id=2').send({
      work_id: planWork, priority: 3,
    })).body;

    await request(app).delete(`/api/sessions/${session.id}`).set('Cookie', 'loweve_user_id=1');
    await request(app).delete(`/api/plan/${plan.id}`).set('Cookie', 'loweve_user_id=2');
    const list = await request(app).get('/api/trash').set('Cookie', 'loweve_user_id=1');
    assert.deepEqual(list.body.items.map((item: any) => item.entity_type).sort(), ['plan', 'session']);

    for (const item of list.body.items) {
      assert.equal((await request(app).post(`/api/trash/${item.id}/restore`).set('Cookie', 'loweve_user_id=1')).status, 200);
    }
    assert.ok(db.prepare('SELECT 1 FROM couple_sessions WHERE work_id = ?').get(sessionWork));
    assert.ok(db.prepare('SELECT 1 FROM plan_items WHERE work_id = ?').get(planWork));
  });

  it('恢复遇到同列表重复项 → 409，回收站记录保留', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const workId = seedWork(db);
    const old = (await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=1').send({ work_id: workId, status: 'watched' })).body;
    await request(app).delete(`/api/marks/${old.id}`).set('Cookie', 'loweve_user_id=1');
    await request(app).post('/api/marks').set('Cookie', 'loweve_user_id=1').send({ work_id: workId, status: 'watched' });
    const trash: any = db.prepare('SELECT id FROM trash_items').get();

    const restored = await request(app).post(`/api/trash/${trash.id}/restore`).set('Cookie', 'loweve_user_id=1');
    assert.equal(restored.status, 409);
    assert.equal(restored.body.error, 'restore_conflict');
    assert.ok(db.prepare('SELECT 1 FROM trash_items WHERE id = ?').get(trash.id));
  });

  it('永久删除只清掉回收站快照', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    const workId = seedWork(db);
    const plan = (await request(app).post('/api/plan').set('Cookie', 'loweve_user_id=1').send({ work_id: workId })).body;
    await request(app).delete(`/api/plan/${plan.id}`).set('Cookie', 'loweve_user_id=1');
    const trash: any = db.prepare('SELECT id FROM trash_items').get();

    assert.equal((await request(app).delete(`/api/trash/${trash.id}`).set('Cookie', 'loweve_user_id=1')).status, 204);
    assert.equal(db.prepare('SELECT 1 FROM trash_items WHERE id = ?').get(trash.id), undefined);
    assert.equal((await request(app).post(`/api/trash/${trash.id}/restore`).set('Cookie', 'loweve_user_id=1')).status, 404);
  });

  it('回收站接口需要身份', async () => {
    const app = createApp({ db, tmdb: makeFakeTmdb() });
    assert.equal((await request(app).get('/api/trash')).status, 401);
    assert.equal((await request(app).delete('/api/trash/1')).status, 401);
  });
});
