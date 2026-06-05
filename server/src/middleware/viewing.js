// server/src/middleware/viewing.js
// 解析 ?as_user=<1|2> query 参数；缺则 fallback 到 req.user_id（cookie 解析后）。
// 必须在 identityMiddleware 之后挂载，因为依赖 req.user_id。
export function viewingMiddleware() {
  return (req, _res, next) => {
    const raw = req.query?.as_user;
    const n = parseInt(raw, 10);
    const asUser = (n === 1 || n === 2) ? n : null;
    req.viewing_user_id = asUser ?? req.user_id ?? null;
    next();
  };
}
