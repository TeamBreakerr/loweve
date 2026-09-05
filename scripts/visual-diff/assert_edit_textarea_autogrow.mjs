#!/usr/bin/env node
// 浏览器级回归断言：影视和游戏的个人记录编辑弹窗打开时，已有长感想必须完整撑开 textarea。

const cdpEndpoint = process.argv[2] || 'http://127.0.0.1:9225';
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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await sleep(100);
  }
  throw new Error(`等待超时：${label}`);
}

async function checkCase(cdp, testCase) {
  const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
  try {
    await cdp.call('Page.enable', {}, sessionId);
    await cdp.call('Runtime.enable', {}, sessionId);
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    await cdp.call('Network.setCookie', {
      name: 'loweve_user_id', value: '1', domain: new URL(baseUrl).hostname, path: '/',
    }, sessionId);
    await cdp.call('Page.addScriptToEvaluateOnNewDocument', {
      source: "localStorage.setItem('loweve.viewing','1')",
    }, sessionId);
    await cdp.call('Page.navigate', { url: `${baseUrl}${testCase.path}` }, sessionId);
    await waitUntil(cdp, sessionId, testCase.ready, `${testCase.name} 编辑入口`);
    const clicked = await evaluate(cdp, sessionId, testCase.click);
    if (!clicked) throw new Error(`${testCase.name} 编辑入口点击失败`);
    await waitUntil(cdp, sessionId, "!!document.querySelector('.modal-overlay.is-open textarea.review-input')", `${testCase.name} 文本框`);
    await sleep(200);
    const metrics = await evaluate(cdp, sessionId, `
      (() => {
        const el = document.querySelector('.modal-overlay.is-open textarea.review-input');
        return {
          valueLength: el.value.length,
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          inlineHeight: el.style.height,
        };
      })()
    `);
    const expanded = metrics.valueLength > 60 && metrics.clientHeight >= metrics.scrollHeight - 1;
    console.log(JSON.stringify({ name: testCase.name, ...metrics, expanded }));
    if (!expanded) throw new Error(`${testCase.name} 已有感想未自动撑开`);
  } finally {
    await cdp.call('Target.closeTarget', { targetId }).catch(() => {});
  }
}

const cases = [
  {
    name: '影视个人感想',
    path: '/work/23',
    ready: "!!document.querySelector('.record .card-edit')",
    click: "(()=>{const el=document.querySelector('.record .card-edit');el?.click();return !!el})()",
  },
  {
    name: '游戏个人感想',
    path: '/games/work/1',
    ready: "!!document.querySelector('.game-personal-record .card-edit')",
    click: "(()=>{const el=document.querySelector('.game-personal-record .card-edit');el?.click();return !!el})()",
  },
];

const cdp = await connect();
try {
  const errors = [];
  for (const testCase of cases) {
    try {
      await checkCase(cdp, testCase);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  cdp.ws.close();
}
