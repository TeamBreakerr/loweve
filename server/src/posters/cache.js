// server/src/posters/cache.js
import fs from 'node:fs/promises';
import path from 'node:path';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function cachePoster({
  source,
  id,
  url,
  referer = '',
  posterDir,
  fetch = globalThis.fetch,
}) {
  if (!source || !id || !url || !posterDir) return null;

  const safeSource = sanitizeSegment(source);
  const safeId = sanitizeSegment(id);
  const ext = extFromUrl(url) || 'jpg';
  const dir = path.join(posterDir, safeSource);
  const file = path.join(dir, `${safeId}.${ext}`);
  const apiUrl = `/api/posters/${safeSource}/${safeId}.${ext}`;

  if (await exists(file)) return apiUrl;

  await fs.mkdir(dir, { recursive: true });
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      ...(referer ? { Referer: referer } : {}),
    },
  });
  if (!res.ok) throw new Error(`poster_fetch_${res.status}`);

  const contentType = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || '';
  const typeExt = EXT_BY_TYPE[contentType];
  const finalFile = typeExt && typeExt !== ext ? path.join(dir, `${safeId}.${typeExt}`) : file;
  const finalUrl = typeExt && typeExt !== ext ? `/api/posters/${safeSource}/${safeId}.${typeExt}` : apiUrl;
  if (await exists(finalFile)) return finalUrl;

  const bytes = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(finalFile, bytes);
  return finalUrl;
}

function extFromUrl(url) {
  const pathname = new URL(url).pathname.toLowerCase();
  const ext = pathname.match(/\.([a-z0-9]+)$/)?.[1];
  return ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : '';
}

function sanitizeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
