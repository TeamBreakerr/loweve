// server/index.js
import fs from 'node:fs';
import { installProxyFromEnv } from './src/net/proxy.js';
import { config, paths } from './src/config.js';
import { openDb } from './src/db/index.js';
import { migrate } from './src/db/migrate.js';
import { createApp } from './src/app.js';
import { createTmdbClient } from './src/tmdb/client.js';
import { createBangumiClient } from './src/bangumi/client.js';
import { createDoubanClient } from './src/douban/client.js';
import { sweepStuckDouban, setDoubanQueueDelay } from './src/douban/queue.js';
import { createLlmClient } from './src/llm/client.js';
import { effectiveConfig } from './src/settings.js';

async function main() {
  // 必须在任何 fetch 之前装代理（外网请求经 HTTPS_PROXY 走代理，内网 cli-proxy-api 经 NO_PROXY 直连）
  const proxyUrl = installProxyFromEnv();
  if (proxyUrl) console.log(`[net] 外网请求经代理 ${proxyUrl}（NO_PROXY=${process.env.NO_PROXY || process.env.no_proxy || ''}）`);

  fs.mkdirSync(config.dataDir, { recursive: true });

  const db = openDb(paths.dbFile);
  migrate(db, { userA: config.userA, userB: config.userB });

  // 各 client 用 resolve() 在调用时读「有效配置」（DB 覆盖 > env），设置页改完即时生效
  const cfg = () => effectiveConfig(db);
  const tmdb = createTmdbClient({ resolve: () => { const e = cfg(); return { token: e.tmdbToken, key: e.tmdbKey }; } });
  const bangumi = createBangumiClient({ resolve: () => ({ userAgent: cfg().bangumiUserAgent }) });
  const douban = createDoubanClient();   // 纯 HTTP（豆瓣 subject_suggest + rexxar），不再依赖 browser-svc
  setDoubanQueueDelay(1000);             // 队列任务间隔 1s，避免批量补抓时被豆瓣限流
  const llm = createLlmClient({ resolve: () => { const e = cfg(); return { baseUrl: e.llmBaseUrl, apiKey: e.llmApiKey, model: e.llmModel }; } });
  if (!tmdb.isConfigured()) {
    console.warn('[warn] TMDB key 未配置（TMDB_API_TOKEN / TMDB_API_KEY 均缺失），/api/search 将返回 503');
  }

  const app = createApp({ db, tmdb, bangumi, douban, llm });

  app.listen(config.port, () => {
    console.log(`loweve listening on :${config.port}, db=${paths.dbFile}, tmdb=${tmdb.isConfigured() ? 'ok' : 'unconfigured'}, bangumi=ok, douban=http, llm=${llm.isConfigured() ? 'ok' : 'off'}`);
    const ids = sweepStuckDouban(db, douban);   // 后台补抓卡在 tmdb 的电影
    if (ids.length) console.log(`[douban] 自愈补抓 ${ids.length} 部卡在 tmdb 的电影`);
  });
}

main().catch(err => {
  console.error('fatal', err);
  process.exit(1);
});
