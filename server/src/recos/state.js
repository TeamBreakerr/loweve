// server/src/recos/state.js
let counter = 0;

export function nextBatchId() {
  counter = (counter + 1) % 1e6;
  return `${Date.now()}-${counter}`;
}

export function setState(db, key, value) {
  db.prepare(`INSERT INTO app_state (key, value, updated_at) VALUES (@key, @value, @now)
    ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = @now`)
    .run({ key, value: value == null ? null : String(value), now: Date.now() });
}

export function getState(db, key) {
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function markRecosStale(db) { setState(db, 'recos_stale', '1'); }
export function clearRecosStale(db) { setState(db, 'recos_stale', '0'); }
export function isRecosStale(db) { return getState(db, 'recos_stale') === '1'; }

export function getStandingBatchId(db) { return getState(db, 'current_standing_batch_id'); }
export function setStandingBatchId(db, id) { setState(db, 'current_standing_batch_id', id); }
