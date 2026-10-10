// SQLite 驱动（uni-app App 端：plus.sqlite，仅 Android / iOS 可用）
//
// 这一层是**唯一**知道 plus.sqlite 的地方：Repository 只调 exec / select，
// 未来换成 u-sqlite 插件或云端数据源，改这一个文件即可（业务层零感知）。
//
// 两个平台注意点：
//  1) Android 不支持用 ";" 拼多条 SQL —— 建表必须逐条执行；
//  2) plus.sqlite 不支持绑定参数 —— 所有值必须经 db/sql.ts 的 esc() 转义后再拼。
import { DB_NAME, DB_PATH, allSchemaSql } from './schema.ts';

type Fail = { code?: number; message?: string };

function plusApi(): any {
  const g: any = globalThis as any;
  return g && g.plus ? g.plus : null;
}

export function sqliteApi(): any {
  const p = plusApi();
  return p && p.sqlite ? p.sqlite : null;
}

// 当前运行环境能不能用本地库（H5 / 小程序一律 false → 上层走 KV 降级实现）
export function isSupported(): boolean {
  return !!sqliteApi();
}

let ready = false;
let opening: Promise<boolean> | null = null;

function call<T>(fn: (opt: any) => void, opt: any): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      fn(
        Object.assign({}, opt, {
          success: (res: any) => resolve(res as T),
          fail: (e: Fail) => reject(new Error((e && e.message) || 'sqlite error ' + ((e && e.code) || '')))
        })
      );
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

async function doOpen(): Promise<boolean> {
  const api = sqliteApi();
  if (!api) return false;
  try {
    let opened = false;
    try {
      opened = !!api.isOpenDatabase({ name: DB_NAME, path: DB_PATH });
    } catch (e) {
      opened = false;
    }
    if (!opened) {
      await call<void>(api.openDatabase.bind(api), { name: DB_NAME, path: DB_PATH });
    }
    for (const sql of allSchemaSql()) {
      await call<void>(api.executeSql.bind(api), { name: DB_NAME, sql });
    }
    ready = true;
    return true;
  } catch (e) {
    ready = false;
    console.warn('[db] sqlite 打开失败，回退 KV 实现：', e);
    return false;
  }
}

// 初始化（建库 + 建表 + 建索引），幂等；失败返回 false 由上层降级
export async function init(): Promise<boolean> {
  if (ready) return true;
  if (!isSupported()) return false;
  if (opening) return opening;
  opening = doOpen().finally(() => {
    opening = null;
  });
  return opening;
}

export function isReady(): boolean {
  return ready;
}

async function ensure(): Promise<void> {
  if (!ready) await init();
  if (!ready) throw new Error('sqlite_unavailable');
}

export async function exec(sql: string): Promise<void> {
  await ensure();
  const api = sqliteApi();
  if (!api) throw new Error('sqlite_unavailable');
  await call<void>(api.executeSql.bind(api), { name: DB_NAME, sql });
}

export async function execBatch(sqls: string[]): Promise<void> {
  for (const sql of sqls) await exec(sql);
}

export async function select<T = any>(sql: string): Promise<T[]> {
  await ensure();
  const api = sqliteApi();
  if (!api) throw new Error('sqlite_unavailable');
  const res = await call<any>(api.selectSql.bind(api), { name: DB_NAME, sql });
  return Array.isArray(res) ? (res as T[]) : [];
}

// 事务：plus.sqlite 的 transaction 只支持 begin/commit/rollback
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  await ensure();
  const api = sqliteApi();
  if (!api) throw new Error('sqlite_unavailable');
  await call<void>(api.transaction.bind(api), { name: DB_NAME, operation: 'begin' });
  try {
    const r = await fn();
    await call<void>(api.transaction.bind(api), { name: DB_NAME, operation: 'commit' });
    return r;
  } catch (e) {
    try {
      await call<void>(api.transaction.bind(api), { name: DB_NAME, operation: 'rollback' });
    } catch (_) {
      /* ignore */
    }
    throw e;
  }
}

export async function close(): Promise<void> {
  const api = sqliteApi();
  ready = false;
  if (!api) return;
  try {
    await call<void>(api.closeDatabase.bind(api), { name: DB_NAME });
  } catch (e) {
    /* ignore */
  }
}
