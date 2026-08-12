const LIMIT = 16;

function list(items: any[], format: (item: any) => string) {
  return items.length ? items.slice(0, LIMIT).map(format).join('、') : '（无）';
}

function fmtMark(item: any) {
  return `《${item.title}》(${item.release_year || '?'})${item.rating ? ` 评${item.rating}` : ''}${item.comment ? ` 短评「${item.comment}」` : ''}`;
}

export function customAllowsSolo(prompt: any) {
  const text = String(prompt || '');
  if (/(?:不要|排除|不想要?|别)(?:推荐)?[^，。,.]{0,8}(?:单人|单机|solo|single[- ]?player)/i.test(text)) return false;
  return /单人|单机|solo|single[- ]?player/i.test(text);
}

export function customAllowsUnreleased(prompt: any) {
  const text = String(prompt || '');
  if (/(?:不要|排除|不想要?|别)(?:推荐)?[^，。,.]{0,8}(?:未发售|抢先体验|early\s*access|coming\s*soon)/i.test(text)) return false;
  return /未发售|即将发售|期待作|抢先体验|early\s*access|coming\s*soon/i.test(text);
}

export function customAllowsDlc(prompt: any) {
  const text = String(prompt || '');
  if (/(?:不要|排除|不想要?|别)(?:推荐)?[^，。,.]{0,8}(?:dlc|资料片|扩展包|追加内容)/i.test(text)) return false;
  return /dlc|资料片|扩展包|追加内容/i.test(text);
}

/** 只识别用户明确给出的人民币上限；返回报价表使用的「分」。 */
export function customPriceCeiling(prompt: any) {
  const text = String(prompt || '');
  const match = text.match(/(?:预算|不超过|最多)\s*(?:为|是|[:：])?\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*(?:元|块|rmb|cny)?/i)
    || text.match(/[¥￥]?\s*(\d+(?:\.\d+)?)\s*(?:元|块|rmb|cny)\s*(?:以内|以下|封顶)/i);
  if (!match) return null;
  const yuan = Number(match[1]);
  return Number.isFinite(yuan) && yuan >= 0 ? Math.round(yuan * 100) : null;
}

export function buildGameMessages({ userA, userB, marksA, marksB, sessions, plan, avoidTitles, userPrompt }: any) {
  const allowSolo = customAllowsSolo(userPrompt);
  const allowUnreleased = customAllowsUnreleased(userPrompt);
  const allowDlc = customAllowsDlc(userPrompt);
  const priceCeiling = customPriceCeiling(userPrompt);
  const fmtSession = (s: any) => {
    const comments = [
      s.review_a ? `${userA}短评「${s.review_a}」` : '',
      s.review_b ? `${userB}短评「${s.review_b}」` : '',
    ].filter(Boolean).join(' ');
    return `《${s.title}》(${s.release_year || '?'}) ${userA}评${s.rating_a ?? '-'}/${userB}评${s.rating_b ?? '-'}${comments ? ' ' + comments : ''}`;
  };
  const fmtPlan = (p: any) => `《${p.title}》(${p.release_year || '?'}) ${p.status || 'pending'}`;
  const system = '你是资深全平台游戏推荐顾问，正在帮一对情侣挑选两个人都会喜欢的游戏。'
    + `两人分别叫「${userA}」和「${userB}」。`
    + '理由必须结合他们具体玩过的游戏、评分、短评和共同体验，并直接用双方名字称呼。'
    + (allowDlc
      ? '本次可以推荐 PC、Nintendo、PlayStation、Xbox 与复古平台上真实存在的游戏本体或 DLC/资料片，但不得推荐试玩版、原声带、工具或捏造条目。'
      : '可以推荐 PC、Nintendo、PlayStation、Xbox 与复古平台上真实存在的游戏本体，不得推荐 DLC、试玩版、原声带、工具或捏造条目。')
    + '默认推荐的核心依据是口味匹配、双人适配度和评价质量。'
    + '价格不计入核心适配分，不得因为价格高而排除游戏；只有核心适配相同时，才优先当前免费或正在打折的游戏。'
    + '只有用户在本次额外要求中明确给出预算上限时，预算才是硬过滤条件。';

  const lines = [
    `# ${userA} 玩过：${list(marksA, fmtMark)}`,
    `# ${userB} 玩过：${list(marksB, fmtMark)}`,
    `# 他们一起玩过：${list(sessions, fmtSession)}`,
    `# 「想和你一起玩」清单：${list(plan, fmtPlan)}`,
    `# 避雷池：${avoidTitles.length ? avoidTitles.slice(0, 40).map((t: any) => `《${t}》`).join('、') : '（无）'}`,
    allowSolo
      ? '# 本次明确允许推荐单人游戏。'
      : '# 必须适合两个人共同游玩，优先本地合作、在线合作、双人合作或双人对战；不要推荐纯单人游戏。',
    allowUnreleased
      ? '# 本次明确允许未发售或抢先体验游戏，理由中必须说明发售状态。'
      : '# 只推荐已正式发售的游戏；抢先体验视为未发售，禁止推荐。',
    allowDlc
      ? '# 本次明确允许 DLC、资料片、扩展包或追加内容；必须说明它所属的游戏本体。'
      : '# 只推荐游戏本体，不推荐 DLC、资料片、扩展包或追加内容。',
    '# 默认排除多半差评、差评或差评如潮的游戏；评价样本少不是硬排除条件。',
    '# 排序规则：口味匹配、双人适配度和评价质量构成核心适配；价格不参与核心排序，也不能排除高价游戏。',
    '# 只有核心适配相同时，才把“当前免费或正在打折”作为破同分信号；原价高低本身不参与排序。',
  ];
  if (priceCeiling != null) lines.push(`# 本次明确预算上限：国区当前售价不超过 ¥${(priceCeiling / 100).toFixed(2)}；这是硬过滤条件。`);
  if (userPrompt?.trim()) lines.push(`# 本次额外要求（务必满足）：${userPrompt.trim()}`);
  lines.push(
    '',
    '推荐 15 款，按核心适配从高到低排列，避开上面所有已出现和已拒绝的游戏。不要展开分析过程。',
    '每项都要给 taste_tier 和 together_tier，均为 1–5 的整数；5 代表非常匹配，1 代表较弱。两个分档都不得考虑价格。',
    '只输出 JSON 数组，每项形如：',
    `{"title":"中文或通用名称","original_title":"官方原名或null","year":2024,"igdb_id":12345,"steam_appid":123456,"taste_tier":5,"together_tier":5,"reason":"一句话具体理由，用「${userA}」「${userB}」称呼"}`,
    'igdb_id 或 steam_appid 确定时填写；不确定可填 null，但绝不能编造。不要输出 JSON 以外的文字。',
  );
  return [
    { role: 'system', content: system },
    { role: 'user', content: lines.join('\n') },
  ];
}
