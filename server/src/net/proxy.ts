// 给 Node 原生 fetch 装代理。
// Node 的 undici fetch 默认「不读」HTTP(S)_PROXY 环境变量，所以墙内环境即便配了代理，
// 对 TMDB / 豆瓣 / Bangumi 这些外网请求也不生效。这里在「检测到代理环境变量时」挂一个
// 全局 dispatcher（EnvHttpProxyAgent 会自动遵循 HTTPS_PROXY / HTTP_PROXY / NO_PROXY）。
//
// 仅当显式设置了代理变量时才启用；否则保持直连——开源 / CI / 无墙环境零影响。
// LLM 走内网的 cli-proxy-api，务必用 NO_PROXY 排除（见 docker-compose）。
import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';

export function installProxyFromEnv() {
  const url =
    process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.HTTP_PROXY || process.env.http_proxy;
  if (!url) return null;
  setGlobalDispatcher(new EnvHttpProxyAgent());
  return url;
}
