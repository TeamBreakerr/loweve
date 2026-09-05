#!/usr/bin/env node
// 浏览器级断言：游戏推荐榜的对齐、尾部铺满、完整海报及悬浮推荐理由。

import { writeFile } from 'node:fs/promises';

const cdpEndpoint = process.argv[2] || 'http://127.0.0.1:9224';
const baseUrl = process.argv[3] || 'http://loweve:18083';
const screenshotPath = process.argv[4];
const viewportWidth = Number(process.argv[5]) || 1600;
const viewportHeight = Number(process.argv[6]) || 1100;

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

const cdp = await connect();
const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
try {
  await cdp.call('Page.enable', {}, sessionId);
  await cdp.call('Runtime.enable', {}, sessionId);
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: viewportWidth <= 680,
  }, sessionId);
  await cdp.call('Network.setCookie', {
    name: 'loweve_user_id', value: '1', domain: new URL(baseUrl).hostname, path: '/',
  }, sessionId);
  await cdp.call('Page.navigate', { url: `${baseUrl}/games` }, sessionId);

  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    ready = await evaluate(cdp, sessionId, "!!document.querySelector('.game-rank--hero')");
    if (ready) break;
    await sleep(100);
  }
  if (!ready) throw new Error('游戏推荐卡没有出现');
  await sleep(500);

  const metrics = await evaluate(cdp, sessionId, `
    (() => {
      const rect = el => { const r = el.getBoundingClientRect(); return {
        top: r.top, right: r.right, bottom: r.bottom, left: r.left,
        width: r.width, height: r.height,
      }; };
      const fontSize = el => el ? parseFloat(getComputedStyle(el).fontSize) : null;
      const hero = document.querySelector('.game-rank--hero');
      const mids = document.querySelector('.game-rank-mids');
      const rail = document.querySelector('.game-rank-rail');
      const minis = [...document.querySelectorAll('.game-mini')];
      const miniPosters = minis.map(card => card.querySelector('.game-mini__poster'));
      const miniBodies = minis.map(card => card.querySelector('.game-mini__body'));
      const miniTitles = minis.map(card => card.querySelector('h4'));
      const miniActions = minis.map(card => card.querySelector('.game-rank__actions'));
      const miniReasons = minis.map(card => card.querySelector('.game-mini__reason'));
      const miniRanks = minis.map(card => card.querySelector('.game-mini__poster > span'));
      const images = [...document.querySelectorAll('.game-rank-top .game-poster img, .game-rank-rail .game-poster img')];
      return {
        hero: rect(hero), mids: rect(mids), rail: rect(rail),
        miniCards: minis.map(rect), miniPosters: miniPosters.map(rect),
        miniBodies: miniBodies.map(el => ({
          rect: rect(el), paddingRight: parseFloat(getComputedStyle(el).paddingRight),
        })),
        miniTitleFontSizes: miniTitles.map(el => parseFloat(getComputedStyle(el).fontSize)),
        miniFactFontSizes: minis.map(card => fontSize(card.querySelector('.game-reco-facts span'))),
        miniPriceFontSizes: minis.map(card => fontSize(card.querySelector('.game-price strong') || card.querySelector('.game-price'))),
        miniActionSizes: miniActions.map(el => el.querySelector('.feedback') ? rect(el.querySelector('.feedback')) : null),
        miniActionBottoms: miniActions.map(el => rect(el).bottom),
        miniReasons: miniReasons.map(el => el ? {
          rect: rect(el),
          display: getComputedStyle(el).display,
          opacity: Number(getComputedStyle(el).opacity),
          pointerEvents: getComputedStyle(el).pointerEvents,
          zIndex: Number(getComputedStyle(el).zIndex),
          fontSize: parseFloat(getComputedStyle(el.querySelector('p')).fontSize),
          headingFontSize: parseFloat(getComputedStyle(el.querySelector('.game-mini__reason-hd')).fontSize),
          text: el.querySelector('p')?.textContent.trim() || '',
        } : null),
        miniRankZIndexes: miniRanks.map(el => Number(getComputedStyle(el).zIndex)),
        imageFits: images.map(img => getComputedStyle(img).objectFit),
        ranks: [...document.querySelectorAll('.game-rank__num, .game-mini__poster > span')]
          .map(el => el.textContent.trim()),
      };
    })()
  `);

  let hoverReason = null;
  if (viewportWidth > 680 && metrics.miniReasons[0]) {
    const poster = metrics.miniPosters[0];
    await cdp.call('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: poster.left + poster.width / 2,
      y: poster.top + poster.height / 2,
    }, sessionId);
    await sleep(800);
    hoverReason = await evaluate(cdp, sessionId, `
      (() => {
        const el = document.querySelector('.game-mini__reason');
        return el ? {
          opacity: Number(getComputedStyle(el).opacity),
          transform: getComputedStyle(el).transform,
          text: el.querySelector('p')?.textContent.trim() || '',
        } : null;
      })()
    `);
  }

  const errors = [];
  if (metrics.ranks.length !== 9) errors.push(`推荐数量不是 9：实际 ${metrics.ranks.length}`);
  if (metrics.miniCards.length !== 6) errors.push(`第 4–9 名卡片数量不是 6：实际 ${metrics.miniCards.length}`);
  if (viewportWidth > 960 && Math.abs(metrics.hero.bottom - metrics.mids.bottom) > 1) {
    errors.push(`前三名底边未对齐：hero=${metrics.hero.bottom.toFixed(1)}, mids=${metrics.mids.bottom.toFixed(1)}`);
  }
  metrics.miniPosters.forEach((poster, index) => {
    const card = metrics.miniCards[index];
    const ratio = poster.width / poster.height;
    if (viewportWidth > 680 && Math.abs(ratio - 2 / 3) > 0.01) {
      errors.push(`第 ${index + 4} 名海报不是 2:3：${poster.width.toFixed(1)}×${poster.height.toFixed(1)}`);
    }
    if (viewportWidth <= 680 && (Math.abs(poster.top - card.top) > 1 || Math.abs(poster.bottom - card.bottom) > 1)) {
      errors.push(`第 ${index + 4} 名手机海报没有铺满卡片高度：card=${card.top.toFixed(1)}..${card.bottom.toFixed(1)}, poster=${poster.top.toFixed(1)}..${poster.bottom.toFixed(1)}`);
    }
    const minPoster = viewportWidth <= 680 ? 80 : 148;
    const maxPoster = viewportWidth <= 680 ? 115 : 158;
    if (poster.width < minPoster || poster.width > maxPoster) errors.push(`第 ${index + 4} 名海报宽度 ${poster.width.toFixed(1)}px，不够紧凑`);
  });
  const rows = [];
  metrics.miniCards.forEach(card => {
    let row = rows.find(candidate => Math.abs(candidate[0].top - card.top) <= 1);
    if (!row) { row = []; rows.push(row); }
    row.push(card);
  });
  rows.forEach((row, index) => {
    row.sort((a, b) => a.left - b.left);
    if (Math.abs(row[0].left - metrics.rail.left) > 1 || Math.abs(row.at(-1).right - metrics.rail.right) > 1) {
      errors.push(`尾部第 ${index + 1} 行没有铺满：rail=${metrics.rail.left.toFixed(1)}..${metrics.rail.right.toFixed(1)}, cards=${row[0].left.toFixed(1)}..${row.at(-1).right.toFixed(1)}`);
    }
  });
  metrics.miniCards.forEach((card, index) => {
    const poster = metrics.miniPosters[index];
    if (viewportWidth > 680 && poster.width >= card.width * 0.5) errors.push(`第 ${index + 4} 名海报占卡片过半，信息区太挤`);
  });
  if (viewportWidth > 680) {
    metrics.miniCards.forEach((card, index) => {
      if (card.height > 240) errors.push(`第 ${index + 4} 名卡片高度 ${card.height.toFixed(1)}px，不够紧凑`);
      if (card.bottom - metrics.miniActionBottoms[index] > 14) errors.push(`第 ${index + 4} 名按钮下方留白过多`);
      if (metrics.miniBodies[index].paddingRight > 10) errors.push(`第 ${index + 4} 名内容区右内边距过大`);
      if (metrics.miniTitleFontSizes[index] < 15.5) errors.push(`第 ${index + 4} 名标题字号过小：${metrics.miniTitleFontSizes[index]}px`);
      if (metrics.miniFactFontSizes[index] != null && metrics.miniFactFontSizes[index] < 11) errors.push(`第 ${index + 4} 名信息标签字号过小：${metrics.miniFactFontSizes[index]}px`);
      if (metrics.miniPriceFontSizes[index] != null && metrics.miniPriceFontSizes[index] < 14) errors.push(`第 ${index + 4} 名价格字号过小：${metrics.miniPriceFontSizes[index]}px`);
      if (metrics.miniActionSizes[index] && (metrics.miniActionSizes[index].width < 36 || metrics.miniActionSizes[index].height < 34)) {
        errors.push(`第 ${index + 4} 名操作按钮过小`);
      }
    });
  }
  if (metrics.miniReasons.some(reason => !reason)) errors.push('第 4 名以后有卡片没有渲染推荐理由');
  metrics.miniReasons.forEach((reason, index) => {
    if (!reason) return;
    if (!reason.text) errors.push(`第 ${index + 4} 名推荐理由为空`);
    if (reason.opacity !== 0) errors.push(`第 ${index + 4} 名推荐理由默认可见：opacity=${reason.opacity}`);
    if (reason.pointerEvents !== 'none') errors.push(`第 ${index + 4} 名推荐理由会拦截点击`);
    if (reason.zIndex <= metrics.miniRankZIndexes[index]) errors.push(`第 ${index + 4} 名序号会压住推荐理由`);
    if (viewportWidth > 680 && reason.fontSize < 12.5) errors.push(`第 ${index + 4} 名悬浮理由字号过小：${reason.fontSize}px`);
    if (viewportWidth > 680 && reason.headingFontSize < 12) errors.push(`第 ${index + 4} 名悬浮标题字号过小：${reason.headingFontSize}px`);
    if (viewportWidth > 680) {
      const poster = metrics.miniPosters[index];
      const overlay = reason.rect;
      if (Math.max(
        Math.abs(overlay.right - poster.right),
        Math.abs(overlay.left - poster.left),
        Math.abs(overlay.width - poster.width),
        Math.abs(overlay.height - poster.height),
      ) > 1) errors.push(`第 ${index + 4} 名推荐理由浮层没有贴合封面`);
    }
  });
  if (viewportWidth > 680 && (!hoverReason || hoverReason.opacity < 0.95 || !hoverReason.text)) {
    errors.push(`鼠标悬浮后推荐理由没有显示：${JSON.stringify(hoverReason)}`);
  }
  if (viewportWidth <= 680) {
    const miniImageFits = metrics.imageFits.slice(-metrics.miniCards.length);
    if (miniImageFits.some(value => value !== 'cover')) errors.push(`手机尾部海报没有铺满：object-fit=${miniImageFits.join(', ')}`);
    const actionBottomInsets = metrics.miniCards.map((card, index) => card.bottom - metrics.miniActionBottoms[index]);
    if (Math.max(...actionBottomInsets) - Math.min(...actionBottomInsets) > 1) {
      errors.push(`手机尾部按钮底边距不齐：${actionBottomInsets.join(', ')}`);
    }
  } else if (metrics.imageFits.some(value => value !== 'contain')) {
    errors.push('推荐封面仍存在 object-fit 非 contain，可能裁切画面');
  }
  rows.forEach((row, rowIndex) => {
    const cardIndexes = row.map(card => metrics.miniCards.indexOf(card));
    const bottoms = cardIndexes.map(index => metrics.miniActionBottoms[index]);
    if (bottoms.length && Math.max(...bottoms) - Math.min(...bottoms) > 1) {
      errors.push(`尾部第 ${rowIndex + 1} 行按钮底边不齐：${bottoms.join(', ')}`);
    }
  });
  const expectedRanks = metrics.ranks.map((_, index) => String(index + 1).padStart(2, '0'));
  if (JSON.stringify(metrics.ranks) !== JSON.stringify(expectedRanks)) errors.push(`推荐序号不连续：${metrics.ranks.join(', ')}`);

  console.log(JSON.stringify({ metrics, hoverReason, errors }, null, 2));
  if (screenshotPath) {
    const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png' }, sessionId);
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  }
  if (errors.length) process.exitCode = 1;
} finally {
  await cdp.call('Target.closeTarget', { targetId }).catch(() => {});
  cdp.ws.close();
}
