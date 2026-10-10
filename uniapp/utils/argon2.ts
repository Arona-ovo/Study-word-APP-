// argon2 适配器（可选增强）
//
// 为什么默认是 PBKDF2？
//   argon2 需要 wasm（argon2-wasm / hash-wasm），而本工程目前没有 package.json / 没有装任何 npm 包。
//   装包后在这里注册一次即可切换到 argon2id，业务层（services/auth.ts）不用改一行。
//
// 接入步骤（任选其一）：
//   1) hash-wasm：npm i hash-wasm
//      import { argon2id, argon2Verify } from 'hash-wasm'
//      setPasswordHasher(fromHashWasm({ argon2id, argon2Verify }))
//   2) argon2-wasm：npm i argon2-wasm
//      import argon2 from 'argon2-wasm'
//      setPasswordHasher(fromArgon2Wasm(argon2))
//   3) 不想走打包器：把 argon2 的 UMD 挂到 window.__argon2__，启动时调 autoRegisterArgon2()
//
// 参数：m = 64MB, t = 3, p = 1（OWASP 对 argon2id 的移动/单机场景建议区间内）
import { randomBytes } from './random.ts';
import { setPasswordHasher } from './hash.ts';
import type { PasswordHasher } from './hash.ts';

export const ARGON2_PARAMS = {
  memory: 65536,   // 64 MB
  time: 3,         // 迭代
  parallelism: 1,
  hashLength: 32,
  saltBytes: 16
};

/** hash-wasm 的 argon2id({ password, salt, iterations, memorySize, parallelism, hashLength, outputType }) */
export function fromHashWasm(mod: any): PasswordHasher {
  if (!mod || typeof mod.argon2id !== 'function' || typeof mod.argon2Verify !== 'function') {
    throw new Error('hash-wasm 模块缺少 argon2id / argon2Verify');
  }
  return {
    algo: 'argon2id',
    async hash(password: string): Promise<string> {
      return mod.argon2id({
        password,
        salt: randomBytes(ARGON2_PARAMS.saltBytes),
        iterations: ARGON2_PARAMS.time,
        memorySize: ARGON2_PARAMS.memory,   // KiB
        parallelism: ARGON2_PARAMS.parallelism,
        hashLength: ARGON2_PARAMS.hashLength,
        outputType: 'encoded'               // 直接返回 PHC 串：$argon2id$v=19$m=...,t=...,p=...$salt$hash
      });
    },
    async verify(password: string, encoded: string): Promise<boolean> {
      return mod.argon2Verify({ password, hash: encoded });
    }
  };
}

/** argon2-wasm 的 hash({ pass, salt, time, mem, parallelism, hashLen, type }) → { encoded } */
export function fromArgon2Wasm(mod: any): PasswordHasher {
  if (!mod || typeof mod.hash !== 'function') {
    throw new Error('argon2-wasm 模块缺少 hash()');
  }
  const ArgonType = mod.ArgonType || { Argon2id: 2 };
  return {
    algo: 'argon2id',
    async hash(password: string): Promise<string> {
      const res = await mod.hash({
        pass: password,
        salt: randomBytes(ARGON2_PARAMS.saltBytes),
        time: ARGON2_PARAMS.time,
        mem: ARGON2_PARAMS.memory,
        parallelism: ARGON2_PARAMS.parallelism,
        hashLen: ARGON2_PARAMS.hashLength,
        type: ArgonType.Argon2id
      });
      // 优先用库自带的 PHC 串；没有就自己拼，保证与 verifyPassword 的前缀判断一致
      if (res && res.encoded) return res.encoded;
      throw new Error('argon2-wasm 未返回 encoded，请自行按 PHC 格式拼接');
    },
    async verify(password: string, encoded: string): Promise<boolean> {
      if (typeof mod.verify === 'function') {
        return mod.verify({ pass: password, encoded });
      }
      throw new Error('argon2-wasm 未提供 verify()，请升级版本或自行实现校验');
    }
  };
}

/** 启动时自动探测：host 已把 argon2 挂到全局就注册上，没有就保持 PBKDF2（不报错） */
export function autoRegisterArgon2(): boolean {
  const g: any = globalThis as any;
  try {
    const mod = g.__argon2__ || g.Argon2 || (g.argon2 && g.argon2.hash ? g.argon2 : null);
    if (!mod) return false;
    setPasswordHasher(mod.argon2id ? fromHashWasm(mod) : fromArgon2Wasm(mod));
    return true;
  } catch (e) {
    return false;
  }
}
