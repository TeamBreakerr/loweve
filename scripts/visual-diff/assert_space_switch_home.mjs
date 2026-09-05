#!/usr/bin/env node
// 浏览器级断言：点击顶部影视/游戏空间按钮时，一律进入对应空间首页。

const cdpEndpoint = process.argv[2] || 'http://127.0.0.1:9231';
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
  const result = await cdp.call('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面脚本执行失败');
  return result.result?.value;
}

async function waitFor(cdp, sessionId, expression, label) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await evaluate(cdp, sessionId, expression)) return true;
    await sleep(50);
  }
  throw new Error(`等待超时：${label}`);
}

const cases = [
  { from: '/me', button: '影视', expected: '/' },
  { from: '/me', button: '游戏', expected: '/games' },
  { from: '/games/me', button: '影视', expected: '/' },
  { from: '/games/me', button: '游戏', expected: '/games' },
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
    await cdp.call('Page.navigate', { url: `${baseUrl}${testCase.from}` }, sessionId);
    await waitFor(cdp, sessionId, `document.querySelectorAll('.mode-switch__item').length === 2`, '空间切换按钮');
    const clicked = await evaluate(cdp, sessionId, `(() => {
      const button = [...document.querySelectorAll('.mode-switch__item')]
        .find(item => item.textContent?.trim() === ${JSON.stringify(testCase.button)});
      button?.click();
      return !!button;
    })()`);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await evaluate(cdp, sessionId, `location.pathname === ${JSON.stringify(testCase.expected)}`)) break;
      await sleep(50);
    }
    const actual = await evaluate(cdp, sessionId, 'location.pathname');
    results.push({ ...testCase, clicked, actual, ok: clicked && actual === testCase.expected });
  }

  const errors = results.filter(result => !result.ok)
    .map(result => `${result.from} 点击${result.button}后应进入 ${result.expected}，实际为 ${result.actual}`);
  console.log(JSON.stringify({ results, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await cdp.call('Target.closeTarget', { targetId }).catch(() => {});
  cdp.ws.close();
}
