// LocalRepository（KV 降级实现）
//
// plus.sqlite 只在 App（Android / iOS）存在。H5 预览、小程序、或 App 端建库失败时
// 自动切到这套实现：对外接口与 SQLite 版**完全一致**，只是把三张表各存成一个 JSON 数组。
// 这样业务层零改动，开发环境也能完整跑通注册 / 登录 / 收藏流程。
//
// 注意：KV 版只是开发降级，不是安全存储 —— 会话 token 永远走 utils/secure-storage，不落这里。
import { uuid as newUuid } from '../utils/uuid.ts';
import { now } from '../utils/time.ts';
import {
  asRow, normalizeUsername,
  type BaseRow, type UserRow, type StudyRecordRow, type WordFavoriteRow,
  type UserRepository, type StudyRecordRepository, type WordFavoriteRepository,
  type CreateUserInput, type PatchUser,
  type CreateStudyRecord, type PatchStudyRecord,
  type CreateWordFavorite, type PatchWordFavorite,
  type ListOptions, type SyncStatus
} from './types.ts';

const PREFIX = 'bw_kv_';

function readTable<T extends BaseRow>(table: string): T[] {
  try {
    const raw = uni.getStorageSync(PREFIX + table);
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(list) ? (list as T[]) : [];
  } catch (e) {
    return [];
  }
}

function writeTable<T extends BaseRow>(table: string, rows: T[]): void {
  try {
    uni.setStorageSync(PREFIX + table, JSON.stringify(rows));
  } catch (e) {
    /* 存储写满等异常不阻断主流程 */
  }
}

function live<T extends BaseRow>(row: T | null): T | null {
  const r = asRow<T>(row);
  if (!r) return null;
  return r.is_deleted ? null : r;
}

function slice<T>(list: T[], opts?: ListOptions): T[] {
  const offset = opts && opts.offset ? Math.max(0, Math.floor(opts.offset)) : 0;
  const limit = opts && opts.limit ? Math.max(1, Math.floor(opts.limit)) : 0;
  const part = offset ? list.slice(offset) : list;
  return limit ? part.slice(0, limit) : part;
}

/* ============================ users ============================ */

export class KvUserRepository implements UserRepository {
  readonly tableName = 'users';

  private all(): UserRow[] {
    return readTable<UserRow>('users');
  }

  async create(input: CreateUserInput): Promise<UserRow> {
    const t = now();
    const id = newUuid();
    const row: any = {
      uuid: id,
      user_id: id,
      username: normalizeUsername(input.username),
      password_hash: input.password_hash,
      nickname: input.nickname || input.username || '',
      avatar: input.avatar || '',
      created_at: t,
      updated_at: t,
      last_login_at: 0,
      is_deleted: 0,
      sync_status: 'pending'
    };
    const list = this.all();
    list.push(row);
    writeTable('users', list);
    return asRow<UserRow>(row) as UserRow;
  }

  async findByUuid(uuidValue: string): Promise<UserRow | null> {
    return live(this.all().filter((r) => r.uuid === uuidValue)[0] || null);
  }

  async findByUsername(username: string): Promise<UserRow | null> {
    const key = normalizeUsername(username);
    return live(this.all().filter((r) => r.username === key)[0] || null);
  }

  async update(uuidValue: string, patch: PatchUser): Promise<UserRow | null> {
    const list = this.all();
    const i = list.findIndex((r) => r.uuid === uuidValue && !Number(r.is_deleted));
    if (i < 0) return null;
    const merged: any = Object.assign({}, list[i], patch, {
      updated_at: now(),
      sync_status: 'pending' as SyncStatus
    });
    list[i] = merged;
    writeTable('users', list);
    return asRow<UserRow>(merged);
  }

  async softDelete(uuidValue: string): Promise<boolean> {
    const list = this.all();
    const i = list.findIndex((r) => r.uuid === uuidValue && !Number(r.is_deleted));
    if (i < 0) return false;
    list[i] = Object.assign({}, list[i], {
      is_deleted: 1,
      updated_at: now(),
      sync_status: 'pending' as SyncStatus
    });
    writeTable('users', list);
    return true;
  }

  async list(opts?: ListOptions): Promise<UserRow[]> {
    const list = this.all()
      .filter((r) => !Number(r.is_deleted))
      .sort((a, b) => b.created_at - a.created_at);
    return slice(list.map((r) => asRow<UserRow>(r)).filter(Boolean) as UserRow[], opts);
  }

  async findPendingSync(limit = 100): Promise<UserRow[]> {
    const list = this.all()
      .filter((r) => !Number(r.is_deleted) && r.sync_status === 'pending')
      .sort((a, b) => a.updated_at - b.updated_at);
    return slice(list, { limit });
  }

  async markSynced(uuids: string[], status: SyncStatus = 'synced'): Promise<number> {
    const ids = (uuids || []).filter(Boolean);
    if (!ids.length) return 0;
    const list = this.all();
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      if (ids.indexOf(list[i].uuid) >= 0) {
        list[i] = Object.assign({}, list[i], { sync_status: status });
        n++;
      }
    }
    writeTable('users', list);
    return n;
  }
}

/* ========================= study_records ========================= */

export class KvStudyRecordRepository implements StudyRecordRepository {
  readonly tableName = 'study_records';

  private all(): StudyRecordRow[] {
    return readTable<StudyRecordRow>('study_records');
  }

  async create(input: CreateStudyRecord): Promise<StudyRecordRow> {
    const t = now();
    const row: any = {
      uuid: newUuid(),
      user_id: input.user_id,
      book_id: input.book_id || '',
      word_id: input.word_id || '',
      sentence_id: input.sentence_id || '',
      direction: input.direction || '',
      mode: input.mode || '',
      result: input.result || '',
      score: Number(input.score) || 0,
      user_answer: input.user_answer || '',
      reference: input.reference || '',
      practiced_at: Number(input.practiced_at) || t,
      created_at: t,
      updated_at: t,
      is_deleted: 0,
      sync_status: 'pending'
    };
    const list = this.all();
    list.push(row);
    writeTable('study_records', list);
    return asRow<StudyRecordRow>(row) as StudyRecordRow;
  }

  async findByUuid(uuidValue: string): Promise<StudyRecordRow | null> {
    return live(this.all().filter((r) => r.uuid === uuidValue)[0] || null);
  }

  async update(uuidValue: string, patch: PatchStudyRecord): Promise<StudyRecordRow | null> {
    const list = this.all();
    const i = list.findIndex((r) => r.uuid === uuidValue && !Number(r.is_deleted));
    if (i < 0) return null;
    const merged: any = Object.assign({}, list[i], patch, {
      updated_at: now(),
      sync_status: 'pending' as SyncStatus
    });
    list[i] = merged;
    writeTable('study_records', list);
    return asRow<StudyRecordRow>(merged);
  }

  async softDelete(uuidValue: string): Promise<boolean> {
    const list = this.all();
    const i = list.findIndex((r) => r.uuid === uuidValue && !Number(r.is_deleted));
    if (i < 0) return false;
    list[i] = Object.assign({}, list[i], { is_deleted: 1, updated_at: now(), sync_status: 'pending' as SyncStatus });
    writeTable('study_records', list);
    return true;
  }

  async listByUser(userId: string, opts?: ListOptions): Promise<StudyRecordRow[]> {
    let list = this.all().filter((r) => r.user_id === userId && !Number(r.is_deleted));
    if (opts && opts.since) list = list.filter((r) => r.updated_at >= Math.floor(opts.since as number));
    list.sort((a, b) => b.practiced_at - a.practiced_at);
    return slice(list.map((r) => asRow<StudyRecordRow>(r)).filter(Boolean) as StudyRecordRow[], opts);
  }

  async findPendingSync(userId: string, limit = 100): Promise<StudyRecordRow[]> {
    const list = this.all()
      .filter((r) => r.user_id === userId && !Number(r.is_deleted) && r.sync_status === 'pending')
      .sort((a, b) => a.updated_at - b.updated_at);
    return slice(list, { limit });
  }

  async markSynced(uuids: string[], status: SyncStatus = 'synced'): Promise<number> {
    const ids = (uuids || []).filter(Boolean);
    if (!ids.length) return 0;
    const list = this.all();
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      if (ids.indexOf(list[i].uuid) >= 0) {
        list[i] = Object.assign({}, list[i], { sync_status: status });
        n++;
      }
    }
    writeTable('study_records', list);
    return n;
  }
}

/* ========================= word_favorite ========================= */

export class KvWordFavoriteRepository implements WordFavoriteRepository {
  readonly tableName = 'word_favorite';

  private all(): WordFavoriteRow[] {
    return readTable<WordFavoriteRow>('word_favorite');
  }

  async create(input: CreateWordFavorite): Promise<WordFavoriteRow> {
    const t = now();
    const row: any = {
      uuid: newUuid(),
      user_id: input.user_id,
      ref_type: input.ref_type || 'word',
      ref_id: input.ref_id || '',
      word: input.word || '',
      meaning: input.meaning || '',
      en: input.en || '',
      zh: input.zh || '',
      created_at: t,
      updated_at: t,
      is_deleted: 0,
      sync_status: 'pending'
    };
    const list = this.all();
    list.push(row);
    writeTable('word_favorite', list);
    return asRow<WordFavoriteRow>(row) as WordFavoriteRow;
  }

  async findByUuid(uuidValue: string): Promise<WordFavoriteRow | null> {
    return live(this.all().filter((r) => r.uuid === uuidValue)[0] || null);
  }

  async findByRef(userId: string, refType: string, refId: string): Promise<WordFavoriteRow | null> {
    return live(
      this.all().filter((r) => r.user_id === userId && r.ref_type === refType && r.ref_id === refId)[0] || null
    );
  }

  async upsert(input: CreateWordFavorite): Promise<WordFavoriteRow> {
    const list = this.all();
    const i = list.findIndex(
      (r) => r.user_id === input.user_id && r.ref_type === (input.ref_type || 'word') && r.ref_id === input.ref_id
    );
    if (i < 0) return this.create(input);
    const merged: any = Object.assign({}, list[i], {
      word: input.word || '',
      meaning: input.meaning || '',
      en: input.en || '',
      zh: input.zh || '',
      is_deleted: 0,
      updated_at: now(),
      sync_status: 'pending' as SyncStatus
    });
    list[i] = merged;
    writeTable('word_favorite', list);
    return asRow<WordFavoriteRow>(merged) as WordFavoriteRow;
  }

  async update(uuidValue: string, patch: PatchWordFavorite): Promise<WordFavoriteRow | null> {
    const list = this.all();
    const i = list.findIndex((r) => r.uuid === uuidValue && !Number(r.is_deleted));
    if (i < 0) return null;
    const merged: any = Object.assign({}, list[i], patch, {
      updated_at: now(),
      sync_status: 'pending' as SyncStatus
    });
    list[i] = merged;
    writeTable('word_favorite', list);
    return asRow<WordFavoriteRow>(merged);
  }

  async softDelete(uuidValue: string): Promise<boolean> {
    const list = this.all();
    const i = list.findIndex((r) => r.uuid === uuidValue && !Number(r.is_deleted));
    if (i < 0) return false;
    list[i] = Object.assign({}, list[i], { is_deleted: 1, updated_at: now(), sync_status: 'pending' as SyncStatus });
    writeTable('word_favorite', list);
    return true;
  }

  async listByUser(userId: string, opts?: ListOptions): Promise<WordFavoriteRow[]> {
    let list = this.all().filter((r) => r.user_id === userId && !Number(r.is_deleted));
    if (opts && opts.since) list = list.filter((r) => r.updated_at >= Math.floor(opts.since as number));
    list.sort((a, b) => b.created_at - a.created_at);
    return slice(list.map((r) => asRow<WordFavoriteRow>(r)).filter(Boolean) as WordFavoriteRow[], opts);
  }

  async findPendingSync(userId: string, limit = 100): Promise<WordFavoriteRow[]> {
    const list = this.all()
      .filter((r) => r.user_id === userId && !Number(r.is_deleted) && r.sync_status === 'pending')
      .sort((a, b) => a.updated_at - b.updated_at);
    return slice(list, { limit });
  }

  async markSynced(uuids: string[], status: SyncStatus = 'synced'): Promise<number> {
    const ids = (uuids || []).filter(Boolean);
    if (!ids.length) return 0;
    const list = this.all();
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      if (ids.indexOf(list[i].uuid) >= 0) {
        list[i] = Object.assign({}, list[i], { sync_status: status });
        n++;
      }
    }
    writeTable('word_favorite', list);
    return n;
  }
}
