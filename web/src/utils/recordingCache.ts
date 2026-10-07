// 录音防丢：MediaRecorder 每 5 秒吐一片，边录边追加进 IndexedDB。浏览器崩溃、误关页面、
// 手机杀后台后，回到点评室还能把已录的部分拼起来上传。上传成功才清掉。
// IndexedDB 不可用（隐私模式等）时全部静默降级——录音照样在内存里，只是没有防丢。
const DB_NAME = 'loweve-recordings';
const CHUNKS = 'chunks';   // keyPath [key, seq]，只追加
const META = 'meta';       // keyPath key

export interface PendingMeta { key: string; mime: string; startedAt: number; elapsedMs: number }

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(CHUNKS, { keyPath: ['key', 'seq'] });
        req.result.createObjectStore(META, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveMeta(meta: PendingMeta) {
  try {
    const db = await openDb();
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).put(meta);
    await done(tx);
  } catch { /* 无防丢也能录 */ }
}

export async function appendChunk(key: string, seq: number, blob: Blob) {
  try {
    const db = await openDb();
    const tx = db.transaction(CHUNKS, 'readwrite');
    tx.objectStore(CHUNKS).put({ key, seq, blob });
    await done(tx);
  } catch { /* 同上 */ }
}

export async function loadPending(key: string): Promise<{ meta: PendingMeta; blob: Blob } | null> {
  try {
    const db = await openDb();
    const tx = db.transaction([META, CHUNKS], 'readonly');
    const metaReq = tx.objectStore(META).get(key);
    const chunksReq = tx.objectStore(CHUNKS).getAll(IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]));
    await done(tx);
    const meta = metaReq.result as PendingMeta | undefined;
    const chunks = (chunksReq.result || []) as { seq: number; blob: Blob }[];
    if (!meta || !chunks.length) return null;
    chunks.sort((x, y) => x.seq - y.seq);
    const blob = new Blob(chunks.map(c => c.blob), { type: meta.mime });
    return blob.size ? { meta, blob } : null;
  } catch {
    return null;
  }
}

export async function clearPending(key: string) {
  try {
    const db = await openDb();
    const tx = db.transaction([META, CHUNKS], 'readwrite');
    tx.objectStore(META).delete(key);
    tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]));
    await done(tx);
  } catch { /* 清不掉下次再提示，不影响主流程 */ }
}
