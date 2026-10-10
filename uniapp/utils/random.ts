// 安全随机（无第三方依赖）
// 优先 crypto.getRandomValues —— App 的 WebView 与 H5 都提供；
// 拿不到时才退回 Math.random（仅够 uuid 这类低敏感场景，口令盐必须用前者）。

function getCrypto(): any {
  const g: any = globalThis as any;
  if (g && g.crypto && typeof g.crypto.getRandomValues === 'function') return g.crypto;
  if (g && g.msCrypto && typeof g.msCrypto.getRandomValues === 'function') return g.msCrypto;
  return null;
}

export function hasSecureRandom(): boolean {
  return !!getCrypto();
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = getCrypto();
  if (c) {
    c.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

const HEX = '0123456789abcdef';

export function randomHex(n: number): string {
  const b = randomBytes(n);
  let s = '';
  for (let i = 0; i < b.length; i++) s += HEX[(b[i] >> 4) & 15] + HEX[b[i] & 15];
  return s;
}

// 会话 token：32 字节随机十六进制
export function randomToken(): string {
  return randomHex(32);
}
