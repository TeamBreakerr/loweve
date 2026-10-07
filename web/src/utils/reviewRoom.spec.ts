import { describe, it, expect } from 'vitest';
import {
  fmtBytes, fmtClock, formFromSession, formsEqual, isProcessing, mergeDraftIntoForm, pickRecorderMime,
  speakersOf, stageIndex, swapSides, swapSpeakerMap,
} from './reviewRoom';
import type { ReviewDraft } from '../types';

const draft = (over: Partial<ReviewDraft> = {}): ReviewDraft => ({
  speaker_map: { 1: 1, 2: 2 },
  a: { review: '结尾很好', rating: 8 },
  b: { review: '中段拖', rating: null },
  joint_note: '聊了结尾',
  generated_at: 1,
  ...over,
});

describe('点评室表单', () => {
  it('从共看记录取两人评分点评和纪要，空值归一', () => {
    expect(formFromSession({ rating_a: 7, review_a: '好', rating_b: null, review_b: null, joint_note: null })).toEqual({
      a: { rating: 7, comment: '好' }, b: { rating: null, comment: '' }, joint_note: '',
    });
    expect(formFromSession(null).a).toEqual({ rating: null, comment: '' });
  });

  it('填入草稿：草稿没给的评分不覆盖原评分，空点评也不覆盖', () => {
    const current = { a: { rating: 6, comment: '旧A' }, b: { rating: 9, comment: '旧B' }, joint_note: '旧纪要' };
    expect(mergeDraftIntoForm(current, draft({ b: { review: '', rating: null } }))).toEqual({
      a: { rating: 8, comment: '结尾很好' }, b: { rating: 9, comment: '旧B' }, joint_note: '聊了结尾',
    });
  });

  it('两栏对调不动纪要；对调两次复原', () => {
    const f = { a: { rating: 8, comment: 'A' }, b: { rating: 5, comment: 'B' }, joint_note: 'N' };
    expect(swapSides(f)).toEqual({ a: { rating: 5, comment: 'B' }, b: { rating: 8, comment: 'A' }, joint_note: 'N' });
    expect(swapSides(swapSides(f))).toEqual(f);
  });

  it('比较时忽略首尾空白（服务端会 trim）', () => {
    const x = { a: { rating: 8, comment: ' A ' }, b: { rating: null, comment: '' }, joint_note: '' };
    const y = { a: { rating: 8, comment: 'A' }, b: { rating: null, comment: '' }, joint_note: ' ' };
    expect(formsEqual(x, y)).toBe(true);
    expect(formsEqual(x, { ...y, a: { rating: 7, comment: 'A' } })).toBe(false);
  });
});

describe('说话人', () => {
  it('按首次发言顺序列出', () => {
    expect(speakersOf([{ speaker: '2', start: 0, text: 'x' }, { speaker: '1', start: 1, text: 'y' }, { speaker: '2', start: 2, text: 'z' }]))
      .toEqual(['2', '1']);
    expect(speakersOf(null)).toEqual([]);
  });

  it('对应对调：1↔2，忽略的保持忽略', () => {
    expect(swapSpeakerMap({ 1: 1, 2: 2, 3: null })).toEqual({ 1: 2, 2: 1, 3: null });
  });
});

describe('格式与进度', () => {
  it('时长：不足一小时 mm:ss，超过带小时', () => {
    expect(fmtClock(65.9)).toBe('01:05');
    expect(fmtClock(3723)).toBe('1:02:03');
    expect(fmtClock(-3)).toBe('00:00');
  });

  it('大小', () => {
    expect(fmtBytes(300)).toBe('1 KB');
    expect(fmtBytes(5.5 * 1024 * 1024)).toBe('5.5 MB');
    expect(fmtBytes(42 * 1024 * 1024)).toBe('42 MB');
  });

  it('处理中状态与三步进度', () => {
    expect(['uploaded', 'transcribing', 'summarizing'].every(s => isProcessing(s as any))).toBe(true);
    expect(isProcessing('ready')).toBe(false);
    expect([stageIndex('uploading'), stageIndex('transcribing'), stageIndex('summarizing'), stageIndex('ready')]).toEqual([0, 1, 2, 3]);
  });

  it('录音格式：优先 webm/opus，Safari 只支持 mp4 时用 mp4，都不支持返回空', () => {
    expect(pickRecorderMime(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickRecorderMime(t => t.startsWith('audio/mp4'))).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(pickRecorderMime(() => { throw new Error('old browser'); })).toBe('');
  });
});
