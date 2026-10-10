// 仓储工厂：业务层从这里拿接口，永远拿不到具体实现
//
//   import { repos } from '@/repositories'
//   const user = await repos.users.findByUsername('tom')
//
// 当前根据运行环境自动选后端：
//   App（plus.sqlite 可用）→ sqlite
//   其它 / 建库失败          → kv（H5 预览、小程序）
// 未来接云同步：新增 cloud-*.ts 实现同一组接口，在 createRepositories() 里按开关返回即可，
// 业务层一行不用改。
import * as sqlite from '../db/sqlite.ts';
import {
  SqliteUserRepository,
  SqliteStudyRecordRepository,
  SqliteWordFavoriteRepository
} from './local-sqlite.ts';
import {
  KvUserRepository,
  KvStudyRecordRepository,
  KvWordFavoriteRepository
} from './local-kv.ts';
import type { Repositories } from './types.ts';

let repos: Repositories | null = null;
let initializing: Promise<Repositories> | null = null;

function createRepositories(backend: 'sqlite' | 'kv'): Repositories {
  if (backend === 'sqlite') {
    return {
      backend,
      users: new SqliteUserRepository(),
      studyRecords: new SqliteStudyRecordRepository(),
      wordFavorites: new SqliteWordFavoriteRepository()
    };
  }
  return {
    backend,
    users: new KvUserRepository(),
    studyRecords: new KvStudyRecordRepository(),
    wordFavorites: new KvWordFavoriteRepository()
  };
}

/** 初始化：打开数据库并建表（幂等，可重复调用） */
export async function initRepositories(): Promise<Repositories> {
  if (repos) return repos;
  if (initializing) return initializing;
  initializing = (async () => {
    let backend: 'sqlite' | 'kv' = 'kv';
    try {
      backend = (await sqlite.init()) ? 'sqlite' : 'kv';
    } catch (e) {
      backend = 'kv';
    }
    repos = createRepositories(backend);
    return repos;
  })().finally(() => {
    initializing = null;
  });
  return initializing;
}

/**
 * 取仓储。未初始化时先用 kv 顶上（不会抛错），
 * 真正用到 sqlite 的能力前请先 await initRepositories()。
 */
export function getRepositories(): Repositories {
  if (!repos) repos = createRepositories(sqlite.isReady() ? 'sqlite' : 'kv');
  return repos;
}

/** 当前后端（给设置页/调试展示） */
export function backend(): 'sqlite' | 'kv' {
  return getRepositories().backend;
}

/** 测试用：强制切到某个后端 */
export function __setRepositories(next: Repositories | null): void {
  repos = next;
}

export type { Repositories } from './types.ts';
