// server/test/llm.test.js
import assert from 'node:assert/strict';
import { createLlmClient, parseJsonArray, LlmError } from '../src/llm/client.js';

describe('llm/client', () => {
  it('isConfigured 需 baseUrl+apiKey+model 齐全', () => {
    assert.equal(createLlmClient({ baseUrl: 'x', apiKey: 'k', model: 'm' }).isConfigured(), true);
    assert.equal(createLlmClient({ baseUrl: '', apiKey: 'k', model: 'm' }).isConfigured(), false);
    assert.equal(createLlmClient({ baseUrl: 'x', apiKey: '', model: 'm' }).isConfigured(), false);
  });

  it('chat 构造正确请求并取 content', async () => {
    let captured: any;
    const fakeFetch = async (url: any, opts: any) => {
      captured = { url, opts };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '[]' } }] }) };
    };
    const client = createLlmClient({ baseUrl: 'http://p/v1', apiKey: 'KEY', model: 'test-model', fetch: fakeFetch });
    const out = await client.chat([{ role: 'user', content: 'hi' }]);
    assert.equal(out, '[]');
    assert.equal(captured.url, 'http://p/v1/chat/completions');
    assert.equal(captured.opts.method, 'POST');
    assert.equal(captured.opts.headers.Authorization, 'Bearer KEY');
    const body = JSON.parse(captured.opts.body);
    assert.equal(body.model, 'test-model');
    assert.deepEqual(body.messages, [{ role: 'user', content: 'hi' }]);
  });

  it('未配置 chat 抛 LlmError', async () => {
    const client = createLlmClient({ baseUrl: '', apiKey: '', model: '' });
    await assert.rejects(() => client.chat([]), LlmError);
  });

  it('5xx 重试一次后抛错', async () => {
    let calls = 0;
    const client = createLlmClient({
      baseUrl: 'http://p/v1', apiKey: 'k', model: 'm',
      fetch: async () => { calls++; return { ok: false, status: 500, json: async () => ({}) }; },
    });
    await assert.rejects(() => client.chat([]), LlmError);
    assert.equal(calls, 2);  // 首次 + 1 次重试
  });

  it('超时抛 LlmError', async () => {
    const client = createLlmClient({
      baseUrl: 'http://p/v1', apiKey: 'k', model: 'm', timeoutMs: 5,
      fetch: (_u: any, opts: any) => new Promise((_res, rej) => {
        opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    });
    await assert.rejects(() => client.chat([]), LlmError);
  });

  it('parseJsonArray 剥 fence + 截取数组', () => {
    assert.deepEqual(parseJsonArray('```json\n[{"a":1}]\n```'), [{ a: 1 }]);
    assert.deepEqual(parseJsonArray('前言 [1,2,3] 后语'), [1, 2, 3]);
    assert.throws(() => parseJsonArray('no array here'), LlmError);
    assert.throws(() => parseJsonArray('{"not":"array"}'), LlmError);
  });
});
