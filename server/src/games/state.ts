import { getState, setState } from '../recos/state.js';

export function markGameRecosStale(db: any) { setState(db, 'game_recos_stale', '1'); }
export function clearGameRecosStale(db: any) { setState(db, 'game_recos_stale', '0'); }
export function areGameRecosStale(db: any) { return getState(db, 'game_recos_stale') === '1'; }
export function getGameStandingBatchId(db: any) { return getState(db, 'game_current_standing_batch_id'); }
export function setGameStandingBatchId(db: any, id: any) { setState(db, 'game_current_standing_batch_id', id); }
