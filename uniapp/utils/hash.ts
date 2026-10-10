// 口令单向哈希（绝不保存明文）
//
// 设计：PasswordHasher 是可插拔接口
//   · 首选 argon2id（argon2-wasm / hash-wasm）—— 需要额外装包，见 utils/argon2.ts
//   · 未安装时自动用内置 PBKDF2-HMAC-SHA256（纯 TS，零依赖，App/H5 都能跑）
// 编码串自带算法与参数前缀，所以两种哈希可以共存，登录时按前缀选实现，
// 之后可在用户下次登录时静默升级（needsRehash）。
import { randomBytes } from './random.ts';

export type HashAlgo = 'argon2id' | 'pbkdf2-sha256';

export interface PasswordHasher {
  readonly algo: HashAlgo;
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
}

/** PBKDF2 迭代次数：纯 JS 实现的折中值（argon2 接入后可下调并逐步迁移） */
export let PBKDF2_ITERATIONS = 120000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

export function setPbkdf2Iterations(n: number): void {
  PBKDF2_ITERATIONS = Math.max(10000, Math.floor(n));
}

/* ------------------------------ 编码工具 ------------------------------ */

export function utf8Bytes(str: string): Uint8Array {
  const s = String(str == null ? '' : str);
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      // 代理对：按 Unicode 码点编码（emoji 也能进密码）
      const hi = c;
      const lo = s.charCodeAt(i + 1);
      const cp = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00);
      i++;
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(out);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToB64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
    out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
    out += b2 === undefined ? '=' : B64[b2 & 63];
  }
  return out;
}

export function b64ToBytes(text: string): Uint8Array {
  const s = String(text || '').replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const n =
      (B64.indexOf(s[i]) << 18) |
      (B64.indexOf(s[i + 1]) << 12) |
      (B64.indexOf(s[i + 2] || 'A') << 6) |
      B64.indexOf(s[i + 3] || 'A');
    out.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  const len = Math.floor((s.length * 3) / 4);
  return new Uint8Array(out.slice(0, len));
}

/* ------------------------------ SHA-256 ------------------------------ */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256(data: Uint8Array): Uint8Array {
  const len = data.length;
  const blocks = Math.ceil((len + 9) / 64);
  const buf = new Uint8Array(blocks * 64);
  buf.set(data);
  buf[len] = 0x80;
  // 末尾 8 字节放 64 位大端长度；输入远小于 2^32 位，高 4 字节保持 0
  const bits = len * 8;
  const last = buf.length;
  buf[last - 4] = (bits >>> 24) & 0xff;
  buf[last - 3] = (bits >>> 16) & 0xff;
  buf[last - 2] = (bits >>> 8) & 0xff;
  buf[last - 1] = bits & 0xff;

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let i = 0; i < blocks; i++) {
    const off = i * 64;
    for (let t = 0; t < 16; t++) {
      w[t] =
        ((buf[off + t * 4] << 24) |
          (buf[off + t * 4 + 1] << 16) |
          (buf[off + t * 4 + 2] << 8) |
          buf[off + t * 4 + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const hs = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (hs[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (hs[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (hs[i] >>> 8) & 0xff;
    out[i * 4 + 3] = hs[i] & 0xff;
  }
  return out;
}

/* ------------------------------ HMAC / PBKDF2 ------------------------------ */

export function hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const block = 64;
  let k = key;
  if (k.length > block) k = sha256(k);
  const padded = new Uint8Array(block);
  padded.set(k);
  const o = new Uint8Array(block);
  const i = new Uint8Array(block);
  for (let n = 0; n < block; n++) {
    o[n] = padded[n] ^ 0x5c;
    i[n] = padded[n] ^ 0x36;
  }
  const inner = sha256(concat(i, msg));
  return sha256(concat(o, inner));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function pbkdf2(password: Uint8Array, salt: Uint8Array, iterations: number, dkLen: number): Uint8Array {
  const blocks = Math.ceil(dkLen / 32);
  const out = new Uint8Array(blocks * 32);
  for (let b = 1; b <= blocks; b++) {
    const saltBlock = concat(salt, new Uint8Array([(b >>> 24) & 255, (b >>> 16) & 255, (b >>> 8) & 255, b & 255]));
    let u = hmacSha256(password, saltBlock);
    const t = u.slice();
    for (let i = 1; i < iterations; i++) {
      u = hmacSha256(password, u);
      for (let j = 0; j < 32; j++) t[j] ^= u[j];
    }
    out.set(t, (b - 1) * 32);
  }
  return out.slice(0, dkLen);
}

/** 定长比较，避免因提前返回而泄漏前缀长度 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ------------------------------ Hasher ------------------------------ */

/** 编码格式：$pbkdf2-sha256$i=<iter>$<salt b64>$<hash b64> */
const PBKDF2_PREFIX = '$pbkdf2-sha256$';

export function pbkdf2Encode(password: string, iterations = PBKDF2_ITERATIONS, salt?: Uint8Array): string {
  const s = salt || randomBytes(SALT_BYTES);
  const dk = pbkdf2(utf8Bytes(password), s, iterations, KEY_BYTES);
  return PBKDF2_PREFIX + 'i=' + iterations + '$' + bytesToB64(s) + '$' + bytesToB64(dk);
}

export function pbkdf2Verify(password: string, encoded: string): boolean {
  const parts = String(encoded || '').split('$').filter((s) => s !== '');
  // ['pbkdf2-sha256', 'i=120000', salt, hash]
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = parseInt(parts[1].replace('i=', ''), 10);
  if (!iterations) return false;
  const salt = b64ToBytes(parts[2]);
  const expected = b64ToBytes(parts[3]);
  const actual = pbkdf2(utf8Bytes(password), salt, iterations, expected.length || KEY_BYTES);
  return timingSafeEqual(actual, expected);
}

const pbkdf2Hasher: PasswordHasher = {
  algo: 'pbkdf2-sha256',
  async hash(password: string): Promise<string> {
    return pbkdf2Encode(password);
  },
  async verify(password: string, encoded: string): Promise<boolean> {
    return pbkdf2Verify(password, encoded);
  }
};

let argonHasher: PasswordHasher | null = null;

/** 注册 argon2 实现（见 utils/argon2.ts）；不注册就用内置 PBKDF2 */
export function setPasswordHasher(hasher: PasswordHasher | null): void {
  argonHasher = hasher;
}

export function getPasswordHasher(): PasswordHasher {
  return argonHasher || pbkdf2Hasher;
}

export function currentAlgo(): HashAlgo {
  return getPasswordHasher().algo;
}

export function isArgon2Enabled(): boolean {
  return !!argonHasher;
}

export async function hashPassword(password: string): Promise<string> {
  return getPasswordHasher().hash(password);
}

/** 按编码串前缀选实现：老账号用 PBKDF2、新账号用 argon2 也能各自正确校验 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (String(encoded || '').indexOf('$argon2') === 0) {
    if (!argonHasher) {
      throw new Error('该账号使用 argon2 哈希，但当前未启用 argon2 适配器');
    }
    return argonHasher.verify(password, encoded);
  }
  return pbkdf2Hasher.verify(password, encoded);
}

/** 是否需要在用户下次登录时静默升级哈希（argon2 已启用却还存着 PBKDF2，或迭代次数偏低） */
export function needsRehash(encoded: string): boolean {
  const text = String(encoded || '');
  if (argonHasher && text.indexOf('$argon2') !== 0) return true;
  if (text.indexOf(PBKDF2_PREFIX) === 0) {
    const seg = text.split('$').filter((s) => s !== '') [1] || '';
    const it = parseInt(seg.replace('i=', ''), 10);
    if (it && it < PBKDF2_ITERATIONS) return true;
  }
  return false;
}
