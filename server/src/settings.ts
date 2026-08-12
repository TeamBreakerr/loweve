// server/src/settings.js
// 运行时可改的服务配置：存 app_state（键 cfg:<key>），覆盖 .env 默认。
// 设置页改完即时生效（各 client 用 resolve() 在调用时读 effectiveConfig）。
import { config } from './config.js';
import { getState, setState } from './recos/state.js';

// key=app_state 里的键；env=config 里的字段名；secret=是否密钥（GET 不回明文）
export const SETTING_FIELDS = [
  { key: 'llm_base_url', env: 'llmBaseUrl', secret: false },
  { key: 'llm_api_key',  env: 'llmApiKey',  secret: true },
  { key: 'llm_model',    env: 'llmModel',   secret: false },
  { key: 'tmdb_token',   env: 'tmdbToken',  secret: true },
  { key: 'tmdb_key',     env: 'tmdbKey',    secret: true },
  { key: 'bangumi_ua',   env: 'bangumiUserAgent', secret: false },
  { key: 'igdb_client_id', env: 'igdbClientId', secret: false },
  { key: 'igdb_client_secret', env: 'igdbClientSecret', secret: true },
];
const ALLOWED = new Set(SETTING_FIELDS.map(f => f.key));

function override(db: any, key: any) {
  const v = getState(db, 'cfg:' + key);
  return v && v.length ? v : null;
}

// 合并后的有效配置（DB 覆盖 > env），各 client 的 resolve 用它
export function effectiveConfig(db: any) {
  const e: Record<string, any> = {};
  for (const f of SETTING_FIELDS) e[f.env] = override(db, f.key) ?? config[f.env as keyof typeof config];
  return e;
}

// 给前端：密钥只回布尔「是否已配置」+ 来源；非密钥回明文。附整体就绪状态。
export function readForApi(db: any) {
  const eff = effectiveConfig(db);
  const out: Record<string, any> = {};
  for (const f of SETTING_FIELDS) {
    const val = eff[f.env];
    if (f.secret) out[f.key + '_set'] = Boolean(val);
    else out[f.key] = val || '';
    out[f.key + '_source'] = override(db, f.key) ? 'db' : (config[f.env as keyof typeof config] ? 'env' : 'unset');
  }
  out.llm_ready = Boolean(eff.llmBaseUrl && eff.llmApiKey && eff.llmModel);
  out.tmdb_ready = Boolean(eff.tmdbToken || eff.tmdbKey);
  out.igdb_ready = Boolean(eff.igdbClientId && eff.igdbClientSecret);
  out.steam_ready = true;   // 游戏商店公开数据，无需账号或密钥
  return out;
}

// patch: { key: value }；只处理白名单 key；空串=清除覆盖回退 env
export function updateSettings(db: any, patch: any) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (ALLOWED.has(k) && typeof v === 'string') setState(db, 'cfg:' + k, v.trim());
  }
}
