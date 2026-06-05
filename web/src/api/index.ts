// web/src/api/index.js
// 所有 fetch 走这里。识别 viewing != me 时自动追加 ?as_user= 参数。
import { useIdentity } from '../stores/identity';

function withViewing(url) {
  const identity = useIdentity();
  if (identity.viewing && identity.viewing !== identity.me) {
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + 'as_user=' + identity.viewing;
  }
  return url;
}

export async function api(url: string, opts: RequestInit = {}) {
  const finalUrl = withViewing(url);
  const res = await fetch(finalUrl, {
    credentials: 'include',
    ...opts,
    headers: {
      ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    },
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw Object.assign(new Error(err.error || res.statusText), { status: res.status, body: err });
  }
  return res.json();
}

// 海报路径工具
export const tmdbPoster = (path, size = 'w500') =>
  path ? `https://image.tmdb.org/t/p/${size}${path.startsWith('/') ? path : '/' + path}` : null;

// 外链海报走本站代理+缓存（没梯子也能看）；本地/相对路径原样返回
export const imgProxy = (u) =>
  !u ? '' : (/^https?:\/\//.test(u) ? '/api/img?u=' + encodeURIComponent(u) : u);

// 评分跳转链接：豆瓣/Bangumi 评分点击跳到该平台的影片条目；tmdb 无外链返回空
export function ratingHref(w) {
  if (!w) return '';
  if (w.rating_source === 'douban') return w.douban_url || (w.douban_id ? `https://movie.douban.com/subject/${w.douban_id}/` : '');
  if (w.rating_source === 'bangumi' && w.bangumi_id) return `https://bgm.tv/subject/${w.bangumi_id}`;
  return '';
}
