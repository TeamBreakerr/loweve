// server/src/douban/queue.js
import { workNames } from '../routes/works.js';

const WORK_COLS = `id, tmdb_id, tmdb_type, title, original_title, aka_titles, year, overview, genres,
  runtime, is_anime, primary_rating, primary_rating_count, primary_poster_url, rating_source,
  bangumi_id, douban_id, douban_url, imdb_id, fetched_at, updated_at, douban_raw`;

let chain: Promise<any> = Promise.resolve();
let delayMs = 0;   // 任务间隔，默认 0（测试快）；生产在 index.js setDoubanQueueDelay(1000) 防豆瓣限流
const sleep = (ms: any) => new Promise(r => setTimeout(r, ms));

export function setDoubanQueueDelay(ms: any) { delayMs = ms; }

export function enqueueDoubanUpgrade(db: any, douban: any, workId: any) {
  if (!douban?.match) return Promise.resolve(null);

  const job = chain.then(async () => {
    try {
      const work = db.prepare(`SELECT ${WORK_COLS} FROM works WHERE id = ?`).get(workId);
      if (!work) return null;
      return await upgradeWithDouban(db, douban, work);
    } catch (e) {
      console.warn('[douban] upgrade failed for work', workId, e.message);
      return null;
    }
  });
  // 任务后停一下再放下一个，避免 sweep 批量补抓时连发被豆瓣限流（返回的 job 不含此延迟，单次添加不受影响）
  chain = job.catch(() => {}).then(() => (delayMs ? sleep(delayMs) : undefined));
  return job;
}

export async function upgradeWithDouban(db: any, douban: any, work: any) {
  const matched = await matchWithRetry(douban, { title: work.title, year: work.year, names: workNames(work) });
  if (!matched) return work;

  // 海报保持 TMDB（不抓/缓存豆瓣海报：差别不大，且豆瓣图床防盗链脆）；只升级评分与来源。
  db.prepare(`UPDATE works SET
    primary_rating = @rating,
    primary_rating_count = @votes,
    rating_source = 'douban',
    douban_id = @douban_id,
    douban_url = @douban_url,
    douban_raw = @raw,
    updated_at = @now
    WHERE id = @id`).run({
      rating: matched.rating ?? null,
      votes: matched.votes ?? null,
      douban_id: matched.douban_id,
      douban_url: matched.url ?? null,
      raw: JSON.stringify(matched),
      now: Date.now(),
      id: work.id,
    });

  return db.prepare(`SELECT ${WORK_COLS} FROM works WHERE id = ?`).get(work.id);
}

async function matchWithRetry(douban: any, input: any) {
  const first = await douban.match(input);
  if (first) return first;
  return douban.match(input);
}

// 启动时把卡在 tmdb 的非动画作品（电影+剧集）重新入队补抓豆瓣（偶发失败 / 旧数据的自愈）。
// HTTP 客户端很快，串行 trickle 不压垮豆瓣。
export function sweepStuckDouban(db: any, douban: any) {
  if (!douban?.match) return [];
  const stuck = db.prepare(
    `SELECT id FROM works WHERE rating_source = 'tmdb' AND is_anime = 0`).all();
  for (const w of stuck) enqueueDoubanUpgrade(db, douban, w.id);
  return stuck.map((w: any) => w.id);
}

export function resetDoubanQueueForTests() {
  chain = Promise.resolve();
}
