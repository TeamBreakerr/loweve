#!/usr/bin/env node
// 浏览器级断言：首页影视与游戏的横向作品轨道都有可拖动、会自动隐藏的滚动条。

const cdpEndpoint = process.argv[2] || 'http://127.0.0.1:9230';
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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect() {
  let version;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { version = await fetch(`${cdpEndpoint}/json/version`).then(response => response.json()); break; }
    catch { await sleep(100); }
  }
  if (!version?.webSocketDebuggerUrl) throw new Error('无法连接无头浏览器 CDP');
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  return new Cdp(socket);
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面脚本执行失败');
  return result.result?.value;
}

async function inspect(cdp, sessionId, path, readySelector, selectors) {
  await cdp.call('Page.navigate', { url: `${baseUrl}${path}` }, sessionId);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate(cdp, sessionId, `!!document.querySelector(${JSON.stringify(readySelector)})`)) break;
    await sleep(100);
  }
  const inspectExpression = `(${JSON.stringify(selectors)}).map(selector => ({
      selector,
      found: !!document.querySelector(selector),
      scrollable: (() => {
        const bar = document.querySelector(selector);
        const viewport = bar?.closest('.horizontal-rail')?.querySelector('.horizontal-rail__viewport');
        return viewport ? viewport.scrollWidth > viewport.clientWidth + 2 : false;
      })(),
      visible: (() => {
        const bar = document.querySelector(selector);
        if (!bar) return false;
        const style = getComputedStyle(bar);
        const rect = bar.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden'
          && Number(style.opacity) > .5 && rect.width > 0 && rect.height > 0;
      })(),
    }))`;

  // 首页数据异步落位会晚于页面骨架出现；等待所有可滚动轨道进入自动隐藏状态，
  // 但设置上限，避免“永不隐藏”的旧实现被误判为通过。
  let idle = [];
  let idleWaitMs = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(100);
    idleWaitMs += 100;
    idle = await evaluate(cdp, sessionId, inspectExpression);
    if (idle.every(result => !result.scrollable || !result.visible)) break;
  }
  await evaluate(cdp, sessionId, `(() => {
    for (const selector of ${JSON.stringify(selectors)}) {
      const bar = document.querySelector(selector);
      const rail = bar?.closest('.horizontal-rail');
      const viewport = rail?.querySelector('.horizontal-rail__viewport');
      if (!viewport || viewport.scrollWidth <= viewport.clientWidth + 2) continue;
      rail.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
      viewport.dispatchEvent(new Event('scroll'));
    }
  })()`);
  await sleep(100);
  const active = await evaluate(cdp, sessionId, inspectExpression);
  await sleep(1400);
  const settled = await evaluate(cdp, sessionId, inspectExpression);
  return selectors.map((selector, index) => ({
    selector,
    found: idle[index].found,
    scrollable: idle[index].scrollable,
    idleVisible: idle[index].visible,
    activeVisible: active[index].visible,
    settledVisible: settled[index].visible,
    idleWaitMs,
  }));
}

const cdp = await connect();
const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
try {
  await cdp.call('Page.enable', {}, sessionId);
  await cdp.call('Runtime.enable', {}, sessionId);
  // 覆盖用户反馈截图的真实宽屏尺寸；旧测试只跑浏览器默认窄视口，
  // 会漏掉“下方刚好不溢出，因此整条轨道被隐藏”的问题。
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 2400, height: 1838, deviceScaleFactor: 1, mobile: false,
  }, sessionId);
  await cdp.call('Network.setCookie', {
    name: 'loweve_user_id', value: '1', domain: new URL(baseUrl).hostname, path: '/',
  }, sessionId);

  const film = await inspect(cdp, sessionId, '/', '#plan', [
    '[data-home-rail="film-completed"] .horizontal-rail__bar',
    '#plan .horizontal-rail__bar',
  ]);
  const planCoverage = await evaluate(cdp, sessionId, `(async () => {
    const response = await fetch('/api/plan');
    const payload = await response.json();
    const expected = (payload.items || []).filter(item => item.status !== 'done' && item.status !== 'dropped').length;
    return { expected, rendered: document.querySelectorAll('#plan .hcard').length };
  })()`);
  const games = await inspect(cdp, sessionId, '/games', '.game-section', [
    '[data-home-rail="games-playing"] .horizontal-rail__bar',
    '[data-home-rail="games-completed"] .horizontal-rail__bar',
    '[data-home-rail="games-plan"] .horizontal-rail__bar',
  ]);
  const gameCoverage = await evaluate(cdp, sessionId, `(async () => {
    const [sessionsResponse, planResponse] = await Promise.all([
      fetch('/api/games/sessions'), fetch('/api/games/plan'),
    ]);
    const sessions = (await sessionsResponse.json()).sessions || [];
    const plan = (await planResponse.json()).items || [];
    return {
      playing: {
        expected: sessions.filter(item => item.completed_at == null).length,
        rendered: document.querySelectorAll('[data-home-rail="games-playing"] .game-history__card').length,
      },
      completed: {
        expected: sessions.filter(item => item.completed_at != null).length,
        rendered: document.querySelectorAll('[data-home-rail="games-completed"] .game-history__card').length,
      },
      plan: {
        expected: plan.filter(item => item.status === 'pending').length,
        rendered: document.querySelectorAll('[data-home-rail="games-plan"] .game-history__card').length,
      },
    };
  })()`);
  const results = [...film, ...games];
  const errors = results.flatMap(result => {
    if (!result.found) return [`缺少滚动条：${result.selector}`];
    if (!result.scrollable) return [];
    const failures = [];
    if (result.idleVisible) failures.push(`滚动条首次静置后没有隐藏：${result.selector}`);
    if (!result.activeVisible) failures.push(`滚动条交互时没有显示：${result.selector}`);
    if (result.settledVisible) failures.push(`滚动条再次静置后没有隐藏：${result.selector}`);
    return failures;
  });
  if (planCoverage.rendered !== planCoverage.expected) {
    errors.push(`想看清单被首页截断：API ${planCoverage.expected} 部，实际渲染 ${planCoverage.rendered} 部`);
  }
  const planRail = film.find(result => result.selector === '#plan .horizontal-rail__bar');
  if (planCoverage.expected > 5 && !planRail?.scrollable) {
    errors.push(`想看清单有 ${planCoverage.expected} 部但没有形成横向溢出`);
  }
  for (const [name, coverage] of Object.entries(gameCoverage)) {
    if (coverage.rendered !== coverage.expected) {
      errors.push(`游戏首页 ${name} 被截断：API ${coverage.expected} 部，实际渲染 ${coverage.rendered} 部`);
    }
  }
  console.log(JSON.stringify({ results, planCoverage, gameCoverage, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await cdp.call('Target.closeTarget', { targetId }).catch(() => {});
  cdp.ws.close();
}
