#!/usr/bin/env node
// 浏览器级断言：影视“我的”卡片可进入详情，详情只展示各自的记录，不重复展示共看评价。

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

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

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

async function waitFor(cdp, sessionId, selector) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate(cdp, sessionId, `!!document.querySelector(${JSON.stringify(selector)})`)) return;
    await sleep(100);
  }
  throw new Error(`页面元素没有出现：${selector}`);
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
  await cdp.call('Page.addScriptToEvaluateOnNewDocument', {
    source: 'try{localStorage.setItem("loweve.viewing","1")}catch(error){}',
  }, sessionId);

  const openMe = async () => {
    await cdp.call('Page.navigate', { url: `${baseUrl}/me` }, sessionId);
    await waitFor(cdp, sessionId, '.title-card');
    await sleep(250);
  };

  await openMe();
  const cardLinks = await evaluate(cdp, sessionId, `
    Array.from(document.querySelectorAll('.title-card')).map(card => ({
      title: card.querySelector('.title-card__name')?.textContent?.trim() || '',
      posterHref: card.querySelector('.title-card__pw > a')?.getAttribute('href') || null,
      titleHref: card.querySelector('.title-card__name')?.closest('a')?.getAttribute('href') || null,
    }))
  `);
  const sessionWorkId = await evaluate(cdp, sessionId,
    `fetch('/api/sessions?as_user=1').then(response=>response.json()).then(body=>body.sessions?.[0]?.work_id)`);

  await evaluate(cdp, sessionId, `document.querySelector('.title-card__name')?.click()`);
  await sleep(400);
  const titleClickPath = await evaluate(cdp, sessionId, 'location.pathname');

  await openMe();
  await evaluate(cdp, sessionId, `document.querySelector('.title-card__pw > a')?.click()`);
  await sleep(400);
  const posterClickPath = await evaluate(cdp, sessionId, 'location.pathname');

  if (!sessionWorkId) throw new Error('没有可用于详情页断言的共看作品');
  await cdp.call('Page.navigate', { url: `${baseUrl}/work/${sessionWorkId}` }, sessionId);
  await waitFor(cdp, sessionId, '.section__title');
  await sleep(250);
  const detailSections = await evaluate(cdp, sessionId,
    `Array.from(document.querySelectorAll('.section__title')).map(node=>node.textContent.trim())`);

  const errors = [];
  const invalidCards = cardLinks.filter(card =>
    !card.posterHref?.startsWith('/work/') || !card.titleHref?.startsWith('/work/'));
  if (invalidCards.length) errors.push(`${invalidCards.length} 张“我的”卡片没有同时绑定海报和标题详情链接`);
  if (!titleClickPath.startsWith('/work/')) errors.push(`点击标题后仍在 ${titleClickPath}`);
  if (!posterClickPath.startsWith('/work/')) errors.push(`点击海报后仍在 ${posterClickPath}`);
  if (detailSections.includes('共看记录')) errors.push('详情页仍重复展示“共看记录”区块');

  console.log(JSON.stringify({
    cards: cardLinks.length,
    invalidCards,
    titleClickPath,
    posterClickPath,
    sessionWorkId,
    detailSections,
    errors,
  }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await cdp.call('Target.closeTarget', { targetId }).catch(() => {});
  cdp.ws.close();
}
