// server/src/middleware/identity.js
export const COOKIE_NAME = 'loweve_user_id';
export const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

/**
 * 解析 cookie 并把 user_id (1|2|null) 挂到 req。
 * 不强制登录 —— 路由自己决定是否拒绝 null。
 */
export function identityMiddleware() {
  return (req: any, _res: any, next: any) => {
    const raw = req.cookies?.[COOKIE_NAME];
    const n = parseInt(raw, 10);
    req.user_id = (n === 1 || n === 2) ? n : null;
    next();
  };
}
