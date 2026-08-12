// server/src/app.js
import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import { identityMiddleware } from './middleware/identity.js';
import { viewingMiddleware } from './middleware/viewing.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';
import { usersRoutes } from './routes/users.js';
import { searchRoutes } from './routes/search.js';
import { tvRoutes } from './routes/tv.js';
import { worksRoutes } from './routes/works.js';
import { marksRoutes } from './routes/marks.js';
import { sessionsRoutes } from './routes/sessions.js';
import { planRoutes } from './routes/plan.js';
import { recosRoutes } from './routes/recos.js';
import { imgRoutes } from './routes/img.js';
import { settingsRoutes } from './routes/settings.js';
import { trashRoutes } from './routes/trash.js';
import { gameRoutes } from './games/routes.js';

export function createApp({ db, tmdb, bangumi, douban, llm, steam, igdb, wikidata }: { db: any; tmdb?: any; bangumi?: any; douban?: any; llm?: any; steam?: any; igdb?: any; wikidata?: any }) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  // 同源部署（dev 走 Vite proxy，prod 由本服务静态托管 SPA），无需 CORS。
  app.use(identityMiddleware());
  app.use(viewingMiddleware());                         // ← 新增
  app.locals.db = db;
  app.locals.tmdb = tmdb;
  app.locals.bangumi = bangumi;     // ← 新增
  app.locals.douban = douban;
  app.locals.llm = llm;
  app.locals.steam = steam;
  app.locals.igdb = igdb;
  app.locals.wikidata = wikidata;

  // API 路由
  app.use('/api/health', healthRoutes());
  app.use('/api/me', meRoutes());
  app.use('/api/users', usersRoutes());
  app.use('/api/search', searchRoutes());          // ← 新增
  app.use('/api/tv', tvRoutes());                  // 剧集季列表（分季追踪）
  app.use('/api/posters', express.static(paths.posterDir, { immutable: true, maxAge: '365d' }));
  app.use('/api/img', imgRoutes());                // 海报代理+缓存（外链 CDN → 本地）
  app.use('/api/works', worksRoutes());            // ← 新增
  app.use('/api/marks', marksRoutes());           // ← 新增
  app.use('/api/sessions', sessionsRoutes());      // ← 新增
  app.use('/api/plan', planRoutes());              // ← 新增
  app.use('/api/recos', recosRoutes());            // ← 新增
  app.use('/api/settings', settingsRoutes());      // 运行时服务配置（LLM/TMDB/Bangumi 凭证）
  app.use('/api/trash', trashRoutes());            // 删除记录快照：恢复 / 永久删除
  app.use('/api/games', gameRoutes());              // 独立游戏空间：Steam / 记录 / 计划 / AI 推荐
  app.get('/api/ping', (_req, res) => res.json({ pong: true }));

  // API 404
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'not_found', path: req.path });
  });

  // 静态资源（Vue 构建产物）
  if (fs.existsSync(paths.webDist)) {
    app.use(express.static(paths.webDist));
    // SPA fallback：所有非 /api 路由都回 index.html
    app.get('*', (_req, res) => {
      res.sendFile(path.join(paths.webDist, 'index.html'));
    });
  } else {
    app.get('*', (_req, res) => {
      res.status(503).send('web/dist 不存在，请先 cd web && npm run build');
    });
  }

  return app;
}
