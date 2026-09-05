#!/usr/bin/env node
// 浏览器级断言：《特别的她》完全遵循 TMDB 的 5 季定义，“整部”明确不是第 6 季。

const cdpEndpoint = process.argv[2] || 'http://127.0.0.1:9232';
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

async function waitUntil(cdp, sessionId, expression, label) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await sleep(100);
  }
  throw new Error(`等待超时：${label}`);
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
  await cdp.call('Page.navigate', { url: `${baseUrl}/` }, sessionId);
  await waitUntil(cdp, sessionId, "!!document.querySelector('#plan .btn--rose')", '影视想看添加按钮');
  await evaluate(cdp, sessionId, "document.querySelector('#plan .btn--rose').click()");
  await waitUntil(cdp, sessionId, "!!document.querySelector('.modal .search-box input')", '添加弹窗搜索框');
  await evaluate(cdp, sessionId, `(() => {
    const input = document.querySelector('.modal .search-box input');
    input.value = '特别的她';
    input.dispatchEvent(new Event('input', { bubbles:true }));
  })()`);
  await waitUntil(cdp, sessionId,
    "[...document.querySelectorAll('.results .result')].some(row => row.textContent.includes('特别的她') && row.textContent.includes('剧/番'))",
    '《特别的她》剧集搜索结果');
  await evaluate(cdp, sessionId, `(() => {
    const row = [...document.querySelectorAll('.results .result')]
      .find(item => item.textContent.includes('特别的她') && item.textContent.includes('剧/番'));
    row.click();
  })()`);
  await waitUntil(cdp, sessionId,
    "document.querySelectorAll('.modal .season-opt').length === 5",
    'TMDB 五季选择器');
  const result = await evaluate(cdp, sessionId, `({
    subtitle: document.querySelector('.modal .result.is-selected .result__sub')?.textContent.trim() || '',
    wholeOption: document.querySelector('.modal .season-all-opt')?.textContent.trim() || '',
    seasonOptions: [...document.querySelectorAll('.modal .season-opt')].map(item => item.textContent.trim()),
  })`);
  const errors = [];
  if (result.subtitle.includes('全 6 集')) errors.push(`仍把首季集数当整部：${result.subtitle}`);
  if (result.wholeOption !== '整部（非单季）') errors.push(`整部入口语义不清：${result.wholeOption}`);
  if (result.seasonOptions.join('、') !== '第1季、第2季、第3季、第4季、第5季') {
    errors.push(`TMDB 季选择不一致：${result.seasonOptions.join('、')}`);
  }
  console.log(JSON.stringify({ result, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await cdp.call('Target.closeTarget', { targetId }).catch(() => {});
  cdp.ws.close();
}
