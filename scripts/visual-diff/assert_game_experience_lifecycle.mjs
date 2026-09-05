#!/usr/bin/env node
// 浏览器级断言：共同计划、正在玩、一起玩过在游戏详情中只能呈现一个共同状态。

const cdpEndpoint = process.argv[2] || 'http://127.0.0.1:9227';
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

  await cdp.call('Page.navigate', { url: `${baseUrl}/games` }, sessionId);
  const fixtures = await evaluate(cdp, sessionId, `
    Promise.all([
      fetch('/api/games/sessions?as_user=1').then(response => response.json()),
      fetch('/api/games/plan?as_user=1').then(response => response.json()),
      fetch('/api/games/marks?as_user=1').then(response => response.json()),
    ]).then(([sessionsBody, planBody, marksBody]) => {
      const sessions = sessionsBody.sessions || [];
      const plans = planBody.items || [];
      const marks = marksBody.marks || [];
      const occupied = new Set([...sessions, ...plans].map(item => item.work_id));
      const compact = item => item ? {
        work_id: item.work_id,
        title: item.work?.title || '',
        status: item.status || null,
        completed_at: item.completed_at ?? null,
      } : null;
      return {
        completed: compact(sessions.find(item => item.completed_at != null && item.work?.title === '双人成行')
          || sessions.find(item => item.completed_at != null)),
        pendingPlan: compact(plans.find(item => item.status === 'pending')),
        personalOnly: compact(marks.find(item => !occupied.has(item.work_id))),
      };
    })
  `);
  if (!fixtures.completed) throw new Error('没有可验证的一起玩过记录');
  if (!fixtures.pendingPlan) throw new Error('没有可验证的共同计划');

  const openWork = async workId => {
    await cdp.call('Page.navigate', { url: `${baseUrl}/games/work/${workId}` }, sessionId);
    await waitFor(cdp, sessionId, '.game-record-panel');
    await sleep(250);
    return evaluate(cdp, sessionId, `
      (() => ({
        title: document.querySelector('h1')?.textContent?.trim() || '',
        commonHeading: document.querySelector('.game-record-panel h2')?.textContent?.trim() || '',
        cards: Array.from(document.querySelectorAll('.game-record-card')).map(card => ({
          label: card.querySelector('.game-record-card__label')?.textContent?.trim() || '',
          text: card.textContent.replace(/\\s+/g, ' ').trim(),
        })),
        personalRecords: document.querySelectorAll('.game-personal-record').length,
        editablePersonalRecords: document.querySelectorAll('.game-personal-record .card-edit').length,
      }))()
    `);
  };

  const completed = await openWork(fixtures.completed.work_id);
  const pendingPlan = await openWork(fixtures.pendingPlan.work_id);
  const personalOnly = fixtures.personalOnly ? await openWork(fixtures.personalOnly.work_id) : null;
  const errors = [];

  if (completed.commonHeading !== '共同状态') errors.push(`共同区标题仍是“${completed.commonHeading}”`);
  if (completed.cards.length !== 1 || completed.cards[0]?.label !== '共同游玩') {
    errors.push(`一起玩过详情没有收敛为单一共同游玩状态：${completed.cards.map(card => card.label).join('、')}`);
  }
  if (completed.cards.some(card => card.label === '共同计划' || card.text.includes('想和你一起玩'))) {
    errors.push('一起玩过详情仍显示共同计划或加入计划入口');
  }
  if (completed.editablePersonalRecords !== 1) {
    errors.push(`一起玩过详情应只允许编辑当前用户的一条个人记录，实际 ${completed.editablePersonalRecords}`);
  }

  if (pendingPlan.cards.length !== 1 || pendingPlan.cards[0]?.label !== '共同计划') {
    errors.push(`待玩详情没有收敛为单一共同计划状态：${pendingPlan.cards.map(card => card.label).join('、')}`);
  }
  if (!pendingPlan.cards[0]?.text.includes('开始一起玩') || !pendingPlan.cards[0]?.text.includes('编辑计划')) {
    errors.push('共同计划详情缺少“开始一起玩”或“编辑计划”操作');
  }

  if (personalOnly) {
    if (personalOnly.cards.length !== 1 || personalOnly.cards[0]?.label !== '还没有共同记录') {
      errors.push(`仅个人记录详情没有收敛为空共同状态：${personalOnly.cards.map(card => card.label).join('、')}`);
    }
    if (!personalOnly.cards[0]?.text.includes('开始一起玩') || !personalOnly.cards[0]?.text.includes('想和你一起玩')) {
      errors.push('空共同状态缺少开始游玩或加入计划入口');
    }
  }

  console.log(JSON.stringify({ fixtures, completed, pendingPlan, personalOnly, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await cdp.call('Target.closeTarget', { targetId }).catch(() => {});
  cdp.ws.close();
}
