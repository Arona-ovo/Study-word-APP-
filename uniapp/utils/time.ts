// 统一时间源：所有表的 created_at / updated_at 都是毫秒时间戳（INTEGER）
export function now(): number {
  return Date.now();
}

// 会话有效期：默认 180 天（本地账号，没有服务端刷新）
export const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
