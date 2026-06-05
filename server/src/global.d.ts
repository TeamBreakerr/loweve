// Express Request 上中间件挂的自定义属性
declare global {
  namespace Express {
    interface Request {
      user_id?: number | null;
      viewing_user_id?: number | null;
    }
  }
}
export {};
