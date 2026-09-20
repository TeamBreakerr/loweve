import { getState, setState } from './state.js';
import type { Candidate } from './discovery.js';

export function readDiscovery(db: any, batch: string | null) {
  if (!batch) return null;
  try { return JSON.parse(getState(db, `discovery:${batch}`) || 'null'); } catch { return null; }
}

export function saveDiscovery(db: any, batch: string, result: any) {
  setState(db, `discovery:${batch}`, JSON.stringify({ note: result.note, queries: result.queries, fetched_at: result.fetched_at }));
}

export function saveEvidence(db: any, batch: string, workId: number, candidate: Candidate) {
  setState(db, `discovery-item:${batch}:${workId}`, JSON.stringify({
    source: candidate.source, source_url: candidate.url, source_score: candidate.score,
    source_votes: candidate.votes, source_rank: candidate.rank ?? null, fetched_at: Date.now(),
  }));
}

export function attachEvidence(db: any, batch: string, rows: any[]) {
  return rows.map(row => {
    let evidence = null;
    try { evidence = JSON.parse(getState(db, `discovery-item:${batch}:${row.work_id}`) || 'null'); } catch { /* 旧批次无来源快照 */ }
    return { ...row, evidence };
  });
}
