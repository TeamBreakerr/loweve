// server/src/config.js
// 集中读取环境变量。其他模块只 import 这里。
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: parseInt(process.env.LOWEVE_PORT || '18083', 10),
  dataDir: process.env.LOWEVE_DATA_DIR || path.resolve(__dirname, '../../data'),
  userA: process.env.USER_A_NAME || 'A',
  userB: process.env.USER_B_NAME || 'B',
  tmdbToken: process.env.TMDB_API_TOKEN || '',
  tmdbKey: process.env.TMDB_API_KEY || '',
  bangumiUserAgent: process.env.BANGUMI_USER_AGENT || 'loweve/1.0',
  llmBaseUrl: process.env.LLM_BASE_URL || '',
  llmApiKey: process.env.LLM_API_KEY || '',
  llmModel: process.env.LLM_MODEL || '',
};

export const paths = {
  dbFile: path.join(config.dataDir, 'loweve.db'),
  posterDir: path.join(config.dataDir, 'posters'),
  webDist: path.resolve(__dirname, '../../web/dist'),
};
