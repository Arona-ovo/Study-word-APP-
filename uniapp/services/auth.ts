// 本地账号业务层（纯本地，不发任何网络请求）
//
// 分层位置：  pages → services/auth.ts → repositories（抽象接口）→ SQLite / KV
// 业务层只认 Repository 接口，不 import sqlite、不写 SQL、不碰 storage 细节。
//
// 会话 token 只存 plus 安全存储（utils/secure-storage），绝不写 sqlite / 普通 storage。
// 密码只存单向哈希（utils/hash），任何时刻都不出现明文。
import { initRepositories, getRepositories } from '../repositories/index.ts';
import type { UserRow } from '../repositories/types.ts';
import { hashPassword, verifyPassword, needsRehash } from '../utils/hash.ts';
import { randomToken } from '../utils/random.ts';
import { now, SESSION_TTL_MS } from '../utils/time.ts';
import * as secure from '../utils/secure-storage.ts';

const TOKEN_KEY = 'bw_session_v1';

export interface Session {
  token: string;
  userId: string;
  username: string;
  nickname: string;
  issuedAt: number;
  expiresAt: number;
}

export type AuthErrorCode =
  | 'invalid-username'
  | 'weak-password'
  | 'username-taken'
  | 'bad-credentials'
  | 'db-unavailable'
  | 'not-logged-in'
  | 'unknown';

export class AuthError extends Error {
  code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'AuthError';
  }
}

let current: Session | null = null;
let booted = false;
const listeners: Array<(s: Session | null) => void> = [];

function emit(): void {
  for (const fn of listeners) {
    try {
      fn(current);
    } catch (e) {
      /* 单个订阅者出错不影响其它 */
    }
  }
}

/** 订阅登录态变化，返回取消订阅函数 */
export function onChange(fn: (s: Session | null) => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

async function repos() {
  try {
    return await initRepositories();
  } catch (e) {
    throw new AuthError('db-unavailable', '本地数据库不可用');
  }
}

/* ------------------------------ 校验 ------------------------------ */

export function validateUsername(raw: string): string | null {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return '请输入用户名';
  if (v.length < 2 || v.length > 20) return '用户名需 2-20 个字符';
  if (/[\s\u0000-\u001f]/.test(v)) return '用户名不能包含空格或控制字符';
  return null;
}

export function validatePassword(raw: string): string | null {
  const v = String(raw == null ? '' : raw);
  if (v.length < 8) return '密码至少 8 位';
  if (v.length > 72) return '密码最长 72 位';
  if (!v.trim()) return '密码不能全是空格';
  return null;
}

/* ------------------------------ 会话 ------------------------------ */

export async function init(): Promise<Session | null> {
  if (booted) return current;
  booted = true;
  try {
    await repos();
  } catch (e) {
    booted = false;
    return null;
  }
  try {
    const raw = await secure.getSecure(TOKEN_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s || !s.userId || !s.token) return null;
    if (!s.expiresAt || s.expiresAt < now()) {
      await secure.removeSecure(TOKEN_KEY);
      return null;
    }
    current = s;
    emit();
    return current;
  } catch (e) {
    current = null;
    return null;
  }
}

export function session(): Session | null {
  return current;
}

export function isLoggedIn(): boolean {
  return !!current;
}

export function currentUserId(): string {
  return current ? current.userId : '';
}

/** 给页面展示用的安全用户信息（不含任何凭据） */
export function currentUser(): { uuid: string; username: string; nickname: string } | null {
  if (!current) return null;
  return { uuid: current.userId, username: current.username, nickname: current.nickname || current.username };
}

async function issue(user: UserRow): Promise<Session> {
  const t = now();
  const s: Session = {
    token: randomToken(),
    userId: user.uuid,
    username: user.username,
    nickname: user.nickname || user.username,
    issuedAt: t,
    expiresAt: t + SESSION_TTL_MS
  };
  await secure.setSecure(TOKEN_KEY, JSON.stringify(s));
  current = s;
  emit();
  return s;
}

/* ------------------------------ 注册 / 登录 / 登出 ------------------------------ */

export async function register(username: string, password: string): Promise<Session> {
  const uErr = validateUsername(username);
  if (uErr) throw new AuthError('invalid-username', uErr);
  const pErr = validatePassword(password);
  if (pErr) throw new AuthError('weak-password', pErr);

  const r = await repos();
  const exist = await r.users.findByUsername(username);
  if (exist) throw new AuthError('username-taken', '该用户名已存在');

  const hash = await hashPassword(password);
  const user = await r.users.create({
    username,
    password_hash: hash,
    nickname: String(username).trim()
  });
  return issue(user);
}

export async function login(username: string, password: string): Promise<Session> {
  const uErr = validateUsername(username);
  if (uErr) throw new AuthError('invalid-username', uErr);
  if (!password) throw new AuthError('bad-credentials', '请输入密码');

  const r = await repos();
  const user = await r.users.findByUsername(username);
  // 用户名不存在与密码错误合并成同一句，避免暴露"这个用户名注册过"
  if (!user) throw new AuthError('bad-credentials', '用户名或密码不正确');

  let ok = false;
  try {
    ok = await verifyPassword(password, user.password_hash);
  } catch (e) {
    throw new AuthError('unknown', '校验失败：' + ((e as Error).message || '未知错误'));
  }
  if (!ok) throw new AuthError('bad-credentials', '用户名或密码不正确');

  // 哈希算法升级（如后来接入了 argon2）或迭代次数偏低 → 本次登录成功后静默重写
  if (needsRehash(user.password_hash)) {
    try {
      const upgraded = await hashPassword(password);
      await r.users.update(user.uuid, { password_hash: upgraded });
    } catch (e) {
      /* 升级失败不影响本次登录 */
    }
  }
  try {
    await r.users.update(user.uuid, { last_login_at: now() });
  } catch (e) {
    /* 记账失败不影响登录 */
  }

  return issue(user);
}

export async function logout(): Promise<void> {
  try {
    await secure.removeSecure(TOKEN_KEY);
  } catch (e) {
    /* ignore */
  }
  current = null;
  emit();
}

/** 当前会话落在哪种存储（UI 如实提示用） */
export function storageBackend(): string {
  return secure.lastBackend() || 'unknown';
}

export function isSecureStorage(): boolean {
  return secure.isTrulySecure();
}
