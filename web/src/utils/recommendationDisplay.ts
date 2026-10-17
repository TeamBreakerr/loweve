import type { RecommendationEvidence } from '../types';

type Recommendation = { reason?: string; evidence?: RecommendationEvidence | null };

export function recommendationTooltip(item: Recommendation) {
  const e = item.evidence;
  if (!e) return undefined;
  return [
    `来源：${e.source}`,
    e.source_score != null ? `${e.source_score}${e.source === 'Steam' ? '% 好评' : '分'}` : '',
    e.source_votes != null ? `${e.source_votes}人评价` : '',
    e.source_rank != null ? `站内排名 ${e.source_rank}` : '',
    `查询于 ${new Date(e.fetched_at).toLocaleString()}`,
  ].filter(Boolean).join(' · ');
}

// 来源证据由悬浮提示展示；正文只保留原有推荐理由，兼容已保存的批次。
export function recommendationReason(item: Recommendation) {
  const text = item.reason || '';
  if (!item.evidence || !text.startsWith(`${item.evidence.source} `)) return text;
  const boundary = text.indexOf('。');
  return boundary < 0 ? '' : text.slice(boundary + 1);
}
