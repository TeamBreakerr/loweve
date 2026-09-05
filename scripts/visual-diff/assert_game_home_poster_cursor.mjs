#!/usr/bin/env node
// 浏览器级断言：游戏首页所有可见封面都呈现可点击指针，并能进入对应详情页。

const cdpEndpoint = process.argv[2] || 'http://127.0.0.1:9229';
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await sleep(100);
  }
  throw new Error(`等待超时：${label}`);
}

const visiblePostersExpression = `
  [...document.querySelectorAll('.game-poster')].filter(poster => {
    const rect = poster.getBoundingClientRect();
    const style = getComputedStyle(poster);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  })
`;

const cdp = await connect();
const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
try {
  await cdp.call('Page.enable', {}, sessionId);
  await cdp.call('Runtime.enable', {}, sessionId);
  await cdp.call('Network.setCookie', {
    name: 'loweve_user_id', value: '1', domain: new URL(baseUrl).hostname, path: '/',
  }, sessionId);

  async function openHome() {
    await cdp.call('Page.navigate', { url: `${baseUrl}/games` }, sessionId);
    await waitUntil(cdp, sessionId,
      "document.querySelectorAll('.game-rank-top .game-poster, .game-rank-rail .game-poster').length > 0",
      '游戏推荐封面');
    await waitUntil(cdp, sessionId,
      "document.querySelectorAll('.game-history__card .game-poster').length > 0",
      '游戏历史与计划封面');
    await sleep(300);
  }

  await openHome();
  const posters = await evaluate(cdp, sessionId, `
    ${visiblePostersExpression}.map((poster, index) => {
      const card = poster.closest('article, li');
      const heading = card?.querySelector('h2, h3, h4');
      return {
        index,
        title: poster.querySelector('img')?.alt || heading?.textContent?.trim() || '(无标题)',
        cardClass: card?.className || '',
        cursor: getComputedStyle(poster).cursor,
      };
    })
  `);

  const results = [];
  for (const poster of posters) {
    await openHome();
    const before = await evaluate(cdp, sessionId, 'location.pathname');
    const clicked = await evaluate(cdp, sessionId, `(() => {
      const target = (${visiblePostersExpression})[${poster.index}];
      target?.click();
      return !!target;
    })()`);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if ((await evaluate(cdp, sessionId, 'location.pathname')) !== before) break;
      await sleep(50);
    }
    const after = await evaluate(cdp, sessionId, 'location.pathname');
    results.push({ ...poster, clicked, after, navigates: /^\/games\/work\/\d+$/.test(after) });
  }

  const errors = [];
  for (const result of results) {
    if (result.cursor !== 'pointer') {
      errors.push(`${result.title}（${result.cardClass || '未知区域'}）封面 cursor=${result.cursor}`);
    }
    if (!result.navigates) {
      errors.push(`${result.title}（${result.cardClass || '未知区域'}）封面点击后停留在 ${result.after}`);
    }
  }
  console.log(JSON.stringify({ count: results.length, results, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await cdp.call('Target.closeTarget', { targetId }).catch(() => {});
  cdp.ws.close();
}
