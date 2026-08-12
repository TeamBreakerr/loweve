// server/src/recos/prompt.js
import { tasteProfileLines } from './taste.js';

const fmtMark = (m: any) => `《${m.title}》(${m.year || '?'})${m.rating ? ` 评${m.rating}` : ''}${m.comment ? ` 短评「${m.comment}」` : ''}`;
const fmtPlain = (w: any) => `《${w.title}》(${w.year || '?'})`;
const list = (arr: any, fmt: any) => (arr.length ? arr.map(fmt).join('、') : '（无）');
const RECENT_SIGNAL_LIMIT = 12;
const PLAN_LIMIT = 20;
const AVOID_TITLE_LIMIT = 30;

export function buildMessages({ userA, userB, marksA, marksB, sessions, plan, avoidTitles, userPrompt }: any) {
  const system = '你是资深影视推荐顾问，正在帮一对异地恋情侣挑选「两人都会喜欢、适合一起看」的影视作品。'
    + `两人分别叫「${userA}」和「${userB}」。`
    + '推荐要兼顾双方口味的交集，理由必须引用他们的具体历史（某部作品、某位导演、某种题材），'
    + `并直接用名字「${userA}」「${userB}」称呼他们，不要用 A/B、甲乙、男方/女方 等代称。`
    + '只推荐真实存在的电影或剧集/番剧，宁可少推也不要编造。';

  // 一起看过：双方评分+各自短评用名字标注（而非 A评/B评），避免 LLM 在理由里沿用 A/B
  const fmtSession = (s: any) => {
    const rv = [
      s.review_a ? `${userA}短评「${s.review_a}」` : '',
      s.review_b ? `${userB}短评「${s.review_b}」` : '',
    ].filter(Boolean).join(' ');
    return `《${s.title}》(${s.year || '?'}) ${userA}评${s.rating_a ?? '-'}/${userB}评${s.rating_b ?? '-'}${rv ? ' ' + rv : ''}${s.joint_note ? ` 备注「${s.joint_note}」` : ''}`;
  };

  // 只有「有评分 或 有短评」的记录才作为口味信号喂给模型——
  // 纯粹「看过但没打分没写感想」的没什么参考价值，排除出推荐理由
  // （它们仍在 gatherContext 的 knownKeys 避雷池里，不会被重复推荐）。
  const txt = (s: any) => typeof s === 'string' && s.trim();
  const markHasSignal = (m: any) => m.rating != null || txt(m.comment);
  const sessionHasSignal = (s: any) =>
    s.rating_a != null || s.rating_b != null || txt(s.review_a) || txt(s.review_b) || txt(s.joint_note);

  // 原始流水账仅留近期代表样本（查询已按时间倒序）；
  // 口味画像吃的是全量历史，聚合方向不受此截断影响。
  const watchedA = marksA.filter((m: any) => m.status === 'watched' && markHasSignal(m)).slice(0, RECENT_SIGNAL_LIMIT);
  const watchedB = marksB.filter((m: any) => m.status === 'watched' && markHasSignal(m)).slice(0, RECENT_SIGNAL_LIMIT);
  const ratedSessions = sessions.filter(sessionHasSignal).slice(0, RECENT_SIGNAL_LIMIT);
  const recentPlan = plan.slice(0, PLAN_LIMIT);
  const recentAvoidTitles = avoidTitles.slice(0, AVOID_TITLE_LIMIT);

  const lines = [
    `# ${userA} 看过：${list(watchedA, fmtMark)}`,
    `# ${userB} 看过：${list(watchedB, fmtMark)}`,
    `# 他们一起看过：${list(ratedSessions, fmtSession)}`,
    `# 他们的「想看就一起看」清单：${list(recentPlan, fmtPlain)}`,
    `# 避雷池（这些别再推荐，已看过或已明确不感兴趣）：${recentAvoidTitles.length ? recentAvoidTitles.map((t: any) => `《${t}》`).join('、') : '（无）'}`,
  ];
  const profile = tasteProfileLines({ userA, userB, marksA, marksB, sessions });
  if (profile.length) {
    lines.push(
      ...profile,
      '推荐要优先落在画像里双方（尤其「一起看时都满意」）的高置信方向；'
      + '「爱看但常踩雷」的题材说明 TA 对题材本身有兴趣、只是老挑到烂片，'
      + '要大胆推这个题材里口碑过硬的佳作，别因为 TA 打过低分就避开；'
      + '至多 2 部可以在画像之外探索新方向，理由里说明是想试试新口味。',
    );
  }
  if (userPrompt && userPrompt.trim()) {
    lines.push(`# 本次额外要求（务必满足）：${userPrompt.trim()}`);
  }
  lines.push(
    '',
    '请直接推荐 15 部适合他们一起看的作品，避开避雷池与上面已出现的作品；不要展开分析过程。',
    '只输出 JSON 数组，每项形如：',
    `{"title":"中文或通用片名","year":2020,"type":"movie或tv","is_anime":false,"reason":"一句话理由，引用他们的具体历史，并用「${userA}」「${userB}」称呼而非 A/B"}`,
    '不要输出 JSON 以外的任何文字。',
  );

  return [
    { role: 'system', content: system },
    { role: 'user', content: lines.join('\n') },
  ];
}
