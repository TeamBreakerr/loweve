// 点评室的纯函数：表单 ↔ 共看记录 / AI 草稿、两人对调、说话人对应、时长格式、录音格式挑选。
import type { RecordingStatus, ReviewDraft, Session, SpeakerMap, TranscriptTurn } from '../types';

export interface SideForm { rating: number | null; comment: string }
export interface JointForm { a: SideForm; b: SideForm; joint_note: string }

export function formFromSession(s: Partial<Session> | null | undefined): JointForm {
  return {
    a: { rating: s?.rating_a ?? null, comment: s?.review_a || '' },
    b: { rating: s?.rating_b ?? null, comment: s?.review_b || '' },
    joint_note: s?.joint_note || '',
  };
}

export function formFromDraft(d: ReviewDraft): JointForm {
  return {
    a: { rating: d.a.rating, comment: d.a.review },
    b: { rating: d.b.rating, comment: d.b.review },
    joint_note: d.joint_note,
  };
}

// 草稿填入时：草稿里没给的评分（讨论里没明确说）不覆盖已有评分
export function mergeDraftIntoForm(current: JointForm, d: ReviewDraft): JointForm {
  const draft = formFromDraft(d);
  return {
    a: { rating: draft.a.rating ?? current.a.rating, comment: draft.a.comment || current.a.comment },
    b: { rating: draft.b.rating ?? current.b.rating, comment: draft.b.comment || current.b.comment },
    joint_note: draft.joint_note || current.joint_note,
  };
}

// 说话人认反了：两栏内容整体对调（纪要用名字写的，不动）
export function swapSides(f: JointForm): JointForm {
  return { a: { ...f.b }, b: { ...f.a }, joint_note: f.joint_note };
}

export function formsEqual(x: JointForm, y: JointForm) {
  const norm = (f: JointForm) => JSON.stringify([f.a.rating, f.a.comment.trim(), f.b.rating, f.b.comment.trim(), f.joint_note.trim()]);
  return norm(x) === norm(y);
}

// 按首次发言顺序列出说话人标签
export function speakersOf(turns: TranscriptTurn[] | null | undefined) {
  return [...new Set((turns || []).map(t => t.speaker))];
}

export function swapSpeakerMap(m: SpeakerMap): SpeakerMap {
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v === 1 ? 2 : v === 2 ? 1 : null])) as SpeakerMap;
}

export function fmtClock(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function isProcessing(status: RecordingStatus) {
  return status === 'uploaded' || status === 'transcribing' || status === 'summarizing';
}

// 进度三步：上传 → 转写 → 生成；返回当前进行到第几步（0 起），全部完成为 3
export function stageIndex(status: RecordingStatus | 'uploading') {
  return { uploading: 0, uploaded: 1, transcribing: 1, summarizing: 2, ready: 3, error: -1 }[status];
}

// MediaRecorder 能产出的格式：Chrome/Firefox 用 webm(opus)，Safari/iOS 只有 mp4(aac)
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus'];
export function pickRecorderMime(isSupported: (type: string) => boolean) {
  return MIME_CANDIDATES.find(t => { try { return isSupported(t); } catch { return false; } }) || '';
}
