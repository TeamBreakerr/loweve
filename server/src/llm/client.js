// server/src/llm/client.js
const DEFAULT_TIMEOUT_MS = 60000;

export class LlmError extends Error {
  constructor(code, status = 0, body = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

// 健壮解析：剥 ```json fence、截首个 [ … 末个 ]、JSON.parse，必须是数组
export function parseJsonArray(text) {
  if (typeof text !== 'string') throw new LlmError('llm_parse');
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) throw new LlmError('llm_parse');
  let arr;
  try { arr = JSON.parse(t.slice(start, end + 1)); }
  catch { throw new LlmError('llm_parse'); }
  if (!Array.isArray(arr)) throw new LlmError('llm_parse');
  return arr;
}

export function createLlmClient({ baseUrl, apiKey, model, resolve, fetch = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  // 静态值或 resolve()（运行时从 DB 读，设置页改完即时生效）
  const getCfg = resolve || (() => ({ baseUrl, apiKey, model }));
  const ready = (c) => Boolean(c.baseUrl && c.apiKey && c.model);

  async function chat(messages) {
    const cfg = getCfg();
    if (!ready(cfg)) throw new LlmError('llm_unconfigured');
    const body = JSON.stringify({ model: cfg.model, messages });
    const attempts = [0, 1];
    let lastErr;
    for (const i of attempts) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
          body,
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          lastErr = new LlmError('llm_http', res.status, await res.json().catch(() => ({})));
          if (res.status >= 400 && res.status < 500) throw lastErr;  // 4xx 不重试
          continue;  // 5xx 重试
        }
        const j = await res.json();
        const content = j.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) { lastErr = new LlmError('llm_empty'); continue; }
        return content;
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof LlmError) { if (e.code === 'llm_http' && e.status < 500) throw e; lastErr = e; }
        else lastErr = new LlmError(e.name === 'AbortError' ? 'llm_timeout' : 'llm_network', 0, { message: e.message });
      }
    }
    throw lastErr;
  }

  return { isConfigured() { return ready(getCfg()); }, chat };
}
