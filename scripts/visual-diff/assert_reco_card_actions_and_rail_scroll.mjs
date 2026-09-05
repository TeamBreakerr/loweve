#!/usr/bin/env node
// 浏览器级断言：
//   1. 首页推荐卡（1 号大卡 / 2、3 号中卡）的反馈按钮永远整排落在卡片内 —— 卡片
//      overflow:hidden，评语一长就会把按钮顶出卡外被切掉（用户报的「按钮被边框挡住」）。
//   2. 影视与游戏首页的横向轨道：滑动过程中绝不吸附（CSS scroll-snap 关着，滚多少停多少，
//      否则每次滚动都被拽成整卡跳格），但停手 ~150ms 后由 JS 把最近一张卡对齐到内容左缘，
//      不留半张海报。

const cdpEndpoint = process.argv[2] || 'http://127.0.0.1:9233';
const baseUrl = process.argv[3] || 'http://loweve:18083';

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.sequence = 0;
    this.pending = new Map();
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result || {});
    };
  }

  call(method, params = {}, sessionId) {
    const id = ++this.sequence;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(message));
    });
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect() {
  let version;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      version = await fetch(`${cdpEndpoint}/json/version`).then(response => response.json());
      break;
    } catch {
      await sleep(100);
    }
  }
  if (!version?.webSocketDebuggerUrl) throw new Error('无法连接无头浏览器 CDP');
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  return new Cdp(socket);
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面脚本执行失败');
  return result.result?.value;
}

async function waitUntil(cdp, sessionId, expression, label) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (await evaluate(cdp, sessionId, expression)) return true;
    await sleep(100);
  }
  console.warn(`等待超时（跳过该项）：${label}`);
  return false;
}

// 反馈按钮整排都要在卡片可视区内：底边不越界，卡片自身也不该有纵向溢出。
const cardsExpression = `
  [...document.querySelectorAll('.rk-hero, .rk-mid')].map(card => {
    const actions = card.querySelector('.rk-actions');
    const cardRect = card.getBoundingClientRect();
    const actionsRect = actions?.getBoundingClientRect();
    return {
      kind: card.classList.contains('rk-hero') ? 'hero' : 'mid',
      title: card.querySelector('.rk-hero__title, .rk-mid__title')?.textContent?.trim() || '(无标题)',
      hasActions: !!actions,
      overflowPx: card.scrollHeight - card.clientHeight,
      actionsBottomOverflowPx: actionsRect ? Math.round(actionsRect.bottom - cardRect.bottom) : null,
      actionsTopOverflowPx: actionsRect ? Math.round(cardRect.top - actionsRect.top) : null,
    };
  })
`;

// 两段验证：先滚一个跟卡片宽度无关的零头，立刻读一次——有 CSS 吸附的话这时已经被拽到卡边界；
// 再滚到某张卡的中间停手，等对齐动画走完，落点必须贴着某张卡的左缘（或轨道两端）。
const railExpression = `(async () => {
  const settle = () => new Promise(resolve => setTimeout(resolve, 1400));
  const rails = [];
  for (const viewport of document.querySelectorAll('.horizontal-rail__viewport')) {
    if (viewport.scrollWidth <= viewport.clientWidth + 2) continue;
    const child = viewport.querySelector('.hcard, .game-history__card');
    const max = viewport.scrollWidth - viewport.clientWidth;
    const contentLeft = () => viewport.getBoundingClientRect().left
      + (parseFloat(getComputedStyle(viewport).paddingLeft) || 0);
    const nearestGap = () => Math.min(...[...viewport.children]
      .map(node => Math.abs(node.getBoundingClientRect().left - contentLeft())));

    viewport.scrollLeft = 0;
    await settle();
    viewport.scrollBy({ left: 37, behavior: 'instant' });
    await new Promise(resolve => setTimeout(resolve, 60));
    const duringGesture = Math.round(viewport.scrollLeft);

    const cardWidth = child ? child.getBoundingClientRect().width : 160;
    viewport.scrollLeft = Math.min(cardWidth * 1.6, max);
    const beforeSettle = Math.round(viewport.scrollLeft);
    await settle();
    const settled = Math.round(viewport.scrollLeft);

    rails.push({
      label: viewport.getAttribute('aria-label') || '(无名轨道)',
      snapType: getComputedStyle(viewport).scrollSnapType,
      childSnapAlign: child ? getComputedStyle(child).scrollSnapAlign : null,
      duringGesture,
      beforeSettle,
      settled,
      alignedGapPx: Math.round(nearestGap() * 10) / 10,
      atTrackEdge: settled <= 1 || settled >= Math.round(max) - 1,
    });
    viewport.scrollLeft = 0;
  }
  return rails;
})()`;

function railErrors(scope, rail) {
  const failures = [];
  if (rail.snapType !== 'none') failures.push(`${scope}：轨道「${rail.label}」开着 CSS 吸附（scroll-snap-type=${rail.snapType}）`);
  if (rail.childSnapAlign && rail.childSnapAlign !== 'none') {
    failures.push(`${scope}：轨道「${rail.label}」卡片仍有 scroll-snap-align=${rail.childSnapAlign}`);
  }
  if (rail.duringGesture !== 37) {
    failures.push(`${scope}：轨道「${rail.label}」滑动途中被拽到 ${rail.duringGesture}px（应原地停在 37px）`);
  }
  if (rail.alignedGapPx > 2 && !rail.atTrackEdge) {
    failures.push(`${scope}：轨道「${rail.label}」停手后落在 ${rail.settled}px，离最近卡片左缘还差 ${rail.alignedGapPx}px（海报被切一半）`);
  }
  return failures;
}

const cdp = await connect();
const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
try {
  await cdp.call('Page.enable', {}, sessionId);
  await cdp.call('Runtime.enable', {}, sessionId);
  await cdp.call('Network.setCookie', {
    name: 'loweve_user_id', value: '1', domain: new URL(baseUrl).hostname, path: '/',
  }, sessionId);

  const errors = [];
  const report = {};

  // 宽屏两栏（中卡高度被大卡撑定、最容易切按钮）、临界宽度、窄屏单列各测一遍。
  for (const [width, height] of [[2400, 1838], [1512, 982], [900, 1000], [420, 900]]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    await cdp.call('Page.navigate', { url: `${baseUrl}/` }, sessionId);
    const ready = await waitUntil(cdp, sessionId, "!!document.querySelector('.rk-hero, .rk-mid')", `${width}px 推荐卡`);
    await sleep(600);
    const cards = ready ? await evaluate(cdp, sessionId, cardsExpression) : [];
    const rails = await evaluate(cdp, sessionId, railExpression);
    report[`film@${width}`] = { cards, rails };
    for (const card of cards) {
      if (!card.hasActions) continue;
      if (card.actionsBottomOverflowPx > 0) {
        errors.push(`${width}px：${card.kind} 卡《${card.title}》反馈按钮被卡片下边切掉 ${card.actionsBottomOverflowPx}px`);
      }
      if (card.actionsTopOverflowPx > 0) {
        errors.push(`${width}px：${card.kind} 卡《${card.title}》反馈按钮被卡片上边切掉 ${card.actionsTopOverflowPx}px`);
      }
      if (card.overflowPx > 1) {
        errors.push(`${width}px：${card.kind} 卡《${card.title}》内容溢出卡片 ${card.overflowPx}px`);
      }
    }
    for (const rail of rails) errors.push(...railErrors(`${width}px`, rail));
  }

  // 游戏侧共用同一个 HorizontalRail，一并确认没有吸附回潮。
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 1512, height: 982, deviceScaleFactor: 1, mobile: false,
  }, sessionId);
  await cdp.call('Page.navigate', { url: `${baseUrl}/games` }, sessionId);
  await waitUntil(cdp, sessionId, "!!document.querySelector('.game-section')", '游戏首页');
  await sleep(600);
  const gameRails = await evaluate(cdp, sessionId, railExpression);
  report['games@1512'] = { rails: gameRails };
  for (const rail of gameRails) errors.push(...railErrors('游戏页', rail));

  console.log(JSON.stringify({ report, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await cdp.call('Target.closeTarget', { targetId }).catch(() => {});
  cdp.ws.close();
}
