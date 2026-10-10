// UUID v4：所有业务表的主键（禁止自增 id），同时用作未来云同步的全局唯一标识
import { randomBytes } from './random.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuid(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;   // version 4
  b[8] = (b[8] & 0x3f) | 0x80;   // variant 10xx
  const h: string[] = [];
  for (let i = 0; i < 16; i++) {
    const v = b[i];
    h.push((v < 16 ? '0' : '') + v.toString(16));
  }
  return (
    h.slice(0, 4).join('') + '-' +
    h.slice(4, 6).join('') + '-' +
    h.slice(6, 8).join('') + '-' +
    h.slice(8, 10).join('') + '-' +
    h.slice(10, 16).join('')
  );
}

export function isUuid(v: unknown): boolean {
  return typeof v === 'string' && UUID_RE.test(v);
}
