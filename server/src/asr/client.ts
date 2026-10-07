// 语音转写：复用同网的 asr-app（火山 Doubao seed-asr，自带说话人分离），不改它一行。
// asr-app 的接口：POST /api/jobs（multipart file）→ {job_id}；GET /api/jobs/{id} → {status, stage, message}；
// 结果只有 HTML 页 GET /result/{id}，转写 markdown 藏在页内 <textarea id="md">（给「复制全文」按钮用），
// 每行形如「[mm:ss] 说话人N：文本」。这里抓页面取出它解析成结构化的发言列表。
import fs from 'node:fs';

export class AsrError extends Error {
  code: string; status: number; detail: string;
  constructor(code: string, status = 0, detail = '') {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export type TranscriptTurn = { speaker: string; start: number; text: string };

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// asr-app 用 Python html.escape（& < > " ' → &amp; &lt; &gt; &quot; &#x27;），这里按通用实体还原
export function unescapeHtml(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

// 「[mm:ss] 说话人N：文本」；分钟可能超过两位（长讨论），说话人标签可能是 ?（Doubao 没给）
export function parseTranscriptMarkdown(md: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^\[(\d+):(\d{2})\]\s*说话人(.+?)：(.*)$/);
    if (!m || !m[4].trim()) continue;
    turns.push({ speaker: m[3].trim(), start: Number(m[1]) * 60 + Number(m[2]), text: m[4].trim() });
  }
  return turns;
}

export function extractTranscript(html: string): TranscriptTurn[] {
  const m = html.match(/<textarea id="md"[^>]*>([\s\S]*?)<\/textarea>/);
  if (!m) throw new AsrError('asr_result_unparseable');
  return parseTranscriptMarkdown(unescapeHtml(m[1]));
}

export type AsrJobStatus = { status: string; stage?: string; message?: string; n_speakers?: number };

export function createAsrClient({ resolve, fetch = globalThis.fetch }: { resolve: () => { baseUrl?: string }; fetch?: any }) {
  const base = () => {
    const b = String(resolve().baseUrl || '').trim().replace(/\/+$/, '');
    if (!b) throw new AsrError('asr_unconfigured');
    return b;
  };

  async function request(url: string, init: any = {}, timeoutMs = 30_000) {
    let res: any;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new AsrError(e.name === 'TimeoutError' ? 'asr_timeout' : 'asr_network', 0, e.message);
    }
    if (!res.ok) throw new AsrError('asr_http', res.status, String(await res.text().catch(() => '')).slice(0, 300));
    return res;
  }

  return {
    isConfigured: () => Boolean(String(resolve().baseUrl || '').trim()),

    // 文件名会成为 asr-app 历史列表里的标题；用 ASCII，避免 multipart 里的非 ASCII 文件名被解成乱码
    async submit(filePath: string, filename: string, mime: string) {
      const form = new FormData();
      form.append('file', await fs.openAsBlob(filePath, { type: mime }), filename);
      const res = await request(`${base()}/api/jobs`, { method: 'POST', body: form }, 10 * 60_000);
      const body = await res.json().catch(() => null);
      if (!body?.job_id) throw new AsrError('asr_bad_response');
      return String(body.job_id);
    },

    async status(jobId: string): Promise<AsrJobStatus> {
      const res = await request(`${base()}/api/jobs/${encodeURIComponent(jobId)}`);
      return res.json();
    },

    async transcript(jobId: string) {
      const res = await request(`${base()}/result/${encodeURIComponent(jobId)}`);
      return extractTranscript(await res.text());
    },
  };
}

export type AsrClient = ReturnType<typeof createAsrClient>;
