#!/usr/bin/env node
// 浏览器级断言：豆瓣、Bangumi 与游戏详情页各显示 3 条热评，且影视绝不回退 TMDB。

import { mkdir, writeFile } from 'node:fs/promises';

const cdpEndpoint = process.argv[2] || 'http://127.0.0.1:9231';
const baseUrl = process.argv[3] || 'http://loweve:18083';
const screenshotDir = process.argv[4] || '';
const doubanFilmId = process.argv[5] || '13';
const bangumiFilmId = process.argv[6] || '16';
const gameId = process.argv[7] || '1';

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

async function inspect(cdp, sessionId, sample, viewport) {
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile,
  }, sessionId);
  await cdp.call('Page.navigate', { url: `${baseUrl}${sample.path}` }, sessionId);
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (await evaluate(cdp, sessionId, "document.querySelectorAll('.hot-review').length === 3")) break;
    await sleep(100);
  }
  await evaluate(cdp, sessionId, "document.querySelector('.hot-reviews')?.scrollIntoView({block:'start'})");
  await sleep(300);
  const metrics = await evaluate(cdp, sessionId, `(() => {
    const rect = element => { const r = element.getBoundingClientRect(); return {
      top:r.top, right:r.right, bottom:r.bottom, left:r.left, width:r.width, height:r.height,
    }; };
    const section = document.querySelector('.hot-reviews');
    const cards = [...document.querySelectorAll('.hot-review')];
    return {
      source: document.querySelector('.hot-reviews__source')?.textContent?.trim() || '',
      heading: document.querySelector('.hot-reviews .section__title')?.textContent?.trim() || '',
      state: document.querySelector('.hot-reviews__state')?.textContent?.trim() || '',
      section: section ? rect(section) : null,
      cards: cards.map(card => ({ rect:rect(card), content:card.querySelector('.hot-review__content')?.textContent?.trim() || '' })),
      viewportWidth: innerWidth,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
    };
  })()`);
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    const shot = await cdp.call('Page.captureScreenshot', { format: 'png' }, sessionId);
    await writeFile(`${screenshotDir}/${sample.name}--${viewport.name}.png`, Buffer.from(shot.data, 'base64'));
  }
  return metrics;
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
  const samples = [
    { name: 'film-douban-hot-reviews', path: `/work/${doubanFilmId}`, source: '豆瓣', heading: '热门短评' },
    { name: 'film-bangumi-hot-reviews', path: `/work/${bangumiFilmId}`, source: 'Bangumi', heading: 'Bangumi 短评' },
    { name: 'game-hot-reviews', path: `/games/work/${gameId}`, source: 'Steam', heading: '热门短评' },
  ];
  const viewports = [
    { name: 'desktop', width: 1280, height: 900, mobile: false },
    { name: 'mobile', width: 390, height: 844, mobile: true },
  ];
  const results = [];
  const errors = [];
  for (const sample of samples) {
    for (const viewport of viewports) {
      const metrics = await inspect(cdp, sessionId, sample, viewport);
      results.push({ sample: sample.name, viewport: viewport.name, metrics });
      if (metrics.cards.length !== 3) errors.push(`${sample.name}/${viewport.name} 热评数=${metrics.cards.length}`);
      if (!metrics.source) errors.push(`${sample.name}/${viewport.name} 缺少来源`);
      if (!metrics.source.includes(sample.source)) errors.push(`${sample.name}/${viewport.name} 来源错误：${metrics.source}`);
      if (metrics.heading !== sample.heading) errors.push(`${sample.name}/${viewport.name} 标题错误：${metrics.heading}`);
      if (metrics.source.includes('TMDB')) errors.push(`${sample.name}/${viewport.name} 不应使用 TMDB 热评`);
      if (metrics.cards.some(card => !card.content)) errors.push(`${sample.name}/${viewport.name} 存在空热评`);
      if (metrics.pageOverflow > 1) errors.push(`${sample.name}/${viewport.name} 页面横向溢出 ${metrics.pageOverflow}px`);
      const tops = metrics.cards.map(card => Math.round(card.rect.top));
      if (viewport.mobile && new Set(tops).size !== metrics.cards.length) errors.push(`${sample.name}/mobile 没有单列堆叠`);
      if (!viewport.mobile && new Set(tops).size !== 1) errors.push(`${sample.name}/desktop 没有三列同排`);
      if (metrics.cards.some(card => card.rect.left < -1 || card.rect.right > viewport.width + 1)) {
        errors.push(`${sample.name}/${viewport.name} 卡片超出视口`);
      }
    }
  }
  console.log(JSON.stringify({ results, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await cdp.call('Target.closeTarget', { targetId }).catch(() => {});
  cdp.ws.close();
}
