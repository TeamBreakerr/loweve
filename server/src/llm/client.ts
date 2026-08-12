// server/src/llm/client.js
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_CONTENT_CHARS = 100_000;

export class LlmError extends Error {
  code: string; status: number; body: any;
  constructor(code: any, status = 0, body: any = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

// 健壮解析：剥 ```json fence、截首个 [ … 末个 ]、JSON.parse，必须是数组
export function parseJsonArray(text: any) {
  if (typeof text !== 'string') throw new LlmError('llm_parse');
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) throw new LlmError('llm_parse');
  let arr: any;
  try { arr = JSON.parse(t.slice(start, end + 1)); }
  catch { throw new LlmError('llm_parse'); }
  if (!Array.isArray(arr)) throw new LlmError('llm_parse');
  return arr;
}

export function createLlmClient({ baseUrl, apiKey, model, resolve, fetch = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: { baseUrl?: string; apiKey?: string; model?: string; resolve?: () => any; fetch?: any; timeoutMs?: number } = {}) {
  // 静态值或 resolve()（运行时从 DB 读，设置页改完即时生效）
  const getCfg = resolve || (() => ({ baseUrl, apiKey, model }));
  const endpointReady = (c: any) => Boolean(c.baseUrl && c.apiKey);
  const ready = (c: any) => Boolean(c.baseUrl && c.apiKey && c.model);

  async function readStream(res: any) {
    const reader = res.body?.getReader?.();
    if (!reader) throw new LlmError('llm_stream_invalid');
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';

    const consumeEvent = (event: string) => {
      const data = event.split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')
        .trim();
      if (!data || data === '[DONE]') return data === '[DONE]';
      let payload: any;
      try { payload = JSON.parse(data); } catch { return false; }
      const piece = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content;
      // 推理模型可能持续发送 reasoning_content；推荐 JSON 只需要最终 content。
      if (typeof piece === 'string') {
        content += piece;
        if (content.length > MAX_CONTENT_CHARS) throw new LlmError('llm_output_too_large');
      }
      return false;
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';
      for (const event of events) {
        if (consumeEvent(event)) return content;
      }
      if (done) {
        if (buffer.trim()) consumeEvent(buffer);
        return content;
      }
    }
  }

  async function chat(messages: any, options: { timeoutMs?: number } = {}) {
    const cfg = getCfg();
    if (!ready(cfg)) throw new LlmError('llm_unconfigured');
    // 流式消费让代理尽早交付响应头，并避免把大量 reasoning_content 缓存在内存里。
    // 最终仍只返回完整 content，保持上层 JSON 校验接口不变。
    const body = JSON.stringify({ model: cfg.model, messages, stream: true });
    const attempts = [0, 1];
    let lastErr: any;
    const requestTimeoutMs = Math.max(1, Math.min(timeoutMs, options.timeoutMs ?? timeoutMs));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 循环仅用于控制重试次数，不需要下标，非死代码
    for (const i of attempts) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), requestTimeoutMs);
      try {
        const endpoint = String(cfg.baseUrl).replace(/\/+$/, '');
        const res = await fetch(`${endpoint}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
          body,
          signal: ctrl.signal,
        });
        if (!res.ok) {
          lastErr = new LlmError('llm_http', res.status, await res.json().catch(() => ({})));
          if (res.status >= 400 && res.status < 500) throw lastErr;  // 4xx 不重试
          continue;  // 5xx 重试
        }
        const contentType = res.headers?.get?.('content-type') || '';
        let content: any;
        if (/text\/event-stream/i.test(contentType)) content = await readStream(res);
        else {
          // 少数兼容端点即使收到 stream=true 仍返回普通 JSON，保持兼容。
          const j = await res.json();
          content = j.choices?.[0]?.message?.content;
        }
        if (typeof content !== 'string' || !content.trim()) { lastErr = new LlmError('llm_empty'); continue; }
        return content;
      } catch (e) {
        if (e instanceof LlmError) { if (e.code === 'llm_http' && e.status < 500) throw e; lastErr = e; }
        else lastErr = new LlmError(e.name === 'AbortError' ? 'llm_timeout' : 'llm_network', 0, { message: e.message });
        // 相同长提示在超时后立刻完整重跑只会把一次等待放大成两次；超时交给用户显式重试。
        if (lastErr.code === 'llm_timeout') throw lastErr;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  async function listModels() {
    const cfg = getCfg();
    if (!endpointReady(cfg)) throw new LlmError('llm_unconfigured');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const endpoint = String(cfg.baseUrl).replace(/\/+$/, '');
      const res = await fetch(`${endpoint}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new LlmError('llm_models_http', res.status, await res.json().catch(() => ({})));
      const body = await res.json();
      if (!Array.isArray(body?.data)) throw new LlmError('llm_models_invalid');
      const ids = body.data
        .map((entry: any) => typeof entry?.id === 'string' ? entry.id.trim() : '')
        .filter(Boolean);
      return [...new Set<string>(ids)].sort();
    } catch (e) {
      if (e instanceof LlmError) throw e;
      throw new LlmError(e.name === 'AbortError' ? 'llm_timeout' : 'llm_network', 0, { message: e.message });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    isConfigured() { return ready(getCfg()); },
    getModel() { return getCfg().model || ''; },
    chat,
    listModels,
  };
}
