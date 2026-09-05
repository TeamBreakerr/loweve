#!/usr/bin/env node
// 浏览器级断言：影视和游戏 AI 推荐的各级海报都能进入对应作品详情页。

const cdpEndpoint = process.argv[2] || 'http://127.0.0.1:9228';
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

const cases = [
  { name: '影视第 1 名', page: '/', selector: '.rk-hero .poster', expected: /^\/work\/\d+$/ },
  { name: '影视第 2/3 名', page: '/', selector: '.rk-mid .poster', expected: /^\/work\/\d+$/ },
  { name: '影视第 4 名以后', page: '/', selector: '.rk-mini .poster', expected: /^\/work\/\d+$/ },
  { name: '游戏第 1 名', page: '/games', selector: '.game-rank--hero .game-poster', expected: /^\/games\/work\/\d+$/ },
  { name: '游戏第 2/3 名', page: '/games', selector: '.game-rank--mid .game-poster', expected: /^\/games\/work\/\d+$/ },
  { name: '游戏第 4 名以后', page: '/games', selector: '.game-mini .game-poster', expected: /^\/games\/work\/\d+$/ },
];

const cdp = await connect();
const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
try {
  await cdp.call('Page.enable', {}, sessionId);
  await cdp.call('Runtime.enable', {}, sessionId);
  await cdp.call('Network.setCookie', {
    name: 'loweve_user_id', value: '1', domain: new URL(baseUrl).hostname, path: '/',
  }, sessionId);

  const results = [];
  for (const testCase of cases) {
    await cdp.call('Page.navigate', { url: `${baseUrl}${testCase.page}` }, sessionId);
    await waitUntil(cdp, sessionId,
      `!!document.querySelector(${JSON.stringify(testCase.selector)})`, `${testCase.name}海报`);
    const before = await evaluate(cdp, sessionId, 'location.pathname');
    const clicked = await evaluate(cdp, sessionId, `(() => {
      const poster = document.querySelector(${JSON.stringify(testCase.selector)});
      poster?.click();
      return poster ? getComputedStyle(poster).cursor : null;
    })()`);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if ((await evaluate(cdp, sessionId, 'location.pathname')) !== before) break;
      await sleep(50);
    }
    const after = await evaluate(cdp, sessionId, 'location.pathname');
    results.push({ name: testCase.name, before, after, cursor: clicked, ok: testCase.expected.test(after) });
  }

  const errors = results.filter(result => !result.ok)
    .map(result => `${result.name}海报点击后仍在 ${result.after}`);
  console.log(JSON.stringify({ results, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await cdp.call('Target.closeTarget', { targetId }).catch(() => {});
  cdp.ws.close();
}
