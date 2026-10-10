// 会话 token 的安全存储
//
// 硬性要求：token 绝不写进 sqlite，也绝不写进普通 storage。
// 首选 plus.navigator 的安全存储（Android：KeyStore 加密 / iOS：Keychain），
// 只有当它不可用（H5 预览、旧基座）时才降级，并且把"用了哪种"暴露出来，
// 让 UI 能如实告诉用户当前不是系统级安全存储。
export type SecureBackend = 'plus-secure' | 'plus-storage' | 'local-storage';

let used: SecureBackend | null = null;

function plusApi(): any {
  const g: any = globalThis as any;
  return g && g.plus ? g.plus : null;
}

function nav(): any {
  const p = plusApi();
  return p && p.navigator ? p.navigator : null;
}

/** 上一次实际用到的后端；null 表示还没用过 */
export function lastBackend(): SecureBackend | null {
  return used;
}

/** 是否真的是系统级安全存储（不是降级方案） */
export function isTrulySecure(): boolean {
  return used === 'plus-secure';
}

/** 当前环境支不支持 plus 安全存储 */
export function supportsSecure(): boolean {
  const n = nav();
  return !!(n && typeof n.setSecureData === 'function' && typeof n.getSecureData === 'function');
}

function promisify<T>(run: (done: (v: T) => void, fail: (e: any) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    try {
      run(
        (v: T) => {
          settled = true;
          resolve(v);
        },
        (e: any) => {
          settled = true;
          reject(e instanceof Error ? e : new Error(String(e && e.message ? e.message : e)));
        }
      );
    } catch (e) {
      settled = true;
      reject(e instanceof Error ? e : new Error(String(e)));
    }
    // 有些版本是同步返回、不回调：下一拍兜底 resolve，避免 Promise 悬挂
    setTimeout(() => {
      if (!settled) resolve(undefined as unknown as T);
    }, 60);
  });
}

export async function setSecure(key: string, value: string): Promise<SecureBackend> {
  const n = nav();
  if (n && typeof n.setSecureData === 'function') {
    try {
      await promisify<void>((done, fail) => {
        n.setSecureData(key, value, done, fail);
      });
      used = 'plus-secure';
      return used;
    } catch (e) {
      /* 落到下面的降级分支 */
    }
  }
  const p = plusApi();
  if (p && p.storage && typeof p.storage.setItem === 'function') {
    p.storage.setItem(key, value);
    used = 'plus-storage';
    return used;
  }
  try {
    const g: any = globalThis as any;
    if (g.localStorage) g.localStorage.setItem(key, value);
    else uni.setStorageSync(key, value);
  } catch (e) {
    uni.setStorageSync(key, value);
  }
  used = 'local-storage';
  return used;
}

export async function getSecure(key: string): Promise<string | null> {
  const n = nav();
  if (n && typeof n.getSecureData === 'function') {
    try {
      const v = await promisify<any>((done, fail) => {
        n.getSecureData(key, done, fail);
      });
      if (typeof v === 'string' && v.length) {
        used = 'plus-secure';
        return v;
      }
      if (v && typeof v === 'object' && typeof v.value === 'string') return v.value;
      return null;
    } catch (e) {
      /* 降级 */
    }
  }
  const p = plusApi();
  if (p && p.storage && typeof p.storage.getItem === 'function') {
    const sv = p.storage.getItem(key);
    if (sv) {
      used = 'plus-storage';
      return sv;
    }
    return null;
  }
  try {
    const g: any = globalThis as any;
    const lv = g.localStorage ? g.localStorage.getItem(key) : uni.getStorageSync(key);
    return lv || null;
  } catch (e) {
    return null;
  }
}

export async function removeSecure(key: string): Promise<void> {
  const n = nav();
  if (n && typeof n.removeSecureData === 'function') {
    try {
      await promisify<void>((done, fail) => {
        n.removeSecureData(key, done, fail);
      });
      return;
    } catch (e) {
      /* 降级 */
    }
  }
  const p = plusApi();
  if (p && p.storage && typeof p.storage.removeItem === 'function') {
    p.storage.removeItem(key);
    return;
  }
  try {
    const g: any = globalThis as any;
    if (g.localStorage) g.localStorage.removeItem(key);
    else uni.removeStorageSync(key);
  } catch (e) {
    /* ignore */
  }
}
