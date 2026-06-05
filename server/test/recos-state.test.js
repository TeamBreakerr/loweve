// server/test/recos-state.test.js
import assert from 'node:assert/strict';
import { makeTestDb } from './helpers.js';
import {
  setState, getState, markRecosStale, clearRecosStale, isRecosStale,
  getStandingBatchId, setStandingBatchId, nextBatchId,
} from '../src/recos/state.js';

describe('recos/state', () => {
  let db;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('setState/getState 往返', () => {
    setState(db, 'k', 'v');
    assert.equal(getState(db, 'k'), 'v');
    setState(db, 'k', 'v2');           // upsert 覆盖
    assert.equal(getState(db, 'k'), 'v2');
    assert.equal(getState(db, 'missing'), null);
  });

  it('stale 标志默认 false，可置位与清除', () => {
    assert.equal(isRecosStale(db), false);
    markRecosStale(db);
    assert.equal(isRecosStale(db), true);
    clearRecosStale(db);
    assert.equal(isRecosStale(db), false);
  });

  it('standing batch id 默认 null，可设置读取', () => {
    assert.equal(getStandingBatchId(db), null);
    setStandingBatchId(db, 'b1');
    assert.equal(getStandingBatchId(db), 'b1');
  });

  it('nextBatchId 单调不重复', () => {
    const a = nextBatchId(); const b = nextBatchId();
    assert.notEqual(a, b);
    assert.match(a, /^\d+-\d+$/);
  });
});
