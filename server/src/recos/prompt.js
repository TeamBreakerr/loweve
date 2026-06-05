// server/src/recos/prompt.js
const fmtMark = (m) => `《${m.title}》(${m.year || '?'})${m.rating ? ` 评${m.rating}` : ''}${m.comment ? ` 短评「${m.comment}」` : ''}`;
const fmtPlain = (w) => `《${w.title}》(${w.year || '?'})`;
const list = (arr, fmt) => (arr.length ? arr.map(fmt).join('、') : '（无）');

export function buildMessages({ userA, userB, marksA, marksB, sessions, plan, avoidTitles, userPrompt }) {
  const system = '你是资深影视推荐顾问，正在帮一对异地恋情侣挑选「两人都会喜欢、适合一起看」的影视作品。'
    + `两人分别叫「${userA}」和「${userB}」。`
    + '推荐要兼顾双方口味的交集，理由必须引用他们的具体历史（某部作品、某位导演、某种题材），'
    + `并直接用名字「${userA}」「${userB}」称呼他们，不要用 A/B、甲乙、男方/女方 等代称。`
    + '只推荐真实存在的电影或剧集/番剧，宁可少推也不要编造。';

  // 一起看过：双方评分+各自短评用名字标注（而非 A评/B评），避免 LLM 在理由里沿用 A/B
  const fmtSession = (s) => {
    const rv = [
      s.review_a ? `${userA}短评「${s.review_a}」` : '',
      s.review_b ? `${userB}短评「${s.review_b}」` : '',
    ].filter(Boolean).join(' ');
    return `《${s.title}》(${s.year || '?'}) ${userA}评${s.rating_a ?? '-'}/${userB}评${s.rating_b ?? '-'}${rv ? ' ' + rv : ''}${s.joint_note ? ` 备注「${s.joint_note}」` : ''}`;
  };

  // 只有「有评分 或 有短评」的记录才作为口味信号喂给模型——
  // 纯粹「看过但没打分没写感想」的没什么参考价值，排除出推荐理由
  // （它们仍在 gatherContext 的 knownKeys 避雷池里，不会被重复推荐）。
  const txt = (s) => typeof s === 'string' && s.trim();
  const markHasSignal = (m) => m.rating != null || txt(m.comment);
  const sessionHasSignal = (s) =>
    s.rating_a != null || s.rating_b != null || txt(s.review_a) || txt(s.review_b) || txt(s.joint_note);

  const watchedA = marksA.filter(m => m.status === 'watched' && markHasSignal(m));
  const watchedB = marksB.filter(m => m.status === 'watched' && markHasSignal(m));
  const ratedSessions = sessions.filter(sessionHasSignal);

  const lines = [
    `# ${userA} 看过：${list(watchedA, fmtMark)}`,
    `# ${userB} 看过：${list(watchedB, fmtMark)}`,
    `# 他们一起看过：${list(ratedSessions, fmtSession)}`,
    `# 他们的「想看就一起看」清单：${list(plan, fmtPlain)}`,
    `# 避雷池（这些别再推荐，已看过或已明确不感兴趣）：${avoidTitles.length ? avoidTitles.map(t => `《${t}》`).join('、') : '（无）'}`,
  ];
  if (userPrompt && userPrompt.trim()) {
    lines.push(`# 本次额外要求（务必满足）：${userPrompt.trim()}`);
  }
  lines.push(
    '',
    '请推荐 12 部适合他们一起看的作品，避开避雷池与上面已出现的作品。',
    '只输出 JSON 数组，每项形如：',
    `{"title":"中文或通用片名","year":2020,"type":"movie或tv","is_anime":false,"reason":"一句话理由，引用他们的具体历史，并用「${userA}」「${userB}」称呼而非 A/B"}`,
    '不要输出 JSON 以外的任何文字。',
  );

  return [
    { role: 'system', content: system },
    { role: 'user', content: lines.join('\n') },
  ];
}
